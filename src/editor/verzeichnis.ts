/**
 * Die Seiten im Verzeichnis, so aufgebaut wie das Menü der Website: Hauptseiten, darunter was zu ihnen
 * gehört. Ohne DOM, damit es sich testen lässt (verzeichnis.test.ts).
 */
import { ANGEBOT, FESTE_ANGEBOTE, HOME, istFesteMenueSeite, KONTAKT, menueBezeichnung, menueReihe, type MenueOrt } from "../content/menue.ts";

export interface SeiteImBaum {
  rel: string;
  art: string;
  titel: string;
  entwurf: boolean;
  menue?: MenueOrt;
  menueName?: string | null;
}

export interface BaumPunkt<T> {
  seite: T;
  unter: T[];
}

export interface SeitenBaum<T> {
  /** Wie das Hauptmenü der Website, in seiner Reihenfolge. */
  menue: BaumPunkt<T>[];
  /** Wie im Fuss der Website. */
  rechtliches: T[];
  /** Was im Menü nicht vorkommt: Kopien und Seiten mit «Nicht im Menü». */
  weitere: T[];
}

const RECHT = ["recht/impressum.md", "recht/disclaimer.md", "recht/datenschutz.md"];

const nachTitel = <T extends SeiteImBaum>(a: T, b: T) => a.titel.localeCompare(b.titel, "de");

/** `reihenfolge`: die gespeicherte des Menüs (content/menue.json). Entwürfe stehen dort, wo sie online stehen werden. */
export function seitenBaum<T extends SeiteImBaum>(seiten: readonly T[], reihenfolge: readonly string[] = []): SeitenBaum<T> {
  const nachRel = new Map(seiten.map((seite) => [seite.rel, seite]));
  const vergeben = new Set<string>();
  const nimm = (rel: string): T[] => {
    const seite = nachRel.get(rel);
    if (!seite) return [];
    vergeben.add(rel);
    return [seite];
  };
  const eigene = (ort: MenueOrt) => seiten
    .filter((seite) => seite.art === "kapitel" && seite.menue === ort && !istFesteMenueSeite(seite.rel))
    .sort((a, b) => menueBezeichnung(a).localeCompare(menueBezeichnung(b), "de"))
    .map((seite) => seite.rel);
  const punkt = (rel: string): BaumPunkt<T>[] => nimm(rel).map((seite) => ({
    seite,
    unter: rel === ANGEBOT ? [...FESTE_ANGEBOTE, ...eigene("angebot")].flatMap(nimm) : [],
  }));

  const menue: BaumPunkt<T>[] = [HOME, ...menueReihe(eigene(true), reihenfolge), KONTAKT].flatMap(punkt);
  const rechtFest = RECHT.flatMap(nimm);
  const rechtAndere = seiten.filter((seite) => seite.art === "recht" && !vergeben.has(seite.rel)).sort(nachTitel);
  for (const seite of rechtAndere) vergeben.add(seite.rel);
  return {
    menue,
    rechtliches: [...rechtFest, ...rechtAndere],
    weitere: seiten.filter((seite) => seite.art !== "brief" && !vergeben.has(seite.rel)).sort(nachTitel),
  };
}

/** Wie die Seite im Verzeichnis heisst. Die Startseite wie im Menü der Website. */
export function seitenName(seite: Pick<SeiteImBaum, "rel" | "titel" | "menue" | "menueName">): string {
  if (seite.rel === HOME) return "Home";
  return seite.menue ? menueBezeichnung(seite) : seite.titel;
}

/** Was «Menü ordnen» verschieben darf: alles im Hauptmenü ausser Home und Kontakt. */
export function verschiebbar<T extends SeiteImBaum>(baum: SeitenBaum<T>): string[] {
  return baum.menue.map((punkt) => punkt.seite.rel).filter((rel) => rel !== HOME && rel !== KONTAKT);
}
