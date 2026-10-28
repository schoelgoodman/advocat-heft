import fs from "node:fs/promises";
import path from "node:path";
import { parseDocument } from "../content/document.ts";
import { commitIfChanged } from "../git/history.ts";
import { contentDir } from "../paths.ts";

/**
 * Einmal laufen lassen: Das Bild ganz oben in einem Newsletter ist die Marktperformance.
 * Es bekommt die Beschreibung «Marktperformance Newsletter N», die Google liest.
 * Nur, wenn Beschreibung oder Dateiname schon von Marktperformance oder Marktdaten sprechen;
 * die Vorsorge-Grafiken in Newsletter 1 und 2 bleiben, wie sie sind. Sonst ändert sich nichts.
 * Zweimal laufen lassen schadet nicht. Mit --nur-zeigen wird nichts geschrieben.
 *
 * Auf Neo im Container der Redaktion: docker exec advocat-redaktion node --import tsx src/cli/marktperformance.ts
 */

const BILD = /^!\[((?:[^\]\\]|\\.)*)\]\((\S+?)(?:\s+"((?:[^"\\]|\\.)*)")?\)[ \t]*$/;
const MARKT = /markt[\s_-]*(performance|daten)/i;

const nurZeigen = process.argv.includes("--nur-zeigen");
const ordner = path.join(contentDir(), "briefe");
const geaendert: string[] = [];

for (const name of (await fs.readdir(ordner)).sort()) {
  if (!name.endsWith(".md") || name === "README.md") continue;
  const rel = `briefe/${name}`;
  const raw = await fs.readFile(path.join(ordner, name), "utf8");
  const doc = parseDocument(raw, rel);
  if (doc.nummer == null) continue;
  const zeile = doc.body.split("\n").find((line) => line.trim()) ?? "";
  const bild = BILD.exec(zeile.trim());
  if (!bild) continue;
  const [, alt, src, titel = ""] = bild;
  // Der Editor schrieb früher «1.00» als Beschreibung und die eigentliche in den Titel.
  const jetzt = /^\d+(\.\d+)?$/.test(alt) ? titel : alt;
  if (!MARKT.test(`${jetzt} ${src}`)) continue;
  const soll = `Marktperformance Newsletter ${doc.nummer}`;
  const neu = `![${soll}](${src})`;
  if (zeile.trim() === neu) continue;
  console.log(`Nr. ${String(doc.nummer).padStart(2)}  «${jetzt}» → «${soll}»`);
  if (nurZeigen) continue;
  await fs.writeFile(path.join(ordner, name), raw.replace(zeile, neu), "utf8");
  geaendert.push(rel);
}

if (nurZeigen) {
  console.log("Nur gezeigt, nichts geschrieben.");
} else if (geaendert.length) {
  const sha = await commitIfChanged("Bildbeschreibungen: Marktperformance Newsletter N", geaendert);
  console.log(`${geaendert.length} Newsletter geändert${sha ? `, Fassung ${sha.slice(0, 7)}` : ""}.`);
} else {
  console.log("Alles schon richtig, nichts geändert.");
}
