import { fehlerText, h, toast } from "../dom.ts";

/**
 * «Verwaltung», «Allgemein», «Redaktion», «Daten löschen»: Support, Papierkorb, Verlauf, Kontaktaufnahme
 * und den Chat mit dem Assistenten ganz leeren, einzeln oder alles in einem Zug. Nichts davon lässt sich
 * zurückholen, darum fragt jede Löschung zweimal: erst, was gelöscht wird, dann das Wort «löschen» tippen.
 * An der Website und an den Seiten in der Redaktion ändert keine davon etwas.
 */

export type LoeschArt = "support" | "papierkorb" | "verlauf" | "anfragen" | "chat";

export interface LoeschAnschluss {
  frage(optionen: { titel: string; text: string; ja: string; nein?: string; gefahr?: boolean }): Promise<boolean>;
  /** Nach dem Löschen: Listen und Zähler in der Redaktion neu holen. */
  geleert(arten: LoeschArt[]): Promise<void> | void;
}

type Zahlen = Record<LoeschArt, { anzahl: number; offen?: number }>;

const mehrzahl = (zahl: number, eins: string, viele: string) => (zahl === 1 ? `1 ${eins}` : `${zahl} ${viele}`);

const ARTEN: { art: LoeschArt; name: string; weg: string; url: string; zaehle(zahl: { anzahl: number; offen?: number }): string }[] = [
  {
    art: "support",
    name: "Support",
    weg: "Alle Nachrichten an den Support samt Anhängen, auch die offenen. Was schon per Telegram hinausging, bleibt dort.",
    url: "/api/wuensche",
    zaehle: ({ anzahl, offen }) => `${mehrzahl(anzahl, "Nachricht", "Nachrichten")}${offen ? `, ${offen} davon offen` : ""}`,
  },
  {
    art: "papierkorb",
    name: "Papierkorb",
    weg: "Alle gelöschten Entwürfe im Papierkorb.",
    url: "/api/papierkorb",
    zaehle: ({ anzahl }) => mehrzahl(anzahl, "Eintrag", "Einträge"),
  },
  {
    art: "verlauf",
    name: "Verlauf",
    weg: "Alle früheren Fassungen der Website. Der heutige Stand bleibt, aber keine Seite und kein gelöschtes Bild lässt sich danach auf einen früheren Stand zurückholen.",
    url: "/api/verlauf",
    zaehle: ({ anzahl }) => mehrzahl(anzahl, "frühere Fassung", "frühere Fassungen"),
  },
  {
    art: "anfragen",
    name: "Kontaktaufnahme",
    weg: "Alle Anfragen aus dem Kontaktformular, auch ungelesene und unbeantwortete.",
    url: "/api/anfragen",
    zaehle: ({ anzahl, offen }) => `${mehrzahl(anzahl, "Anfrage", "Anfragen")}${offen ? `, ${offen} davon noch nicht erledigt` : ""}`,
  },
  {
    art: "chat",
    name: "Chat mit dem Assistenten",
    weg: "Der ganze bisherige Chat mit dem Assistenten.",
    url: "/api/chat",
    zaehle: ({ anzahl }) => mehrzahl(anzahl, "Nachricht", "Nachrichten"),
  },
];

/** Der Verlauf zuletzt: Dann ist auch die Fassung weg, die das Leeren des Papierkorbs eben angelegt hat. */
const REIHENFOLGE: LoeschArt[] = ["papierkorb", "support", "anfragen", "chat", "verlauf"];

const WORT = "löschen";

/** Die zweite Rückfrage: Der Knopf geht erst, wenn das Wort getippt ist. Gross oder klein ist gleich. */
function tippeZurBestaetigung(titel: string): Promise<boolean> {
  const eingabe = h("input", { type: "text", autocomplete: "off", autocapitalize: "off", spellcheck: "false", "aria-label": `Zur Bestätigung «${WORT}» tippen` });
  const ja = h("button", { value: "ja", class: "haupt gefahr", disabled: true }, "Endgültig löschen");
  const dialog = h(
    "dialog",
    { class: "loesch-bestaetigung" },
    h(
      "form",
      { method: "dialog" },
      h("h2", {}, titel),
      h("p", {}, `Das lässt sich nicht rückgängig machen, auch nicht vom Support. Tippe zur Bestätigung das Wort «${WORT}».`),
      eingabe,
      // «Abbrechen» ist kein Absenden: So löst Enter nichts aus, solange das Wort fehlt.
      h("div", { class: "aktionen" }, h("button", { type: "button", onclick: () => dialog.close("nein") }, "Abbrechen"), ja),
    ),
  );
  eingabe.addEventListener("input", () => {
    ja.disabled = eingabe.value.trim().toLowerCase() !== WORT;
  });
  document.body.append(dialog);
  dialog.showModal();
  eingabe.focus();
  return new Promise((resolve) => {
    dialog.addEventListener("close", () => {
      dialog.remove();
      resolve(dialog.returnValue === "ja");
    }, { once: true });
  });
}

