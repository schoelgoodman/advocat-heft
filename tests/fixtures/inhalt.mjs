/**
 * Kopiert den erfundenen Inhalt (tests/fixtures/content) in einen Wegwerf-Ordner und legt dort
 * ein Git mit ein paar Fassungen an. Im Repo selbst liegt der Inhalt ohne Git.
 *
 * Die Fassungen: zuerst fast alles in einer («Übernahme»), dann je eine für die Dateien in SPAETER.
 * Die einzelnen braucht die Startseite der Redaktion für «Zuletzt bearbeitet»: Fassungen über viele
 * Seiten zählen dort nicht. Die festen Seiten liegen als Markdown im Inhalt; die Redaktion stellt
 * sie beim Start auf Felder um, und so gibt es von jeder eine ältere Fassung in Markdown.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ERFUNDEN = path.join(path.dirname(fileURLToPath(import.meta.url)), "content");

/** In dieser Reihenfolge, die letzte ist die neueste. */
const SPAETER = [
  ["recht/disclaimer.md", "Recht: Disclaimer"],
  ["briefe/0011-newsletter-11.md", "Veröffentlicht: Newsletter 11: Fragen und keine Antworten"],
  ["kapitel/ueber-uns.md", "Kapitel: Über uns"],
  ["briefe/0012-newsletter-12.md", "Veröffentlicht: Newsletter 12: Der bisher letzte Platzhalter"],
  ["briefe/0013-newsletter-13.md", "Entwurf: Newsletter 13: Ein angefangener Entwurf"],
];

export function legeInhaltAn(ziel) {
  fs.cpSync(ERFUNDEN, ziel, { recursive: true });
  // Feste Tage, damit jeder Lauf dieselben Fassungen hat. Die Redaktion hängt ihre eigenen mit heute an.
  let tag = 0;
  const git = (...args) => {
    const datum = `2026-02-${String(tag + 1).padStart(2, "0")}T09:00:00+01:00`;
    execFileSync("git", args, { cwd: ziel, stdio: ["ignore", "ignore", "inherit"], env: { ...process.env, GIT_AUTHOR_DATE: datum, GIT_COMMITTER_DATE: datum } });
  };
  git("init", "-q");
  // Ein Runner hat keinen Git-Benutzer. Und wer daheim Commits signiert, soll hier nicht nach dem Schlüssel gefragt werden.
  git("config", "user.name", "Advocat Test");
  git("config", "user.email", "test@advocat.local");
  git("config", "commit.gpgsign", "false");
  const spaeter = SPAETER.map(([rel]) => rel);
  for (const rel of spaeter) {
    if (!fs.existsSync(path.join(ziel, rel))) throw new Error(`inhalt.mjs nennt ${rel}, die Datei gibt es im erfundenen Inhalt nicht.`);
  }
  git("add", "-A", "--", ".", ...spaeter.map((rel) => `:(exclude)${rel}`));
  git("commit", "-q", "-m", "Übernahme: erfundener Inhalt");
  for (const [rel, nachricht] of SPAETER) {
    tag += 1;
    git("add", "--", rel);
    git("commit", "-q", "-m", nachricht);
  }
}
