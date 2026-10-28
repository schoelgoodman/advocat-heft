import fs from "node:fs/promises";
import type http from "node:http";
import path from "node:path";
import { briefsNewestFirst, loadDocuments } from "../content/load.ts";
import type { ContentDocument } from "../content/document.ts";
import { chatDir } from "../paths.ts";
import { sendTelegram } from "./anfrage.ts";
import { ANLEITUNG } from "./anleitung.ts";

/**
 * Der Assistent in der Redaktion. Ein Sprachmodell bei xAI, ohne Werkzeuge:
 * Es bekommt die Anleitung, die offene Seite und frühere Newsletter mitgeschickt
 * und kann nur antworten. Ändern, speichern und senden tut immer Patrick per Knopf.
 */

/** Ohne XAI_BASE_URL direkt bei xAI. Die Variable ist für Tests gegen einen Ersatz. */
function xaiUrl(): string {
  return `${(process.env.XAI_BASE_URL?.trim() || "https://api.x.ai/v1").replace(/\/+$/, "")}/chat/completions`;
}

function apiKey(): string {
  return process.env.XAI_API_KEY?.trim() ?? "";
}

function modell(): string {
  return process.env.XAI_MODEL?.trim() || "grok-4.7";
}

/**
 * Wie lange das Modell vor dem Schreiben nachdenkt. Mit „high“ wartet Patrick bei einem
 * ganzen Newsletter fast eine Minute auf das erste Wort, mit „low“ etwa zehn Sekunden.
 * Leer: nicht mitschicken, für Modelle ohne Nachdenken.
 */
function denken(): string {
  return process.env.XAI_REASONING_EFFORT?.trim() ?? "low";
}

export function assistentBereit(): boolean {
  return apiKey() !== "";
}

export interface Nachricht {
  rolle: "patrick" | "assistent";
  text: string;
  zeit: string;
  /** Die Seite, die beim Schreiben offen war. Vorschläge gehören zu ihr. */
  rel?: string;
}

/** Was Patrick gerade vor sich hat. Kommt vom Browser, weil ungespeicherte Änderungen zählen. */
export interface Lage {
  ansicht: "start" | "anfragen" | "briefe" | "blatt";
  rel?: string;
  art?: ContentDocument["art"];
  titel?: string;
  datum?: string;
  entwurf?: boolean;
  body?: string;
  auswahl?: string;
}

const VERLAUF = "verlauf.json";
/** So viel bleibt gespeichert. Ans Modell gehen nur die letzten Nachrichten. */
const MAX_GESPEICHERT = 300;
const MAX_IM_GESPRAECH = 24;
const MAX_NACHRICHT = 8000;
const MAX_TEXT = 120_000;
/** Die neuesten veröffentlichten Newsletter gehen ganz mit, als Vorbild für Ton und Aufbau. */
const VORBILDER = 3;

function verlaufFile(): string {
  return path.join(chatDir(), VERLAUF);
}

export async function readVerlauf(): Promise<Nachricht[]> {
  try {
    return JSON.parse(await fs.readFile(verlaufFile(), "utf8")) as Nachricht[];
  } catch {
    return [];
  }
}

async function writeVerlauf(verlauf: Nachricht[]): Promise<void> {
  const file = verlaufFile();
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(`${file}.tmp`, `${JSON.stringify(verlauf.slice(-MAX_GESPEICHERT), null, 2)}\n`, "utf8");
  await fs.rename(`${file}.tmp`, file);
}

export async function clearVerlauf(): Promise<void> {
  await writeVerlauf([]);
}

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.slice(0, max) : "";
}

function cleanLage(value: unknown): Lage {
  const raw = (value ?? {}) as Record<string, unknown>;
  const ansicht = raw.ansicht === "blatt" || raw.ansicht === "anfragen" || raw.ansicht === "briefe" ? raw.ansicht : "start";
  if (ansicht !== "blatt") return { ansicht };
  return {
    ansicht,
    rel: text(raw.rel, 300),
    art: raw.art === "brief" || raw.art === "kapitel" || raw.art === "recht" ? raw.art : undefined,
    titel: text(raw.titel, 300),
    datum: text(raw.datum, 20),
    entwurf: raw.entwurf === true,
    body: text(raw.body, MAX_TEXT),
    auswahl: text(raw.auswahl, 4000),
  };
}

