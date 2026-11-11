import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { chatDir } from "../paths.ts";
import { sendTelegram } from "./anfrage.ts";
import { bildArt, verarbeiteBild } from "./bilder.ts";

/**
 * Wünsche von Patrick an die Betreuung der Website: am Aussehen der Website (design),
 * an der Redaktion (funktion) oder ein Fehler in der Redaktion (fehler). Jeder geht per
 * Telegram hinaus und bleibt hier gespeichert, damit Patrick sieht, was daraus geworden ist.
 */

export type WunschArt = "design" | "funktion" | "fehler";
export type WunschStatus = "offen" | "erledigt";

export interface Wunsch {
  id: string;
  art: WunschArt;
  text: string;
  /** Die Seite, die beim Schreiben offen war. */
  seite: string;
  /** Bei einem Fehler: Browser und Gerät, damit er sich nachstellen lässt. */
  geraet?: string;
  eingang: string;
  status: WunschStatus;
  erledigtAm?: string;
  telegram: "gesendet" | "fehler" | "aus";
  /** Der Anfang des Vorschlags im Assistenten, damit dessen Karte weiss, dass er gesendet ist. */
  quelle?: string;
  /** Bildschirmfotos, Fotos und PDF, die Patrick mitgeschickt hat. */
  anhaenge?: Anhang[];
}

/**
 * Ein Anhang zu einem Wunsch. Die Datei liegt neben `wuensche.json`, nie in den Medien der Website:
 * Ein Bildschirmfoto der Redaktion hat auf der öffentlichen Seite nichts verloren.
 */
export interface Anhang {
  /** Der Dateiname auf der Platte, vom Server vergeben. */
  id: string;
  /** Wie die Datei bei Patrick hiess. Nur zur Anzeige. */
  name: string;
  typ: string;
  groesse: number;
}

export const MAX_ANHAENGE = 5;
export const MAX_ANHANG = 10 * 1024 * 1024;
const ANHANG_ORDNER = "wuensche-anhaenge";
const ANHANG_ID = /^[a-f0-9]{16}\.(jpg|png|webp|gif|heic|pdf)$/;
const ANHANG_TYP: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".heic": "image/heic",
  ".pdf": "application/pdf",
};
/** Hochgeladen, aber nie gesendet: nach einem Tag weg. */
const VERWAIST_NACH = 24 * 60 * 60 * 1000;

function anhangOrdner(): string {
  return path.join(chatDir(), ANHANG_ORDNER);
}

function anzeigeName(name: string, endung: string): string {
  const sauber = path
    .basename(name.replaceAll("\\", "/"))
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, 120);
  if (!sauber) return `anhang${endung}`;
  // Aus einem WebP oder HEIC kann beim Säubern nichts anderes werden, aus «.jpeg» aber «.jpg».
  const alt = path.extname(sauber).toLowerCase();
  const gleich = alt === endung || (endung === ".jpg" && alt === ".jpeg") || (endung === ".heic" && alt === ".heif");
  return gleich ? sauber : `${sauber.slice(0, sauber.length - path.extname(sauber).length)}${endung}`;
}

/**
 * Nimmt eine Datei für einen Wunsch entgegen. Was sie ist, entscheiden ihre ersten Bytes. Fotos und
 * Bildschirmfotos gehen durch sharp (ohne GPS und andere Metadaten, höchstens 2560 px), ein PDF und
 * ein HEIC bleiben, wie sie sind. Zum Wunsch gehört die Datei erst, wenn er gesendet wird.
 */
