/**
 * Die Angebotsseiten (Privatpersonen, Unternehmen, Stiftungen) als Felder statt als freier Text.
 * Gespeichert bleibt Markdown in genau der Form, die das Layout liest. `liesAngebot` nimmt eine Seite
 * nur an, wenn `schreibeAngebot` daraus wieder denselben Text macht; sonst bleibt sie beim freien Editor.
 * Läuft auch im Browser: keine Node-Importe.
 */

export const ANGEBOTSSEITEN = ["kapitel/privatpersonen.md", "kapitel/unternehmen.md", "kapitel/stiftungen.md"];

export interface Knopf {
  text: string;
  ziel: string;
}

export interface Abschnitt {
  titel: string;
  untertitel: string;
  /** Absätze und Aufzählungen, durch Leerzeilen getrennt. */
  text: string;
  /** Ein Eintrag je Punkt. Ein Punkt kann mehrere Zeilen haben. */
  leistungen: string[];
}

export interface Angebot {
  bild: { src: string; alt: string };
  einstieg: { titel: string; text: string; knopf: Knopf | null };
  abschnitte: Abschnitt[];
  band: { titel: string; text: string; knopf: Knopf };
}

const BILD = /^!\[([^\]]*)\]\((\S+)\)$/;
const LINK = /^\[([^\]]+)\]\(([^)\s]+)\)$/;
const TITEL = /^## (.+)$/;
const BAND = /^kontaktieren sie uns\.?$/i;
export const LEISTUNGEN = "Leistungen:";

function bloecke(markdown: string): string[] {
  return markdown.split(/\n\s*\n/).map((block) => block.trim()).filter(Boolean);
}

function titelVon(block: string | undefined): string | null {
  return block?.match(TITEL)?.[1] ?? null;
}

