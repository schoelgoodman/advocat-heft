import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import type http from "node:http";
import path from "node:path";
import { anfragenDir } from "../paths.ts";

/** Eine Anfrage aus dem Kontaktformular, so wie sie auf der Platte liegt. */
export interface Anfrage {
  eingang: string;
  vorname: string;
  name: string;
  email: string;
  nachricht: string;
  /** Nur in alten Anfragen. Neue speichern keine IP mehr; die Sperre gegen Skripte braucht sie nur im Speicher. */
  ip?: string;
  telegram?: "gesendet" | "fehler" | "aus";
}

const MAX_BODY = 32 * 1024;
const LIMITS = { vorname: 100, name: 100, email: 200, nachricht: 10_000 } as const;

// Pro IP höchstens fünf Anfragen in zehn Minuten. Reicht gegen einfache Skripte.
const WINDOW_MS = 10 * 60 * 1000;
const PER_WINDOW = 5;
const recent = new Map<string, number[]>();

function clientIp(req: http.IncomingMessage): string {
  const forwarded = req.headers["x-forwarded-for"];
  // SWAG hängt die echte Adresse hinten an. Der vordere Teil kommt vom Browser und ist frei erfunden.
  const last = (Array.isArray(forwarded) ? forwarded.at(-1) : forwarded)?.split(",").at(-1)?.trim();
  return last || req.socket.remoteAddress || "";
}

function allowed(ip: string): boolean {
  const now = Date.now();
  const hits = (recent.get(ip) ?? []).filter((at) => now - at < WINDOW_MS);
  if (hits.length >= PER_WINDOW) {
    recent.set(ip, hits);
    return false;
  }
  hits.push(now);
  recent.set(ip, hits);
  if (recent.size > 5000) {
    for (const [key, list] of recent) if (!list.some((at) => now - at < WINDOW_MS)) recent.delete(key);
  }
  return true;
}

async function readLimited(req: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new Error("Nachricht ist zu lang");
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function fields(req: http.IncomingMessage, raw: string): Record<string, string> {
  const type = req.headers["content-type"] ?? "";
  if (type.includes("application/json")) {
    const data = JSON.parse(raw) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(data).map(([key, value]) => [key, String(value ?? "")]));
  }
  return Object.fromEntries(new URLSearchParams(raw));
}

function clean(value: string | undefined, max: number): string {
  return (value ?? "").replace(/\r\n?/g, "\n").trim().slice(0, max);
}

function stamp(date: Date): string {
  return date.toISOString().replace(/\.\d+Z$/, "Z").replaceAll(":", "-");
}

