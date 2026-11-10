import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { erinnereAnOffene, meldeNachtraeglich } from "./anfrage.ts";

let ordner = "";

beforeEach(async () => {
  ordner = await fs.mkdtemp(path.join(os.tmpdir(), "advocat-anfragen-"));
  process.env.ANFRAGEN_DIR = ordner;
});

// Jeder Test räumt seinen Ordner wieder weg, sonst sammeln sie sich im Temp-Ordner.
afterEach(async () => {
  await fs.rm(ordner, { recursive: true, force: true });
});

/** Eine Anfrage auf der Platte, wie sie das Formular schreibt. */
async function lege(id: string, eingang: string, telegram: string): Promise<string> {
  const file = path.join(ordner, `${id}.json`);
  await fs.writeFile(file, JSON.stringify({ eingang, vorname: "A", name: "B", email: "a@b.ch", nachricht: "Vertraulich", telegram }));
  return file;
}

async function stand(werte: Record<string, string>): Promise<void> {
  const eintraege = Object.entries(werte).map(([id, status]) => [id, { status, seit: "2026-11-01T00:00:00Z" }]);
  await fs.writeFile(path.join(ordner, "_status.json"), JSON.stringify(Object.fromEntries(eintraege)));
}

function bote(antwort: "gesendet" | "fehler" = "gesendet") {
  const texte: string[] = [];
  return { texte, senden: async (text: string) => (texte.push(text), antwort) };
}

const A = "2026-11-02T08-00-00Z-aaaaaa";
const B = "2026-11-02T09-00-00Z-bbbbbb";
const C = "2026-11-02T10-00-00Z-cccccc";
// Mittwoch, 4.11.2026, 9 Uhr Ortszeit. Montag-Anfragen sind da über einen Tag alt.
const MITTWOCH = new Date(2026, 10, 4, 9, 0);

test("Nachholen: eine Nachricht für alle, danach gelten sie als gemeldet", async () => {
  const a = await lege(A, "2026-11-02T08:00:00Z", "fehler");
  await lege(B, "2026-11-02T09:00:00Z", "fehler");
  const { texte, senden } = bote();
  assert.equal(await meldeNachtraeglich(senden), 2);
  assert.equal(texte.length, 1);
  assert.match(texte[0], /^2 neue Anfragen/);
  assert.equal(JSON.parse(await fs.readFile(a, "utf8")).telegram, "gesendet");
  assert.equal(await meldeNachtraeglich(senden), 0);
  assert.equal(texte.length, 1);
});

test("Nachholen: scheitert Telegram wieder, bleibt die Anfrage dran", async () => {
  const a = await lege(A, "2026-11-02T08:00:00Z", "fehler");
  const { senden } = bote("fehler");
  assert.equal(await meldeNachtraeglich(senden), 0);
  assert.equal(JSON.parse(await fs.readFile(a, "utf8")).telegram, "fehler");
});

test("Nachholen: Gelesenes und schon Gemeldetes löst nichts aus", async () => {
  await lege(A, "2026-11-02T08:00:00Z", "fehler");
  await lege(B, "2026-11-02T09:00:00Z", "gesendet");
  await stand({ [A]: "gelesen" });
  const { texte, senden } = bote();
  assert.equal(await meldeNachtraeglich(senden), 0);
  assert.equal(texte.length, 0);
});

test("Erinnerung: Ungelesenes täglich, nur Zahlen, nur einmal am Tag", async () => {
  await lege(A, "2026-11-02T08:00:00Z", "gesendet");
  await lege(B, "2026-11-02T09:00:00Z", "gesendet");
  await lege(C, "2026-11-02T10:00:00Z", "gesendet");
  await stand({ [C]: "erledigt" });
  // Die Wochenübersicht ist schon durch, hier zählt nur der Tag.
  await fs.writeFile(path.join(ordner, "_erinnerung.json"), JSON.stringify({ woche: "2026-11-02" }));
  const { texte, senden } = bote();
  assert.equal(await erinnereAnOffene(MITTWOCH, senden), true);
  assert.match(texte[0], /2 Anfragen sind seit über einem Tag ungelesen\./);
  assert.doesNotMatch(texte[0], /Wochenübersicht|Vertraulich|a@b\.ch/);
  assert.equal(await erinnereAnOffene(new Date(2026, 10, 4, 15, 0), senden), false);
  assert.equal(texte.length, 1);
  assert.equal(await erinnereAnOffene(new Date(2026, 10, 5, 8, 0), senden), true);
  assert.equal(texte.length, 2);
});

