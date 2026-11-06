/** Der Vergleich einer früheren Fassung mit dem heutigen Text, bis auf einzelne Wörter. */

function esc(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/** Absätze, Zwischentitel und Listenpunkte, in der Fassung wie im Editor. */
const BLOECKE = "p, h1, h2, h3, h4, li:not(:has(p)), blockquote:not(:has(p))";

export function norm(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function bloecke(host: Element): HTMLElement[] {
  return [...host.querySelectorAll<HTMLElement>(BLOECKE)].filter((block) => norm(block.textContent ?? ""));
}

/** Welche Wörter aus `alt` auch in `neu` vorkommen, in derselben Reihenfolge (längste gemeinsame Folge). */
function gemeinsam(alt: string[], neu: string[]): boolean[] {
  const tabelle = Array.from({ length: alt.length + 1 }, () => new Uint16Array(neu.length + 1));
  for (let i = alt.length - 1; i >= 0; i--) {
    for (let j = neu.length - 1; j >= 0; j--) {
      tabelle[i][j] = alt[i] === neu[j] ? tabelle[i + 1][j + 1] + 1 : Math.max(tabelle[i + 1][j], tabelle[i][j + 1]);
    }
  }
  const bleibt = alt.map(() => false);
  for (let i = 0, j = 0; i < alt.length && j < neu.length; ) {
    if (alt[i] === neu[j]) {
      bleibt[i] = true;
      i++;
      j++;
    } else if (tabelle[i + 1][j] >= tabelle[i][j + 1]) i++;
    else j++;
  }
  return bleibt;
}

/** Der Absatz von jetzt, der diesem alten am meisten gleicht, oder keiner. */
function aehnlichster(text: string, jetzt: string[]): string | null {
  const woerter = new Set(text.split(" "));
  let bester: string | null = null;
  let wert = 0.4;
  for (const kandidat of jetzt) {
    const andere = new Set(kandidat.split(" "));
    const beide = [...woerter].filter((wort) => andere.has(wort)).length;
    const anteil = beide / (woerter.size + andere.size - beide);
    if (anteil > wert) [bester, wert] = [kandidat, anteil];
  }
  return bester;
}

/**
 * Markiert in der alten Fassung, was heute anders ist: ganze Absätze gelb,
 * darin die Wörter, die es so nicht mehr gibt. Gibt zurück, wie viel sich unterscheidet.
 */
export function markiereUnterschiede(alt: HTMLElement, jetzt: string[]): { anders: number; neu: number } {
  const jetztMenge = new Set(jetzt);
  const altTexte = new Set<string>();
  // Absätze von heute, die nur geändert sind, zählen nicht als neu dazugekommen.
  const geaendert = new Set<string>();
  let anders = 0;
  // Den Titel vergleicht showRevision für sich.
  for (const block of bloecke(alt).filter((block) => !block.classList.contains("fassung-titel"))) {
    const text = norm(block.textContent ?? "");
    altTexte.add(text);
    if (jetztMenge.has(text)) continue;
    anders++;
    block.classList.add("anders");
    const naechster = aehnlichster(text, jetzt);
    if (naechster) geaendert.add(naechster);
    // Wörter nur markieren, wo nichts verloren geht: keine Bilder, nicht zu lang.
    if (!naechster || block.querySelector("img")) continue;
    const woerter = text.split(" ");
    const heute = naechster.split(" ");
    if (woerter.length * heute.length > 250_000) continue;
    const bleibt = gemeinsam(woerter, heute);
    // Nebeneinander geänderte Wörter in einer Markierung, nicht jedes für sich.
    block.innerHTML = woerter
      .map((wort, i) => `${!bleibt[i] && (i === 0 || bleibt[i - 1]) ? "<mark>" : ""}${esc(wort)}${!bleibt[i] && (i === woerter.length - 1 || bleibt[i + 1]) ? "</mark>" : ""}`)
      .join(" ");
  }
  return { anders, neu: jetzt.filter((text) => !altTexte.has(text) && !geaendert.has(text)).length };
}

