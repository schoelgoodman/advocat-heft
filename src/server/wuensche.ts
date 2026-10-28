import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { chatDir } from "../paths.ts";
import { sendTelegram } from "./anfrage.ts";

/**
 * Wünsche von Patrick an die Betreuung der Website: am Aussehen der Website (design)
 * oder an der Redaktion (funktion). Jeder geht per Telegram hinaus und bleibt hier
 * gespeichert, damit Patrick sieht, was daraus geworden ist.
 */

export type WunschArt = "design" | "funktion";
export type WunschStatus = "offen" | "erledigt";

export interface Wunsch {
  id: string;
  art: WunschArt;
  text: string;
  /** Die Seite, die beim Schreiben offen war. */
  seite: string;
  eingang: string;
  status: WunschStatus;
  erledigtAm?: string;
  telegram: "gesendet" | "fehler" | "aus";
  /** Der Anfang des Vorschlags im Assistenten, damit dessen Karte weiss, dass er gesendet ist. */
  quelle?: string;
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
  design: "Designwunsch",
  funktion: "Funktionswunsch",
};

function telegramText(wunsch: Wunsch): string {
  return [
    `${ART_TITEL[wunsch.art]} aus der Redaktion`,
    ...(wunsch.seite ? [`Seite: ${wunsch.seite}`] : []),
    "",
    // Telegram bekommt reinen Text. Sterne aus dem Markdown stören dort nur.
    wunsch.text.replace(/\*\*(.+?)\*\*/g, "$1"),
    "",
    `Steht in der Redaktion unter «Wünsche» (${wunsch.id}).`,
  ].join("\n").slice(0, 4000);
}

function art(value: unknown): WunschArt {
  return value === "design" ? "design" : "funktion";
}

/** Speichert den Wunsch und schickt ihn per Telegram. Scheitert Telegram, bleibt er trotzdem gespeichert. */
export async function neuerWunsch(payload: unknown): Promise<Wunsch> {
  const raw = (payload ?? {}) as Record<string, unknown>;
  const text = String(raw.text ?? "").replace(/\r\n?/g, "\n").trim().slice(0, MAX_TEXT);
  if (!text) throw new Error("Bitte den Wunsch beschreiben.");
  const wunsch: Wunsch = {
    id: `W-${new Date().toISOString().slice(2, 10).replaceAll("-", "")}-${randomBytes(2).toString("hex")}`,
    art: art(raw.art),
    text,
    seite: String(raw.seite ?? "").trim().slice(0, 300),
    eingang: new Date().toISOString(),
    status: "offen",
    telegram: "aus",
    ...(raw.quelle ? { quelle: String(raw.quelle).slice(0, 200) } : {}),
  };
  wunsch.telegram = await sendTelegram(telegramText(wunsch));
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
  const telegram = nochmals ? await sendTelegram(telegramText(vorher)) : null;
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
      return `- ${w.eingang.slice(0, 10)} · ${ART_TITEL[w.art]} · ${stand}: ${kurz}`;
    })
    .join("\n");
}
