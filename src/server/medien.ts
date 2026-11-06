import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import type http from "node:http";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { textVon, type ContentDocument } from "../content/document.ts";
import { loadDocuments, loadPapierkorb } from "../content/load.ts";
import { FESTE_BILDER } from "../design/layout.ts";
import { contentDir } from "../paths.ts";

/** Die Übersicht der Bilder in der Redaktion: was es gibt und wo es gebraucht wird. */

export interface Verwendung {
  titel: string;
  rel: string;
  papierkorb: boolean;
}

export interface Medium {
  name: string;
  groesse: number;
  /** Fest im Code der Website (die Karten unter jedem Newsletter). */
  fest: boolean;
  verwendet: Verwendung[];
}

const NAME = /^[^/\\\0]+$/;

/** Ein Dateiname direkt unter media/, sonst ein Fehler. */
export function medienName(wert: unknown): string {
  const name = String(wert ?? "");
  if (!NAME.test(name) || name.startsWith(".") || name.includes("..")) throw new Error("Ungültiger Dateiname");
  return name;
}

/** Alle Bilder, auf die ein Text oder Feld zeigt. */
export function bilderIn(text: string): string[] {
  const namen = new Set<string>();
  for (const treffer of text.matchAll(/media\/([^\s)"'\\/<>]+)/g)) {
    try {
      namen.add(decodeURIComponent(treffer[1]));
    } catch {
      namen.add(treffer[1]);
    }
  }
  return [...namen];
}

function bilderVon(doc: ContentDocument): string[] {
  return bilderIn(`${textVon(doc)}\n${JSON.stringify(doc.felder ?? null)}`);
}

export async function listeMedien(): Promise<Medium[]> {
  const ordner = path.join(contentDir(), "media");
  const eintraege = await fs.readdir(ordner, { withFileTypes: true }).catch(() => []);
  const wo = new Map<string, Verwendung[]>();
  const merke = (doc: ContentDocument, papierkorb: boolean) => {
    for (const name of bilderVon(doc)) {
      const liste = wo.get(name) ?? [];
      liste.push({ titel: doc.titel, rel: doc.rel, papierkorb });
      wo.set(name, liste);
    }
  };
  for (const doc of await loadDocuments()) merke(doc, false);
  for (const doc of await loadPapierkorb()) merke(doc, true);
  const liste: Medium[] = [];
  for (const eintrag of eintraege) {
    if (!eintrag.isFile() || eintrag.name.startsWith(".")) continue;
    const { size } = await fs.stat(path.join(ordner, eintrag.name));
    liste.push({ name: eintrag.name, groesse: size, fest: FESTE_BILDER.includes(eintrag.name), verwendet: wo.get(eintrag.name) ?? [] });
  }
  return liste.sort((a, b) => a.name.localeCompare(b.name, "de"));
}

/** Löschen geht nur, wenn nichts das Bild braucht, auch nichts im Papierkorb. */
export async function pruefeLoeschbar(name: string): Promise<void> {
  const medium = (await listeMedien()).find((eintrag) => eintrag.name === name);
  if (!medium) throw new Error("Dieses Bild gibt es nicht mehr.");
  if (medium.fest) throw new Error("Dieses Bild gehört fest zur Website.");
  if (medium.verwendet.length) throw new Error(`Dieses Bild wird noch gebraucht: ${[...new Set(medium.verwendet.map((v) => v.titel))].join(", ")}.`);
}

const vorschauOrdner = path.join(os.tmpdir(), "advocat-vorschau");

/** Eine kleine Vorschau, damit die Übersicht nicht alle Originale lädt. Sie liegt in /tmp und darf verschwinden. */
export async function sendeVorschau(wertName: unknown, breite: number, res: http.ServerResponse): Promise<void> {
  const name = medienName(wertName);
  const datei = path.join(contentDir(), "media", name);
  const stat = await fs.stat(datei);
  const w = [240, 480].find((x) => x >= breite) ?? 480;
  const schluessel = createHash("sha1").update(`${name}|${stat.mtimeMs}|${stat.size}|${w}`).digest("hex");
  const ablage = path.join(vorschauOrdner, `${schluessel}.webp`);
  let daten = await fs.readFile(ablage).catch(() => null);
  if (!daten) {
    daten = await sharp(datei, { limitInputPixels: 50_000_000 }).rotate().resize({ width: w, height: w, fit: "inside", withoutEnlargement: true }).webp({ quality: 72 }).toBuffer();
    await fs.mkdir(vorschauOrdner, { recursive: true });
    await fs.writeFile(ablage, daten);
  }
  res.writeHead(200, { "content-type": "image/webp", "cache-control": "private, max-age=86400" });
  res.end(daten);
}
