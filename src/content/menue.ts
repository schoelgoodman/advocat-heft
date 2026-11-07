/**
 * Der Aufbau des Hauptmenüs, für die Website und das Verzeichnis der Redaktion. Ohne Node und ohne
 * DOM: beide Seiten rechnen damit, so können sie nicht auseinanderlaufen (menue.test.ts).
 *
 * Ob eine eigene Seite im Menü steht, steht in der Seite selbst. Die Reihenfolge steht in
 * `content/menue.json`. Die Datei fehlt, bis Patrick zum ersten Mal ordnet; dann gilt die Grundordnung.
 */

export const MENUE_DATEI = "menue.json";
export const MENUE_NAME_MAX = 40;

/** Wo eine eigene Seite im Menü steht: oben, unter «Unser Angebot» oder gar nicht. */
export type MenueOrt = boolean | "angebot";

export const HOME = "kapitel/willkommen.md";
export const KONTAKT = "kapitel/kontakt.md";
export const ANGEBOT = "kapitel/angebot.md";
const UEBER_UNS = "kapitel/ueber-uns.md";
const NEUIGKEITEN = "kapitel/neuigkeiten.md";

/** Die drei Angebote, die es immer gibt, in der Reihenfolge der Karten auf «Unser Angebot». */
export const FESTE_ANGEBOTE = ["kapitel/privatpersonen.md", "kapitel/unternehmen.md", "kapitel/stiftungen.md"];

/** Die Bezeichnungen im Menü sind fest, sie folgen nicht dem Titel der Seite. */
export const FESTE_NAMEN: Readonly<Record<string, string>> = {
  [ANGEBOT]: "Unser Angebot",
  [UEBER_UNS]: "Über uns",
  [NEUIGKEITEN]: "Neuigkeiten",
};

const FEST = new Set([HOME, KONTAKT, ANGEBOT, UEBER_UNS, NEUIGKEITEN, ...FESTE_ANGEBOTE]);

export function istFesteMenueSeite(rel: string): boolean {
  return FEST.has(rel);
}

/** Was aus dem Browser oder aus einer Datei kommt, als gültiger Ort. Alles andere: nicht im Menü. */
export function menueOrt(wert: unknown): MenueOrt {
  return wert === true || wert === "true" ? true : wert === "angebot" ? "angebot" : false;
}

/** Was im Menü steht, wenn die Seite keinen eigenen Namen dafür hat. */
export function menueBezeichnung(seite: { titel: string; menueName?: string | null }): string {
  return seite.menueName?.trim() || seite.titel;
}

/**
 * Was sich im Menü verschieben lässt, in seiner Reihenfolge: gespeichert, was es noch gibt, dazu was fehlt.
 * Neue Seiten kommen vor «Neuigkeiten». Home und Kontakt stehen nie darin, sie bleiben am Rand.
 * `eigene`: die selbst angelegten Seiten fürs Hauptmenü, in der Reihenfolge, in der neue dazukommen.
 */
export function menueReihe(eigene: readonly string[], gespeichert: readonly string[] = []): string[] {
  const erlaubt = new Set([ANGEBOT, UEBER_UNS, NEUIGKEITEN, ...eigene]);
  const reihe = [...new Set(gespeichert)].filter((rel) => erlaubt.has(rel));
  for (const rel of [UEBER_UNS, ANGEBOT]) if (!reihe.includes(rel)) reihe.unshift(rel);
  if (!reihe.includes(NEUIGKEITEN)) reihe.push(NEUIGKEITEN);
  reihe.splice(reihe.indexOf(NEUIGKEITEN), 0, ...eigene.filter((rel) => !reihe.includes(rel)));
  return reihe;
}
