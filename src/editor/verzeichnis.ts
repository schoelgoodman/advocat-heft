/**
 * Die Seiten im Verzeichnis, so aufgebaut wie das Menü der Website: Hauptseiten, darunter was zu ihnen
 * gehört. Ohne DOM, damit es sich testen lässt (verzeichnis.test.ts).
 */

export interface SeiteImBaum {
  rel: string;
  art: string;
  titel: string;
  entwurf: boolean;
  menue?: boolean;
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
  /** Was im Menü nicht vorkommt: Kopien, Entwürfe, Seiten ohne «Im Hauptmenü zeigen». */
  weitere: T[];
}

const VOR_DEN_EIGENEN = ["kapitel/willkommen.md", "kapitel/angebot.md", "kapitel/ueber-uns.md"];
const NACH_DEN_EIGENEN = ["kapitel/neuigkeiten.md", "kapitel/kontakt.md"];
const UNTER: Record<string, string[]> = {
  "kapitel/angebot.md": ["kapitel/privatpersonen.md", "kapitel/unternehmen.md", "kapitel/stiftungen.md"],
};
const RECHT = ["recht/impressum.md", "recht/disclaimer.md", "recht/datenschutz.md"];

const nachTitel = <T extends SeiteImBaum>(a: T, b: T) => a.titel.localeCompare(b.titel, "de");

export function seitenBaum<T extends SeiteImBaum>(seiten: readonly T[]): SeitenBaum<T> {
  const nachRel = new Map(seiten.map((seite) => [seite.rel, seite]));
  const vergeben = new Set<string>();
  const nimm = (rel: string): T[] => {
    const seite = nachRel.get(rel);
    if (!seite) return [];
    vergeben.add(rel);
    return [seite];
  };
  const punkt = (rel: string): BaumPunkt<T>[] => nimm(rel).map((seite) => ({ seite, unter: (UNTER[rel] ?? []).flatMap(nimm) }));

  const fest = [...VOR_DEN_EIGENEN, ...NACH_DEN_EIGENEN, ...Object.values(UNTER).flat(), ...RECHT];
  // Selbst angelegte Seiten stehen auf der Website vor «Neuigkeiten», sobald sie online sind.
  const eigene = seiten
    .filter((seite) => seite.art === "kapitel" && seite.menue && !seite.entwurf && !fest.includes(seite.rel))
    .sort(nachTitel);
  const menue: BaumPunkt<T>[] = [
    ...VOR_DEN_EIGENEN.flatMap(punkt),
    ...eigene.flatMap((seite) => punkt(seite.rel)),
    ...NACH_DEN_EIGENEN.flatMap(punkt),
  ];
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
export function seitenName(seite: Pick<SeiteImBaum, "rel" | "titel">): string {
  return seite.rel === "kapitel/willkommen.md" ? "Home" : seite.titel;
}