export function datenLoeschen(anschluss: LoeschAnschluss): { element: HTMLElement; lade(): Promise<void> } {
  let zahlen: Zahlen | null = null;
  let laeuft = false;

  const zeilen = ARTEN.map((eintrag) => {
    const stand = h("small", { class: "feld-hinweis loesch-stand" }, "…");
    const knopf = h("button", { type: "button", "data-leeren": eintrag.art, disabled: true }, "Leeren");
    knopf.addEventListener("click", () => void loesche([eintrag.art]));
    const element = h(
      "div",
      { class: "loesch-zeile" },
      h("div", {}, h("span", { class: "feld-name" }, eintrag.name), h("small", { class: "feld-hinweis" }, eintrag.weg), stand),
      knopf,
    );
    return { ...eintrag, stand, knopf, element };
  });
  const alles = h("button", { type: "button", class: "haupt gefahr", id: "alles-loeschen", disabled: true }, "Alles löschen");
  alles.addEventListener("click", () => void loesche(zeilen.filter((zeile) => zahlen?.[zeile.art].anzahl).map((zeile) => zeile.art)));

  function zeichne(): void {
    for (const zeile of zeilen) {
      const zahl = zahlen?.[zeile.art];
      zeile.stand.textContent = !zahl ? "Liess sich nicht zählen." : zahl.anzahl ? `Jetzt: ${zeile.zaehle(zahl)}.` : "Schon leer.";
      zeile.knopf.disabled = laeuft || !zahl?.anzahl;
    }
    alles.disabled = laeuft || !zeilen.some((zeile) => zahlen?.[zeile.art].anzahl);
  }

  async function lade(): Promise<void> {
    zahlen = (await fetch("/api/daten", { cache: "no-store" })
      .then((antwort) => (antwort.ok ? antwort.json() : null))
      .catch(() => null)) as Zahlen | null;
    zeichne();
  }

  async function loesche(arten: LoeschArt[]): Promise<void> {
    if (laeuft || !arten.length) return;
    // Frisch zählen: Seit dem Öffnen der Seite kann eine Anfrage dazugekommen sein.
    await lade();
    const gewaehlt = zeilen.filter((zeile) => arten.includes(zeile.art) && zahlen?.[zeile.art].anzahl);
    if (!gewaehlt.length) return;
    const eine = gewaehlt.length === 1 ? gewaehlt[0] : null;
    const titel = eine ? `${eine.name} leeren?` : "Alles löschen?";
    const text = eine
      ? `${eine.weg} Jetzt: ${eine.zaehle(zahlen![eine.art])}. Das lässt sich nicht rückgängig machen. Die Website bleibt, wie sie ist.`
      : `Gelöscht wird: ${gewaehlt.map((zeile) => `${zeile.name} (${zeile.zaehle(zahlen![zeile.art])})`).join(", ")}. Danach lässt sich keine Seite mehr auf einen früheren Stand zurückholen. Nichts davon lässt sich rückgängig machen. Die Website bleibt, wie sie ist.`;
    if (!(await anschluss.frage({ titel, text, ja: "Weiter", nein: "Abbrechen", gefahr: true }))) return;
    if (!(await tippeZurBestaetigung(eine ? `${eine.name} wirklich leeren?` : "Wirklich alles löschen?"))) return;

    laeuft = true;
    zeichne();
    const erledigt: LoeschArt[] = [];
    let fehler = "";
    for (const art of REIHENFOLGE) {
      const zeile = gewaehlt.find((eintrag) => eintrag.art === art);
      if (!zeile) continue;
      const antwort = await fetch(zeile.url, { method: "DELETE" }).catch(() => null);
      if (antwort?.ok) {
        erledigt.push(art);
        continue;
      }
      fehler = `${zeile.name}: ${antwort ? await fehlerText(antwort, "Löschen ging nicht.") : "Keine Verbindung zum Server."}`;
      break;
    }
    laeuft = false;
    if (erledigt.length) await anschluss.geleert(erledigt);
    await lade();
    const namen = zeilen.filter((zeile) => erledigt.includes(zeile.art)).map((zeile) => zeile.name).join(", ");
    if (fehler) toast(`${namen ? `Geleert: ${namen}. ` : ""}Nicht geklappt hat ${fehler}`, undefined, true);
    else toast(`Geleert: ${namen}.`);
  }

  const element = h(
    "section",
    { class: "feld-gruppe", id: "daten-loeschen" },
    h("h2", {}, "Daten löschen"),
    h("p", { class: "leise" }, "Räumt endgültig auf, einzeln oder alles in einem Zug. Jede Löschung fragt zweimal nach und lässt sich danach nicht zurückholen. Die Website, die Seiten, die Entwürfe und die Bilder bleiben, wie sie sind. Gilt für die ganze Redaktion, nicht nur für diesen Browser."),
    ...zeilen.map((zeile) => zeile.element),
    h("div", { class: "loesch-zeile loesch-alles" }, h("div", {}, h("span", { class: "feld-name" }, "Alles zusammen"), h("small", { class: "feld-hinweis" }, "Support, Papierkorb, Verlauf, Kontaktaufnahme und Chat in einem Zug, mit einer einzigen doppelten Rückfrage.")), alles),
  );
  return { element, lade };
}
