/**
 * Vorlieben in der Redaktion: hell oder dunkel, Schriftgrösse. Patrick wählt sie unter «Verwaltung»,
 * «Allgemein», «Redaktion». Sie stehen im Browser (localStorage), nicht im Inhalt: Es sind Vorlieben
 * für dieses Gerät, und eine Änderung am Inhalt setzte die ganze Website neu.
 * An der Website selbst und an der Vorschau ändern sie nichts: Die zeigen, was Besucher sehen.
 */

export type Thema = "hell" | "dunkel" | "geraet";
export type Schrift = "normal" | "gross";

const THEMA_KEY = "redaktion-thema";
const SCHRIFT_KEY = "redaktion-schrift";

function lies(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function merke(key: string, wert: string | null): void {
  try {
    if (wert == null) localStorage.removeItem(key);
    else localStorage.setItem(key, wert);
  } catch {
    // Privates Fenster ohne Speicher: Die Wahl gilt dann nur bis zum Neuladen.
  }
}

/** Ohne Wahl: hell, so wie die Redaktion immer aussah. */
export function thema(): Thema {
  const wert = lies(THEMA_KEY);
  return wert === "dunkel" || wert === "geraet" ? wert : "hell";
}

export function schrift(): Schrift {
  return lies(SCHRIFT_KEY) === "gross" ? "gross" : "normal";
}

const geraetDunkel = window.matchMedia("(prefers-color-scheme: dark)");

/** Schreibt die Wahl an `<html>`; redaktion.css richtet sich nach `data-thema` und `data-schrift`. */
function wendeAn(): void {
  const wahl = thema();
  const dunkel = wahl === "dunkel" || (wahl === "geraet" && geraetDunkel.matches);
  document.documentElement.dataset.thema = dunkel ? "dunkel" : "hell";
  document.documentElement.dataset.schrift = schrift();
}

export function setzeThema(wert: Thema): void {
  merke(THEMA_KEY, wert === "hell" ? null : wert);
  wendeAn();
}

export function setzeSchrift(wert: Schrift): void {
  merke(SCHRIFT_KEY, wert === "normal" ? null : wert);
  wendeAn();
}

/** Einmal beim Start der Redaktion. Stellt das Gerät später um (abends dunkel), geht «Wie das Gerät» mit. */
export function starteEinstellungen(): void {
  wendeAn();
  geraetDunkel.addEventListener("change", wendeAn);
}