test("Erinnerung: Gelesenes, nicht Erledigtes nur einmal die Woche", async () => {
  await lege(A, "2026-11-02T08:00:00Z", "gesendet");
  await lege(B, "2026-11-02T09:00:00Z", "gesendet");
  await stand({ [A]: "gelesen", [B]: "gelesen" });
  const { texte, senden } = bote();
  assert.equal(await erinnereAnOffene(MITTWOCH, senden), true);
  assert.match(texte[0], /Wochenübersicht: 2 gelesene Anfragen sind noch nicht erledigt\./);
  assert.doesNotMatch(texte[0], /ungelesen/);
  // Rest der Woche still, nächsten Montag wieder.
  assert.equal(await erinnereAnOffene(new Date(2026, 10, 5, 9, 0), senden), false);
  assert.equal(await erinnereAnOffene(new Date(2026, 10, 6, 9, 0), senden), false);
  assert.equal(await erinnereAnOffene(new Date(2026, 10, 9, 8, 0), senden), true);
  assert.equal(texte.length, 2);
});

test("Erinnerung: beides am selben Tag kommt in einer Nachricht", async () => {
  await lege(A, "2026-11-02T08:00:00Z", "gesendet");
  await lege(B, "2026-11-02T09:00:00Z", "gesendet");
  await stand({ [B]: "gelesen" });
  const { texte, senden } = bote();
  assert.equal(await erinnereAnOffene(MITTWOCH, senden), true);
  assert.equal(texte.length, 1);
  assert.match(texte[0], /1 Anfrage ist seit über einem Tag ungelesen\. Wochenübersicht: 1 gelesene Anfrage ist noch nicht erledigt\./);
});

test("Erinnerung: wer erst nach dem Wochenblick liest, hört nächste Woche davon", async () => {
  await lege(A, "2026-11-02T08:00:00Z", "gesendet");
  await stand({ [A]: "erledigt" });
  const { texte, senden } = bote();
  // Montag: nichts Gelesenes offen, die Woche ist damit abgehakt.
  assert.equal(await erinnereAnOffene(new Date(2026, 10, 2, 9, 0), senden), false);
  await stand({ [A]: "gelesen" });
  assert.equal(await erinnereAnOffene(MITTWOCH, senden), false);
  assert.equal(await erinnereAnOffene(new Date(2026, 10, 9, 9, 0), senden), true);
  assert.equal(texte.length, 1);
});

test("Erinnerung: nicht nachts, nicht am Wochenende, nicht vor Ablauf eines Tages", async () => {
  await lege(A, "2026-11-02T08:00:00Z", "gesendet");
  const { texte, senden } = bote();
  assert.equal(await erinnereAnOffene(new Date(2026, 10, 4, 7, 59), senden), false);
  assert.equal(await erinnereAnOffene(new Date(2026, 10, 4, 18, 0), senden), false);
  assert.equal(await erinnereAnOffene(new Date(2026, 10, 7, 9, 0), senden), false);
  assert.equal(await erinnereAnOffene(new Date(2026, 10, 2, 12, 0), senden), false);
  assert.equal(texte.length, 0);
});

test("Erinnerung: scheitert Telegram, kommt sie beim nächsten Versuch", async () => {
  await lege(A, "2026-11-02T08:00:00Z", "gesendet");
  assert.equal(await erinnereAnOffene(MITTWOCH, bote("fehler").senden), false);
  assert.equal(await erinnereAnOffene(MITTWOCH, bote().senden), true);
});
