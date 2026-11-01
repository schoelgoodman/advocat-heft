/** Die drei Angebotsseiten, in der Reihenfolge der Karten auf «Unser Angebot». Navigation und Seitenende lesen von hier. */
export const ANGEBOTE: ReadonlyArray<{ href: string; name: string }> = [
  { href: "/privatpersonen", name: "Privatpersonen" },
  { href: "/unternehmen-2", name: "Unternehmen" },
  { href: "/stiftungen-2", name: "Stiftungen" },
];

export function istAngebot(here: string): boolean {
  return ANGEBOTE.some((angebot) => angebot.href === here);
}
