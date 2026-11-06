import fs from "node:fs/promises";
import path from "node:path";
import { commitIfChanged } from "../git/history.ts";
import { contentDir } from "../paths.ts";
import { schreibeAtomar } from "./atomar.ts";
import { parseDocument, serializeDocument } from "./document.ts";

/**
 * Stellt feste Seiten, die noch als Markdown vorliegen, einmal auf Felder um. Läuft beim Start der
 * Redaktion, tut danach nichts mehr und landet als eine Fassung im Inhalts-Git. Dieselben Seiten
 * ergeben überall dieselben Dateien, darum stört es das Zusammenführen von Bundles nicht.
 */
export async function stelleSeitenUm(): Promise<void> {
  const geaendert: string[] = [];
  for (const ordner of ["kapitel", "papierkorb/kapitel"]) {
    const namen = await fs.readdir(path.join(contentDir(), ordner)).catch(() => [] as string[]);
    for (const name of namen) {
      if (!name.endsWith(".md") || name === "README.md") continue;
      const rel = `${ordner}/${name}`;
      const datei = path.join(contentDir(), rel);
      const roh = await fs.readFile(datei, "utf8");
      const doc = parseDocument(roh, rel);
      if (!doc.felder) {
        console.warn(`Umstellung: ${rel} passt in keine Vorlage und bleibt Text.`);
        continue;
      }
      const neu = serializeDocument(doc);
      if (neu === roh) continue;
      await schreibeAtomar(datei, neu);
      geaendert.push(rel);
    }
  }
  if (!geaendert.length) return;
  await commitIfChanged("Feste Seiten auf Felder umgestellt", geaendert);
  console.log(`Umstellung: ${geaendert.length} Seiten auf Felder umgestellt.`);
}