/** Nur was ein Textfeld kann: Absätze und Aufzählungen, keine Titel, Bilder oder Knöpfe. */
function istText(block: string): boolean {
  return !/^(#|!\[|\[!\[|>|\d+\. |\* )/m.test(block) && !LINK.test(block);
}

function punkte(block: string): string[] | null {
  if (!block.startsWith("- ")) return null;
  return block.split(/\n(?=- )/).map((punkt) => punkt.slice(2));
}

export function schreibeAngebot(seitenTitel: string, a: Angebot): string {
  const teile = [`![${a.bild.alt}](${a.bild.src})`, `## ${seitenTitel}`, `## ${a.einstieg.titel}`, a.einstieg.text];
  if (a.einstieg.knopf) teile.push(`[${a.einstieg.knopf.text}](${a.einstieg.knopf.ziel})`);
  for (const abschnitt of a.abschnitte) {
    teile.push(`## ${abschnitt.titel}`);
    if (abschnitt.untertitel) teile.push(`## ${abschnitt.untertitel}`);
    teile.push(abschnitt.text);
    const liste = abschnitt.leistungen.filter((punkt) => punkt.trim());
    if (liste.length) teile.push(`## ${LEISTUNGEN}`, liste.map((punkt) => `- ${punkt.trim()}`).join("\n"));
  }
  teile.push(`## ${a.band.titel}`, a.band.text, `[${a.band.knopf.text}](${a.band.knopf.ziel})`);
  return bloecke(teile.join("\n\n")).join("\n\n");
}

function lies(seitenTitel: string, markdown: string): Angebot | null {
  const b = bloecke(markdown);
  let i = 0;
  const bild = b[i++]?.match(BILD);
  if (!bild || titelVon(b[i++]) !== seitenTitel) return null;
  const einstiegTitel = titelVon(b[i++]);
  if (!einstiegTitel) return null;

  const textBis = (): string => {
    const start = i;
    while (i < b.length && !TITEL.test(b[i]) && istText(b[i])) i += 1;
    return b.slice(start, i).join("\n\n");
  };
  const knopfHier = (): Knopf | null => {
    const link = b[i]?.match(LINK);
    if (!link) return null;
    i += 1;
    return { text: link[1], ziel: link[2] };
  };

  const einstiegText = textBis();
  const einstiegKnopf = knopfHier();
  const abschnitte: Abschnitt[] = [];
  while (i < b.length) {
    const titel = titelVon(b[i]);
    if (!titel) return null;
    if (BAND.test(titel)) break;
    i += 1;
    let untertitel = "";
    const zweiter = titelVon(b[i]);
    if (zweiter && zweiter !== LEISTUNGEN) {
      untertitel = zweiter;
      i += 1;
    }
    const text = textBis();
    let leistungen: string[] = [];
    if (titelVon(b[i]) === LEISTUNGEN) {
      const liste = b[i + 1] ? punkte(b[i + 1]) : null;
      if (!liste) return null;
      leistungen = liste;
      i += 2;
    }
    abschnitte.push({ titel, untertitel, text, leistungen });
  }

  const bandTitel = titelVon(b[i++]);
  const bandText = b[i++];
  const bandKnopf = b[i++]?.match(LINK);
  if (!bandTitel || !bandText || !bandKnopf || i !== b.length || !istText(bandText)) return null;
  return {
    bild: { alt: bild[1], src: bild[2] },
    einstieg: { titel: einstiegTitel, text: einstiegText, knopf: einstiegKnopf },
    abschnitte,
    band: { titel: bandTitel, text: bandText, knopf: { text: bandKnopf[1], ziel: bandKnopf[2] } },
  };
}

/** Die Felder einer Seite, oder null, wenn sie nicht verlustfrei in die Felder passt. */
export function liesAngebot(seitenTitel: string, markdown: string): Angebot | null {
  const text = markdown.trim();
  const angebot = lies(seitenTitel, text);
  return angebot && schreibeAngebot(seitenTitel, angebot) === text ? angebot : null;
}

/** Was in einem Feld fehlt, damit die Seite gespeichert werden kann. Schlüssel wie «abschnitte.2.titel». */
export function pruefeAngebot(seitenTitel: string, a: Angebot): Record<string, string> {
  const fehler: Record<string, string> = {};
  if (!a.einstieg.titel.trim()) fehler["einstieg.titel"] = "Bitte eine Überschrift eingeben.";
  if (!a.band.text.trim()) fehler["band.text"] = "Bitte einen Satz eingeben.";
  a.abschnitte.forEach((abschnitt, nr) => {
    const titel = abschnitt.titel.trim();
    if (!titel) fehler[`abschnitte.${nr}.titel`] = "Bitte einen Titel eingeben.";
    else if (BAND.test(titel) || titel === LEISTUNGEN) fehler[`abschnitte.${nr}.titel`] = "Dieser Titel ist für die Gestaltung reserviert.";
  });
  for (const [feld, text] of [["einstieg.text", a.einstieg.text], ...a.abschnitte.map((abschnitt, nr) => [`abschnitte.${nr}.text`, abschnitt.text])]) {
    if (!bloecke(text).every(istText)) fehler[feld] = "Hier gehen nur Absätze und Aufzählungen, keine Titel, Bilder oder Zeilen, die nur aus einem Link bestehen.";
  }
  if (!Object.keys(fehler).length && !liesAngebot(seitenTitel, schreibeAngebot(seitenTitel, a))) {
    fehler._ = "Die Seite lässt sich so nicht speichern. Bitte die Felder prüfen.";
  }
  return fehler;
}

/** Die Textstücke einer Seite ohne Markdown, in der Art, wie der Fassungsvergleich sie braucht. */
export function klartextBloecke(markdown: string): string[] {
  return bloecke(markdown)
    .flatMap((block) => (block.startsWith("- ") ? (punkte(block) ?? []) : [block]))
    .map((block) => block
      .replace(/^!\[[^\]]*\]\([^)]*\)$/, "")
      .replace(/^#+ /, "")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\*\*/g, "")
      .replace(/\s+/g, " ")
      .trim())
    .filter(Boolean);
}
