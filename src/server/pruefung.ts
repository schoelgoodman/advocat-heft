import { createHash } from "node:crypto";
import { publicPath, type ContentDocument } from "../content/document.ts";
import { loadDocuments } from "../content/load.ts";
import type { PageView } from "../design/layout.ts";
import { DEFAULT_DESCRIPTION } from "../design/seo.ts";
import { pageView } from "../render/build.ts";

/**
 * Was an einer Seite für Google fehlt, nach festen Regeln. Für den Website-Check auf der
 * Startseite der Redaktion und als Lage für den Assistenten: beide sehen dasselbe.
 * Geprüft wird die fertige Seite, wie die Website sie setzt. Titel- und Kartenbilder sind
 * dort Hintergründe ohne Beschreibung, die zählen darum nicht.
 */

export interface Bild {
  /** Der Dateiname, damit die Redaktion zum Bild springen kann. */
  datei: string;
  /** «fehlt»: keine Beschreibung. «dateiname»: nur der Dateiname, etwa aus WordPress. */
  grund: "fehlt" | "dateiname";
  /** Was jetzt dasteht, damit Patrick sieht, warum es nicht zählt. */
  alt: string;
}

export interface Problem {
  art: "thema" | "einstieg" | "bilder";
  /** Kurz, für die Liste auf der Startseite. */
  text: string;
  bilder?: Bild[];
}

export interface Befund {
  rel: string;
  titel: string;
  art: ContentDocument["art"];
  href: string;
  probleme: Problem[];
}

/** «Newsletter11-Marktperformance-1024x220.png» und «Newsletter11 Marktperformance» sind derselbe Name. */
function namensKern(value: string): string {
  return value
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/, "")
    .replace(/-(\d+x\d+|scaled)$/g, "")
    .replace(/-(\d+x\d+|scaled)$/g, "")
    .replace(/[\s_-]+/g, " ")
    .trim();
}

/**
 * Bilder der fertigen Seite, deren Beschreibung fehlt oder nur ihr Dateiname ist.
 * Eine echte Beschreibung zählt, auch wenn sie kurz ist oder Bindestriche hat.
 */
export function bilderOhneBeschreibung(main: string): Bild[] {
  const ohne: Bild[] = [];
  for (const tag of main.match(/<img\b[^>]*>/g) ?? []) {
    const src = /\bsrc="([^"]*)"/.exec(tag)?.[1] ?? "";
    const alt = (/\balt="([^"]*)"/.exec(tag)?.[1] ?? "").trim();
    const datei = decodeURIComponent(src.split("/").pop() ?? src);
    // «1.00» ist das Grössenverhältnis, das der Editor früher statt der Beschreibung schrieb.
    if (!alt || /^\d+(\.\d+)?$/.test(alt)) ohne.push({ datei, grund: "fehlt", alt: "" });
    else if (namensKern(alt) === namensKern(datei)) ohne.push({ datei, grund: "dateiname", alt });
  }
  return ohne;
}

/** Das Thema ist der Titel ohne «Newsletter 36:». */
function thema(titel: string): string {
  return titel.replace(/^Newsletter\s+\d+\s*:?\s*/i, "").trim();
}

export function probleme(doc: Pick<ContentDocument, "art" | "titel">, view: PageView): Problem[] {
  const liste: Problem[] = [];
  if (doc.art === "brief" && !thema(doc.titel)) liste.push({ art: "thema", text: "Ohne Thema" });
  if (view.description === DEFAULT_DESCRIPTION) liste.push({ art: "einstieg", text: "Kein Einstiegsabsatz für Google" });
  const bilder = bilderOhneBeschreibung(view.main);
  if (bilder.length) {
    liste.push({
      art: "bilder",
      text: bilder.length === 1 ? "1 Bild ohne Beschreibung" : `${bilder.length} Bilder ohne Beschreibung`,
      bilder,
    });
  }
  return liste;
}

/** Eine Seite zu setzen kostet etwas. Unveränderte Seiten kommen aus dem Speicher. */
const gemerkt = new Map<string, { schluessel: string; probleme: Problem[] }>();

async function pruefe(doc: ContentDocument): Promise<Problem[]> {
  const schluessel = createHash("sha1").update(`${doc.titel}\n${doc.body}`).digest("hex");
  const alt = gemerkt.get(doc.rel);
  if (alt?.schluessel === schluessel) return alt.probleme;
  const ergebnis = probleme(doc, await pageView(doc));
  gemerkt.set(doc.rel, { schluessel, probleme: ergebnis });
  return ergebnis;
}

/** Wichtigere Seiten zuerst: feste Seiten, dann neuere Newsletter; ein fehlendes Thema vor dem Rest. */
function gewicht(befund: Befund, nummer: number): number {
  const seite = befund.art === "kapitel" ? 10_000 : nummer * 10;
  const schwere = befund.probleme.some((p) => p.art === "thema") ? 3 : befund.probleme.some((p) => p.art === "einstieg") ? 2 : 1;
  return seite + schwere * 100_000;
}

/** Eine Seite, so wie sie gespeichert ist. Für die Hinweise über dem Text in der Redaktion. */
export async function seitenCheck(rel: string): Promise<Problem[]> {
  const doc = (await loadDocuments()).find((item) => item.rel === rel);
  if (!doc || doc.art === "recht") return [];
  return pruefe(doc);
}

/** Alle Seiten, die online sind und sich verbessern lassen. Das Rechtliche bleibt, wie es ist. */
export async function websiteCheck(): Promise<Befund[]> {
  const docs = (await loadDocuments()).filter((doc) => !doc.entwurf && doc.art !== "recht");
  const befunde: { befund: Befund; nummer: number }[] = [];
  for (const doc of docs) {
    const liste = await pruefe(doc);
    if (!liste.length) continue;
    befunde.push({
      befund: { rel: doc.rel, titel: doc.titel, art: doc.art, href: publicPath(doc.rel), probleme: liste },
      nummer: doc.nummer ?? 0,
    });
  }
  for (const rel of gemerkt.keys()) if (!docs.some((doc) => doc.rel === rel)) gemerkt.delete(rel);
  return befunde
    .sort((a, b) => gewicht(b.befund, b.nummer) - gewicht(a.befund, a.nummer))
    .map((eintrag) => eintrag.befund);
}