export async function speichereAnhang(daten: Buffer, name: string): Promise<Anhang> {
  if (daten.length === 0) throw new Error("Die Datei ist leer.");
  if (daten.length > MAX_ANHANG) throw new Error("Die Datei ist zu gross (höchstens 10 MB).");
  const art = bildArt(daten);
  let endung: string;
  let inhalt = daten;
  if (art === "heic") endung = ".heic";
  else if (art && art !== "svg") {
    const bild = await verarbeiteBild(daten);
    endung = bild.endung;
    inhalt = bild.daten;
  } else if (daten.subarray(0, 5).toString("latin1") === "%PDF-") endung = ".pdf";
  else throw new Error("Nur Bilder (JPG, PNG, WebP, GIF, HEIC) und PDF.");
  const id = `${randomBytes(8).toString("hex")}${endung}`;
  await fs.mkdir(anhangOrdner(), { recursive: true });
  await fs.writeFile(path.join(anhangOrdner(), id), inhalt);
  void raeumeAnhaenge().catch(() => {});
  return { id, name: anzeigeName(name, endung), typ: ANHANG_TYP[endung]!, groesse: inhalt.length };
}

/** Die Datei zu einem Anhang, für die Karte in der Redaktion. */
export async function leseAnhang(id: string): Promise<{ daten: Buffer; typ: string; name: string }> {
  if (!ANHANG_ID.test(id)) throw new Error("Unbekannter Anhang");
  const daten = await fs.readFile(path.join(anhangOrdner(), id)).catch(() => null);
  if (!daten) throw new Error("Unbekannter Anhang");
  const bekannt = (await listWuensche()).flatMap((w) => w.anhaenge ?? []).find((a) => a.id === id);
  return { daten, typ: ANHANG_TYP[path.extname(id)]!, name: bekannt?.name ?? id };
}

/** Löscht, was hochgeladen, aber nie mit einem Wunsch gesendet wurde. */
export async function raeumeAnhaenge(jetzt = Date.now()): Promise<number> {
  const dateien = await fs.readdir(anhangOrdner()).catch(() => [] as string[]);
  if (!dateien.length) return 0;
  const gebraucht = new Set((await listWuensche()).flatMap((w) => w.anhaenge ?? []).map((a) => a.id));
  let weg = 0;
  for (const datei of dateien) {
    if (gebraucht.has(datei)) continue;
    const pfad = path.join(anhangOrdner(), datei);
    const stand = await fs.stat(pfad).catch(() => null);
    if (!stand || jetzt - stand.mtimeMs < VERWAIST_NACH) continue;
    await fs.rm(pfad, { force: true });
    weg += 1;
  }
  return weg;
}

/** Was der Browser als Anhänge nennt: nur, was wirklich hochgeladen wurde, und jede Datei nur einmal. */
async function anhaengeAus(value: unknown): Promise<Anhang[]> {
  if (!Array.isArray(value) || value.length === 0) return [];
  if (value.length > MAX_ANHAENGE) throw new Error(`Höchstens ${MAX_ANHAENGE} Anhänge pro Nachricht.`);
  const liste: Anhang[] = [];
  for (const eintrag of value as Record<string, unknown>[]) {
    const id = String(eintrag?.id ?? "");
    if (!ANHANG_ID.test(id) || liste.some((a) => a.id === id)) continue;
    const stand = await fs.stat(path.join(anhangOrdner(), id)).catch(() => null);
    if (!stand) throw new Error("Ein Anhang ist nicht mehr da. Bitte nochmals anhängen.");
    const endung = path.extname(id);
    liste.push({ id, name: anzeigeName(String(eintrag.name ?? ""), endung), typ: ANHANG_TYP[endung]!, groesse: stand.size });
  }
  return liste;
}

type TelegramStand = "gesendet" | "fehler" | "aus";

