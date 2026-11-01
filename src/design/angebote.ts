import { aktuell } from "../content/document.ts";

/** Die drei Angebotsseiten, in der Reihenfolge der Karten auf «Unser Angebot». Navigation und Seitenende lesen von hier. */
export const ANGEBOTE: ReadonlyArray<{ href: string; name: string }> = [
  { href: "/privatpersonen", name: "Privatpersonen" },
  { href: "/unternehmen-2", name: "Unternehmen" },
  { href: "/stiftungen-2", name: "Stiftungen" },
];

/** Die Angebote mit ihrer heutigen Adresse. Patrick kann sie in der Redaktion umbenennen. */
export function angebote(): Array<{ href: string; name: string }> {
  return ANGEBOTE.map((angebot) => ({ ...angebot, href: aktuell(angebot.href) }));
}

export function istAngebot(here: string): boolean {
  return angebote().some((angebot) => angebot.href === here);
}