function briefKopf(doc: ContentDocument): string {
  return `Nr. ${doc.nummer ?? "?"} · ${doc.datum} · ${doc.titel}${doc.entwurf ? " (Entwurf)" : ""}`;
}

/** Die Lage als Text fürs Modell: wo Patrick ist, was offen ist, und die Vorbilder. */
async function lageText(lage: Lage, frage: string): Promise<string> {
  const teile: string[] = ["# Lage"];
  if (lage.ansicht === "start") teile.push("Patrick ist auf der Startseite der Redaktion. Keine Seite ist offen.");
  if (lage.ansicht === "anfragen") teile.push("Patrick ist in der Kontaktaufnahme. Keine Seite ist offen.");
  if (lage.ansicht === "briefe") teile.push("Patrick ist in der Übersicht aller Newsletter. Keine Seite ist offen.");
  if (lage.ansicht === "blatt") {
    const art = lage.art === "brief" ? "Newsletter" : lage.art === "recht" ? "Rechtliche Seite" : "Feste Seite";
    teile.push(
      `Offen: ${art} «${lage.titel}» (${lage.rel}), ${lage.entwurf ? "Entwurf, nur in der Redaktion sichtbar" : "online"}${lage.art === "brief" ? `, Datum ${lage.datum}` : ""}.`,
    );
    if (lage.auswahl?.trim()) teile.push(`Patrick hat diese Stelle markiert:\n"""\n${lage.auswahl.trim()}\n"""`);
    teile.push(lage.body?.trim() ? `Der Text der offenen Seite als Markdown:\n"""\n${lage.body}\n"""` : "Der Text der offenen Seite ist noch leer.");
  }

  const briefe = briefsNewestFirst(await loadDocuments().catch(() => []));
  if (briefe.length) {
    teile.push(`# Alle Newsletter\n${briefe.map(briefKopf).join("\n")}`);
    // Nennt Patrick einen Newsletter mit Nummer, geht der auch ganz mit.
    const genannt = new Set([...frage.matchAll(/(?:newsletter|nr\.?|nummer)\s*(\d{1,3})/gi)].map((m) => Number(m[1])));
    const vorbilder = briefe.filter((doc) => !doc.entwurf && doc.rel !== lage.rel).slice(0, VORBILDER);
    const ganz = [...vorbilder, ...briefe.filter((doc) => genannt.has(doc.nummer ?? -1) && !vorbilder.includes(doc))];
    teile.push(
      "# Frühere Newsletter im Wortlaut\nDie neuesten veröffentlichten als Vorbild für Ton, Länge und Aufbau, dazu jeder, den Patrick mit Nummer nennt.",
      ...ganz.map((doc) => `## ${briefKopf(doc)}\n"""\n${doc.body.trim()}\n"""`),
    );
  }
  return teile.join("\n\n");
}

function sse(res: http.ServerResponse, payload: Record<string, unknown>): void {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

/** Liest den Datenstrom von xAI und gibt jedes Stück Text weiter. */
async function* stream(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true });
    let end: number;
    while ((end = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, end).trim();
      buffer = buffer.slice(end + 1);
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") return;
      try {
        const json = JSON.parse(data) as { choices?: { delta?: { content?: string } }[] };
        const piece = json.choices?.[0]?.delta?.content;
        if (piece) yield piece;
      } catch {
        // Unvollständige oder fremde Zeile.
      }
    }
  }
}

/**
 * POST /api/chat. Antwortet als Server-Sent Events: `{text}` für jedes Stück,
 * am Ende `{fertig: true}` oder `{fehler}`. Frage und Antwort kommen in den Verlauf.
 */