/** Schickt eine Datei an Telegram: ein Foto als Foto, alles andere (und was als Foto nicht geht) als Dokument. */
async function sendTelegramDatei(anhang: Anhang, daten: Buffer, text: string): Promise<TelegramStand> {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const chat = process.env.TELEGRAM_CHAT_ID?.trim();
  if (!token || !chat) return "aus";
  const alsFoto = ["image/jpeg", "image/png", "image/webp"].includes(anhang.typ);
  for (const weg of alsFoto ? (["sendPhoto", "sendDocument"] as const) : (["sendDocument"] as const)) {
    try {
      const form = new FormData();
      form.set("chat_id", chat);
      form.set("caption", text.slice(0, 1000));
      form.set(weg === "sendPhoto" ? "photo" : "document", new Blob([new Uint8Array(daten)], { type: anhang.typ }), anhang.name);
      const response = await fetch(`https://api.telegram.org/bot${token}/${weg}`, { method: "POST", body: form, signal: AbortSignal.timeout(60_000) });
      if (response.ok) return "gesendet";
      console.error(`Telegram (${weg}): ${response.status} ${(await response.text()).slice(0, 200)}`);
    } catch (error) {
      console.error(`Telegram (${weg}):`, error instanceof Error ? error.message : error);
    }
  }
  return "fehler";
}

/** Erst der Text, dann jede Datei. Fehlt am Schluss etwas, heisst der Stand «fehler» und Patrick kann nochmals senden. */
async function sendeWunsch(wunsch: Wunsch): Promise<TelegramStand> {
  const stand = await sendTelegram(telegramText(wunsch));
  if (stand !== "gesendet") return stand;
  const anhaenge = wunsch.anhaenge ?? [];
  for (const [i, anhang] of anhaenge.entries()) {
    const daten = await fs.readFile(path.join(anhangOrdner(), anhang.id)).catch(() => null);
    if (!daten) return "fehler";
    const titel = `${wunsch.id} · Anhang ${i + 1} von ${anhaenge.length}: ${anhang.name}`;
    if ((await sendTelegramDatei(anhang, daten, titel)) !== "gesendet") return "fehler";
  }
  return "gesendet";
}

const DATEI = "wuensche.json";
const MAX_TEXT = 6000;

function datei(): string {
  return path.join(chatDir(), DATEI);
}

export async function listWuensche(): Promise<Wunsch[]> {
  try {
    const liste = JSON.parse(await fs.readFile(datei(), "utf8")) as Wunsch[];
    return liste.sort((a, b) => b.eingang.localeCompare(a.eingang));
  } catch {
    return [];
  }
}

// Nacheinander schreiben, sonst überholt ein schneller Klick den vorigen.
let queue: Promise<unknown> = Promise.resolve();

function aendere<T>(fn: (liste: Wunsch[]) => Promise<T> | T): Promise<T> {
  const next = queue.then(async () => {
    const liste = await listWuensche();
    const ergebnis = await fn(liste);
    await fs.mkdir(chatDir(), { recursive: true });
    await fs.writeFile(`${datei()}.tmp`, `${JSON.stringify(liste, null, 2)}\n`, "utf8");
    await fs.rename(`${datei()}.tmp`, datei());
    return ergebnis;
  });
  queue = next.catch(() => {});
  return next;
}

const ART_TITEL: Record<WunschArt, string> = {
  funktion: "Feature",
  fehler: "Bug",
  design: "Styling",
};

function telegramText(wunsch: Wunsch): string {
  return [
    `${ART_TITEL[wunsch.art]} aus der Redaktion`,
    ...(wunsch.seite ? [`Seite: ${wunsch.seite}`] : []),
    ...(wunsch.geraet ? [`Gerät: ${wunsch.geraet}`] : []),
    "",
    // Telegram bekommt reinen Text. Sterne aus dem Markdown stören dort nur.
    wunsch.text.replace(/\*\*(.+?)\*\*/g, "$1"),
    "",
    ...(wunsch.anhaenge?.length ? [wunsch.anhaenge.length === 1 ? "1 Anhang folgt." : `${wunsch.anhaenge.length} Anhänge folgen.`] : []),
    `Steht in der Redaktion unter «Support» (${wunsch.id}).`,
  ].join("\n").slice(0, 4000);
}

function art(value: unknown): WunschArt {
  return value === "design" || value === "fehler" ? value : "funktion";
}