async function store(anfrage: Anfrage, file: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(anfrage, null, 2)}\n`, "utf8");
  await fs.rename(tmp, file);
}

/**
 * Nur der Hinweis, dass etwas da ist. Name, E-Mail und Nachricht bleiben auf dem Server:
 * Telegram steht im Ausland, und eine Anfrage an einen Anwalt kann schon Vertrauliches enthalten.
 * Patrick liest sie in der Redaktion unter «Kontaktaufnahme».
 */
function telegramText(): string {
  return "Neue Anfrage über advocat-finanz.ch. Bitte in der Redaktion unter «Kontaktaufnahme» lesen.";
}

export async function sendTelegram(text: string): Promise<"gesendet" | "fehler" | "aus"> {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const chat = process.env.TELEGRAM_CHAT_ID?.trim();
  if (!token || !chat) return "aus";
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chat, text, disable_web_page_preview: true }),
      signal: AbortSignal.timeout(10_000),
    });
    if (response.ok) return "gesendet";
    console.error(`Telegram: ${response.status} ${(await response.text()).slice(0, 200)}`);
  } catch (error) {
    console.error("Telegram:", error instanceof Error ? error.message : error);
  }
  return "fehler";
}

function reply(res: http.ServerResponse, status: number, payload: Record<string, unknown>): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(payload));
}

/**
 * POST /kontakt. Erst auf die Platte, dann Telegram.
 * Scheitert Telegram, bleibt die Anfrage trotzdem gespeichert und der Absender sieht Erfolg.
 */
export async function handleAnfrage(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const ip = clientIp(req);
  let data: Record<string, string>;
  try {
    data = fields(req, await readLimited(req));
  } catch {
    reply(res, 400, { error: "Die Nachricht konnte nicht gelesen werden." });
    return;
  }

  // Honigtopf: Menschen sehen das Feld nicht. Bots bekommen ein freundliches Ok und nichts passiert.
  if (clean(data.website, 200)) {
    reply(res, 200, { ok: true });
    return;
  }

  const anfrage: Anfrage = {
    eingang: new Date().toISOString(),
    vorname: clean(data.vorname, LIMITS.vorname),
    name: clean(data.name, LIMITS.name),
    email: clean(data.email, LIMITS.email),
    nachricht: clean(data.nachricht, LIMITS.nachricht),
  };
  if (!anfrage.vorname || !anfrage.name || !anfrage.nachricht || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(anfrage.email)) {
    reply(res, 400, { error: "Bitte füllen Sie alle Felder aus." });
    return;
  }
  if (!allowed(ip)) {
    reply(res, 429, { error: "Zu viele Anfragen. Bitte versuchen Sie es später erneut." });
    return;
  }

  const file = path.join(anfragenDir(), `${stamp(new Date(anfrage.eingang))}-${randomBytes(3).toString("hex")}.json`);
  try {
    await store(anfrage, file);
  } catch (error) {
    console.error("Anfrage nicht gespeichert:", error instanceof Error ? error.message : error);
    reply(res, 500, { error: "Die Nachricht konnte nicht gespeichert werden." });
    return;
  }
  console.log(`Anfrage gespeichert: ${file}`);

  anfrage.telegram = await sendTelegram(telegramText());
  await store(anfrage, file).catch(() => {});
  reply(res, 200, { ok: true });
}

/** Wie weit die Redaktion mit einer Anfrage ist. Ohne Eintrag ist sie neu. */
export type AnfrageStatus = "neu" | "gelesen" | "erledigt";
const STATUS: readonly AnfrageStatus[] = ["neu", "gelesen", "erledigt"];

/**
 * Der Stand aller Anfragen in einer eigenen Datei. Die schreibt nur die Redaktion,
 * die Anfragen selbst nur die Seite. So schreiben nie zwei Prozesse in dieselbe Datei.
 */
const STATUS_FILE = "_status.json";

type StatusMap = Record<string, { status: AnfrageStatus; seit: string }>;

async function readStatus(): Promise<StatusMap> {
  try {
    return JSON.parse(await fs.readFile(path.join(anfragenDir(), STATUS_FILE), "utf8")) as StatusMap;
  } catch {
    return {};
  }
}

const ID = /^[0-9TZ-]+-[0-9a-f]{6}$/;

/**
 * So lange bleibt eine Anfrage liegen, gezählt ab Eingang. Danach löscht die Seite sie, egal ob erledigt.
 * Steht so in der Datenschutzerklärung; wer das ändert, ändert auch dort.
 */
export const AUFBEWAHRUNG_MONATE = 12;

/** Ab wann eine Anfrage gelöscht wird. */
export function loeschtAm(eingang: string): Date {
  const date = new Date(eingang);
  date.setUTCMonth(date.getUTCMonth() + AUFBEWAHRUNG_MONATE);
  return date;
}

/**
 * Löscht Anfragen, deren Frist abgelaufen ist. Nur die Seite ruft das auf: Sie schreibt die Anfragen.
 * Den Eingang liest sie aus dem Dateinamen, damit auch eine kaputte Datei nicht ewig liegen bleibt.
 */
export async function loescheAlteAnfragen(jetzt = new Date()): Promise<number> {
  const names = await fs.readdir(anfragenDir()).catch(() => [] as string[]);
  let geloescht = 0;
  for (const name of names) {
    const id = name.slice(0, -".json".length);
    if (!name.endsWith(".json") || !ID.test(id)) continue;
    // 2026-11-01T20-49-12Z-abc123 → 2026-11-01T20:49:12Z
    const eingang = id.slice(0, -7).replace(/T(\d\d)-(\d\d)-(\d\d)Z$/, "T$1:$2:$3Z");
    if (Number.isNaN(Date.parse(eingang)) || loeschtAm(eingang) > jetzt) continue;
    await fs.rm(path.join(anfragenDir(), name), { force: true });
    geloescht += 1;
  }
  if (geloescht) console.log(`Anfragen: ${geloescht} nach ${AUFBEWAHRUNG_MONATE} Monaten gelöscht.`);
  return geloescht;
}

/** Alle gespeicherten Anfragen, die neueste zuerst. Für die Redaktion. */
export async function listAnfragen(): Promise<(Omit<Anfrage, "ip"> & { id: string; status: AnfrageStatus; seit?: string; loeschtAm: string })[]> {
  const names = await fs.readdir(anfragenDir()).catch(() => [] as string[]);
  const stand = await readStatus();
  const list = await Promise.all(
    names
      .filter((name) => name.endsWith(".json") && ID.test(name.slice(0, -".json".length)))
      .map(async (name) => {
        const id = name.slice(0, -".json".length);
        try {
          const { ip: _ip, ...data } = JSON.parse(await fs.readFile(path.join(anfragenDir(), name), "utf8")) as Anfrage;
          return { ...data, id, status: stand[id]?.status ?? "neu", seit: stand[id]?.seit, loeschtAm: loeschtAm(data.eingang).toISOString() };
        } catch {
          // Halb geschrieben oder kaputt. Taucht beim nächsten Laden wieder auf.
          return null;
        }
      }),
  );
  return list
    .filter((item) => item != null)
    .sort((a, b) => b.eingang.localeCompare(a.eingang));
}

// Nacheinander schreiben, sonst überholt ein schneller Klick den vorigen.
let statusQueue: Promise<unknown> = Promise.resolve();

export function setAnfrageStatus(id: string, status: string): Promise<void> {
  if (!ID.test(id)) throw new Error("Unbekannte Anfrage");
  if (!STATUS.includes(status as AnfrageStatus)) throw new Error("Unbekannter Stand");
  const next = statusQueue.then(async () => {
    await fs.access(path.join(anfragenDir(), `${id}.json`)).catch(() => {
      throw new Error("Unbekannte Anfrage");
    });
    const stand = await readStatus();
    // Einträge zu gelöschten Anfragen mit aufräumen.
    const da = new Set(await fs.readdir(anfragenDir()).catch(() => [] as string[]));
    for (const alt of Object.keys(stand)) if (!da.has(`${alt}.json`)) delete stand[alt];
    if (status === "neu") delete stand[id];
    else stand[id] = { status: status as AnfrageStatus, seit: new Date().toISOString() };
    const file = path.join(anfragenDir(), STATUS_FILE);
    await fs.writeFile(`${file}.tmp`, `${JSON.stringify(stand, null, 2)}\n`, "utf8");
    await fs.rename(`${file}.tmp`, file);
  });
  statusQueue = next.catch(() => {});
  return next;
}