export async function handleChat(payload: unknown, res: http.ServerResponse): Promise<void> {
  const raw = (payload ?? {}) as Record<string, unknown>;
  const frage = text(raw.nachricht, MAX_NACHRICHT).trim();
  if (!frage) throw new Error("Leere Nachricht");
  if (!assistentBereit()) throw new Error("Der Assistent ist nicht eingerichtet: XAI_API_KEY fehlt.");
  const lage = cleanLage(raw.lage);
  // Patrick wählt in der Spalte „Schnell“ oder „Gründlich“. Ohne Nachdenken (leere Variable) gilt die Wahl nicht.
  const effort = denken() ? (raw.denken === "high" || raw.denken === "low" ? raw.denken : denken()) : "";

  const verlauf = await readVerlauf();
  const jetzt: Nachricht = { rolle: "patrick", text: frage, zeit: new Date().toISOString(), rel: lage.rel || undefined };
  const messages = [
    { role: "system", content: ANLEITUNG },
    { role: "system", content: await lageText(lage, frage) },
    ...verlauf.slice(-MAX_IM_GESPRAECH).map((n) => ({ role: n.rolle === "patrick" ? "user" : "assistant", content: n.text })),
    { role: "user", content: frage },
  ];

  // Schliesst Patrick das Fenster, bricht auch die Anfrage bei xAI ab.
  const abbruch = new AbortController();
  res.on("close", () => abbruch.abort());
  const timeout = AbortSignal.timeout(180_000);

  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-store",
    // SWAG (nginx) soll nicht puffern, sonst kommt die Antwort erst am Ende.
    "x-accel-buffering": "no",
  });

  let antwort = "";
  let fehler = "";
  try {
    const response = await fetch(xaiUrl(), {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey()}` },
      body: JSON.stringify({ model: modell(), messages, stream: true, ...(effort ? { reasoning_effort: effort } : {}) }),
      signal: AbortSignal.any([abbruch.signal, timeout]),
    });
    if (!response.ok || !response.body) {
      const detail = (await response.text().catch(() => "")).slice(0, 300);
      console.error(`Assistent: xAI ${response.status} ${detail}`);
      fehler = response.status === 401 || response.status === 403
        ? "Der Schlüssel für xAI wird nicht angenommen."
        : response.status === 429
          ? "xAI meldet zu viele Anfragen oder kein Guthaben. Bitte später nochmals."
          : `xAI antwortet nicht (${response.status}).`;
    } else {
      for await (const piece of stream(response.body)) {
        antwort += piece;
        sse(res, { text: piece });
      }
    }
  } catch (error) {
    if (abbruch.signal.aborted) fehler = "Abgebrochen.";
    else {
      console.error("Assistent:", error instanceof Error ? error.message : error);
      fehler = timeout.aborted ? "Die Antwort hat zu lange gedauert." : "Keine Verbindung zu xAI.";
    }
  }

  const neu: Nachricht[] = [jetzt];
  if (antwort.trim()) neu.push({ rolle: "assistent", text: antwort, zeit: new Date().toISOString(), rel: jetzt.rel });
  await writeVerlauf([...(await readVerlauf()), ...neu]).catch((error: unknown) => {
    console.error("Assistent: Verlauf nicht gespeichert:", error instanceof Error ? error.message : error);
  });

  if (!res.writableEnded) {
    sse(res, fehler ? { fehler } : { fertig: true });
    res.end();
  }
}

/** POST /api/designwunsch. Geht per Telegram an die Betreuung der Website. */
export async function sendDesignwunsch(payload: unknown): Promise<"gesendet" | "fehler" | "aus"> {
  const raw = (payload ?? {}) as Record<string, unknown>;
  const wunsch = text(raw.wunsch, 3000).trim();
  if (!wunsch) throw new Error("Leerer Wunsch");
  const seite = text(raw.titel, 300).trim();
  const kopf = seite ? ["Designwunsch aus der Redaktion", `Seite: ${seite}`] : ["Designwunsch aus der Redaktion"];
  return sendTelegram([...kopf, "", wunsch].join("\n"));
}