/** Speichert den Wunsch und schickt ihn per Telegram. Scheitert Telegram, bleibt er trotzdem gespeichert. */
export async function neuerWunsch(payload: unknown): Promise<Wunsch> {
  const raw = (payload ?? {}) as Record<string, unknown>;
  const text = String(raw.text ?? "").replace(/\r\n?/g, "\n").trim().slice(0, MAX_TEXT);
  const wunschArt = art(raw.art);
  if (!text) throw new Error(wunschArt === "fehler" ? "Bitte den Bug beschreiben." : "Bitte beschreiben, worum es geht.");
  const anhaenge = await anhaengeAus(raw.anhaenge);
  const wunsch: Wunsch = {
    id: `W-${new Date().toISOString().slice(2, 10).replaceAll("-", "")}-${randomBytes(2).toString("hex")}`,
    art: wunschArt,
    text,
    seite: String(raw.seite ?? "").trim().slice(0, 300),
    ...(wunschArt === "fehler" && raw.geraet ? { geraet: String(raw.geraet).slice(0, 300) } : {}),
    eingang: new Date().toISOString(),
    status: "offen",
    telegram: "aus",
    ...(raw.quelle ? { quelle: String(raw.quelle).slice(0, 200) } : {}),
    ...(anhaenge.length ? { anhaenge } : {}),
  };
  wunsch.telegram = await sendeWunsch(wunsch);
  await aendere((liste) => {
    liste.push(wunsch);
  });
  return wunsch;
}

/** Stand ändern oder Telegram nochmals versuchen. */
export async function aendereWunsch(payload: unknown): Promise<Wunsch> {
  const raw = (payload ?? {}) as Record<string, unknown>;
  const id = String(raw.id ?? "");
  const nochmals = raw.aktion === "senden";
  const vorher = (await listWuensche()).find((w) => w.id === id);
  if (!vorher) throw new Error("Unbekannter Wunsch");
  const telegram = nochmals ? await sendeWunsch(vorher) : null;
  return aendere((liste) => {
    const wunsch = liste.find((w) => w.id === id);
    if (!wunsch) throw new Error("Unbekannter Wunsch");
    if (telegram) wunsch.telegram = telegram;
    if (raw.status === "offen" || raw.status === "erledigt") {
      wunsch.status = raw.status;
      if (raw.status === "erledigt") wunsch.erledigtAm = new Date().toISOString();
      else delete wunsch.erledigtAm;
    }
    return wunsch;
  });
}

/** Für den Assistenten: die Wünsche in Kurzform, damit er Fragen dazu beantworten kann. */
export async function wuenscheText(): Promise<string> {
  const liste = await listWuensche();
  if (!liste.length) return "Patrick hat noch keine Wünsche geschickt.";
  return liste
    .slice(0, 30)
    .map((w) => {
      const kurz = w.text.replace(/\s+/g, " ").slice(0, 200);
      const stand = w.status === "erledigt" ? `erledigt am ${w.erledigtAm?.slice(0, 10)}` : "offen";
      const dabei = w.anhaenge?.length ? ` (${w.anhaenge.length === 1 ? "1 Anhang" : `${w.anhaenge.length} Anhänge`})` : "";
      return `- ${w.eingang.slice(0, 10)} · ${ART_TITEL[w.art]} · ${stand}: ${kurz}${dabei}`;
    })
    .join("\n");
}

/**
 * Löscht alle Wünsche samt ihren Anhängen, auch offene. Nur auf Patricks ausdrücklichen Wunsch
 * («Allgemein», «Redaktion», «Daten löschen»). Was schon per Telegram hinausging, bleibt dort.
 */
export function loescheWuensche(): Promise<number> {
  return aendere(async (liste) => {
    const anzahl = liste.length;
    for (const anhang of liste.flatMap((w) => w.anhaenge ?? [])) {
      if (ANHANG_ID.test(anhang.id)) await fs.rm(path.join(anhangOrdner(), anhang.id), { force: true });
    }
    liste.length = 0;
    return anzahl;
  });
}
