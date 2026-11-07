import { aktuell, angebotSeiten, istOnline } from "../content/document.ts";

/** Die drei Angebotsseiten, in der Reihenfolge der Karten auf «Unser Angebot». Navigation und Seitenende lesen von hier. */
export const ANGEBOTE: ReadonlyArray<{ rel: string; href: string; name: string }> = [
  { rel: "kapitel/privatpersonen.md", href: "/privatpersonen", name: "Privatpersonen" },
  { rel: "kapitel/unternehmen.md", href: "/unternehmen-2", name: "Unternehmen" },
  { rel: "kapitel/stiftungen.md", href: "/stiftungen-2", name: "Stiftungen" },
];

/** Die Angebote, die online sind, mit ihrer heutigen Adresse (Patrick kann sie umbenennen), dahinter die selbst angelegten. */
export function angebote(): Array<{ href: string; label: string }> {
  return [
    ...ANGEBOTE.filter(({ rel }) => istOnline(rel)).map(({ href, name }) => ({ href: aktuell(href), label: `Für ${name}` })),
    ...angebotSeiten().map(({ href, label }) => ({ href, label })),
  ];
}

export function istAngebot(here: string): boolean {
  return angebote().some((angebot) => angebot.href === here);
}
