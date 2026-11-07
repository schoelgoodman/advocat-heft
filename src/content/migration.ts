import fs from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { commitIfChanged } from "../git/history.ts";
import { contentDir } from "../paths.ts";
import { ALLGEMEIN_DATEI, ALLGEMEIN_GRUND, allgemeinAus, pruefeAllgemein, type Allgemein } from "./allgemein.ts";
import { schreibeAtomar } from "./atomar.ts";
import { parseDocument, serializeDocument } from "./document.ts";
import { schreibeAllgemein } from "./load.ts";

/**
 * Legt die allgemeinen Angaben einmal an, bevor die Kontaktseite ihre eigenen verliert (siehe
 * bereinigeFelder). Was Patrick dort eingetragen hat, gilt: E-Mail, Telefon und die Adresse, wenn
 * sie die gewohnten drei Zeilen hat. Sonst die Vorgabe. Läuft vor stelleSeitenUm.
 */
export async function legeAllgemeinAn(): Promise<void> {
  const datei = path.join(contentDir(), ALLGEMEIN_DATEI);
  if (await fs.stat(datei).then(() => true, () => false)) return;
  const angaben: Allgemein = structuredClone(ALLGEMEIN_GRUND);
  const roh = await fs.readFile(path.join(contentDir(), "kapitel/kontakt.md"), "utf8").catch(() => "");
  const kopf = roh.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1].split(/^felder:/m);
  if (kopf && kopf.length > 1) {
    try {
      const felder = (YAML.parse(`felder:${kopf.slice(1).join("felder:")}`) as { felder?: Record<string, { zeilen?: unknown; wert?: unknown }> }).felder ?? {};
      if (typeof felder.email?.wert === "string") angaben.email = felder.email.wert;
      if (typeof felder.telefon?.wert === "string") angaben.telefon = felder.telefon.wert;
      const zeilen = typeof felder.adresse?.zeilen === "string" ? felder.adresse.zeilen.split("\n").map((z) => z.trim()).filter(Boolean) : [];
      const ort = zeilen[2]?.match(/^(?:CH-)?(\d{4})\s+(.+)$/);
      if (zeilen.length === 3 && ort) Object.assign(angaben, { firma: zeilen[0], strasse: zeilen[1], plz: ort[1], ort: ort[2] });
    } catch {
      // Unlesbar: die Vorgabe.
    }
  }
  const sauber = allgemeinAus(angaben);
  await schreibeAllgemein(Object.keys(pruefeAllgemein(sauber)).length ? ALLGEMEIN_GRUND : sauber);
  await commitIfChanged("Allgemeine Angaben angelegt", [ALLGEMEIN_DATEI]);
  console.log("Allgemeine Angaben angelegt.");
}

/**
 * Stellt feste Seiten, die noch als Markdown oder mit Feldern von früher vorliegen (die Kontaktseite
 * mit eigener Adresse), einmal auf den heutigen Aufbau um. Läuft beim Start der
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
  await commitIfChanged("Feste Seiten auf den heutigen Aufbau umgestellt", geaendert);
  console.log(`Umstellung: ${geaendert.length} Seiten umgestellt.`);
}
