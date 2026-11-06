import { liesAngebot, pruefeAngebot, schreibeAngebot, type Abschnitt, type Angebot } from "../../content/angebot.ts";
import { verschiebe, zieheStart } from "./ziehen.ts";

/** Felder statt freier Text für die Angebotsseiten. Nach aussen: Markdown, wie es in der Datei steht. */

export interface FelderEditor {
  markdown(): string;
  /** Übernimmt Markdown in die Felder. False: Es passt nicht hinein, die Felder bleiben, wie sie sind. */
  setze(markdown: string): boolean;
  /** Was das Speichern verhindert, und die Felder zeigen es. Null: alles in Ordnung. */
  fehler(): string | null;
}

interface Anschluss {
  seitenTitel(): string;
  geaendert(): void;
  ladeBild(datei: File): Promise<string>;
  frage(optionen: { titel: string; text: string; ja: string; nein?: string; gefahr?: boolean }): Promise<boolean>;
}

type Attr = Record<string, string | boolean | number | ((event: never) => void) | null | undefined>;

/** Text kommt immer als Textknoten in die Seite, nie als HTML. */
function h<K extends keyof HTMLElementTagNameMap>(tag: K, attr: Attr = {}, ...kinder: (Node | string | null | false | undefined)[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [name, wert] of Object.entries(attr)) {
    if (wert == null || wert === false) continue;
    if (typeof wert === "function") el.addEventListener(name.slice(2), wert as EventListener);
    else if (wert === true) el.setAttribute(name, "");
    else el.setAttribute(name, String(wert));
  }
  for (const kind of kinder) if (kind) el.append(kind);
  return el;
}

/** Ein Feld wächst mit dem Text. In einem zugeklappten Abschnitt ist es 0 hoch; das holt `toggle` nach. */
function passeHoeheAn(feld: HTMLTextAreaElement): void {
  feld.style.height = "auto";
  if (feld.scrollHeight) feld.style.height = `${feld.scrollHeight + 2}px`;
}

function zuTextfeld(feld: HTMLTextAreaElement, aenderung: () => void): void {
  feld.addEventListener("input", () => {
    passeHoeheAn(feld);
    aenderung();
  });
  queueMicrotask(() => passeHoeheAn(feld));
}

export function mountAngebot(host: HTMLElement, start: Angebot, anschluss: Anschluss): FelderEditor {
  let a = start;
  let fehler: Record<string, string> = {};
  /** Offene Abschnitte. Am Objekt, nicht an der Nummer: So bleiben sie beim Verschieben offen. */
  const offen = new WeakSet<Abschnitt>();
  /** Neue Punkte bekommen den Fokus nach dem Neuzeichnen. */
  let fokus: string | null = null;

  const geaendert = () => {
    // Steht schon ein Fehler da, verschwindet er, sobald er behoben ist.
    if (Object.keys(fehler).length) pruefeStill();
    anschluss.geaendert();
  };

  function pruefeStill(): void {
    const neu = pruefeAngebot(anschluss.seitenTitel(), a);
    for (const pfad of Object.keys(fehler)) {
      if (neu[pfad]) continue;
      host.querySelector(`[data-pfad="${CSS.escape(pfad)}"]`)?.classList.remove("hat-fehler");
      host.querySelector(`[data-fehler="${CSS.escape(pfad)}"]`)?.remove();
    }
    fehler = neu;
  }

  function feld(pfad: string, beschriftung: string, wert: string, setze: (text: string) => void, optionen: { hinweis?: string; platzhalter?: string } = {}): HTMLElement {
    const eingabe = h("input", { type: "text", placeholder: optionen.platzhalter });
    eingabe.value = wert;
    eingabe.addEventListener("input", () => {
      setze(eingabe.value);
      geaendert();
    });
    return rahmen(pfad, beschriftung, eingabe, optionen.hinweis);
  }

  function rahmen(pfad: string, beschriftung: string, eingabe: HTMLElement, hinweis?: string): HTMLElement {
    const melde = fehler[pfad];
    return h(
      "label",
      { class: melde ? "feld hat-fehler" : "feld", "data-pfad": pfad },
      h("span", { class: "feld-name" }, beschriftung),
      eingabe,
      hinweis ? h("small", { class: "feld-hinweis" }, hinweis) : null,
      melde ? h("small", { class: "feld-fehler", "data-fehler": pfad }, melde) : null,
    );
  }

  /** Text mit Absätzen und Aufzählungen. Zwei Knöpfe, damit niemand die Schreibweise kennen muss. */
  function textfeld(pfad: string, beschriftung: string, wert: string, setze: (text: string) => void): HTMLElement {
    const eingabe = h("textarea", { rows: 3 });
    eingabe.value = wert;
    zuTextfeld(eingabe, () => {
      setze(eingabe.value);
      geaendert();
    });
    const umforme = (macher: (auswahl: string) => string) => {
      const { selectionStart: von, selectionEnd: bis, value } = eingabe;
      eingabe.setRangeText(macher(value.slice(von, bis)), von, bis, "select");
      eingabe.focus();
      eingabe.dispatchEvent(new Event("input"));
    };
    const werkzeuge = h(
      "span",
      { class: "feld-werkzeuge" },
      h("button", { type: "button", class: "leise", onclick: () => umforme((text) => `**${text || "fetter Text"}**`) }, "Fett"),
      h("button", {
        type: "button",
        class: "leise",
        onclick: () => umforme((text) => `\n\n${(text || "Punkt").split("\n").map((zeile) => `- ${zeile.replace(/^- /, "")}`).join("\n")}\n\n`),
      }, "Aufzählung"),
    );
    const zeile = h("span", { class: "feld-kopf" }, h("span", { class: "feld-name" }, beschriftung), werkzeuge);
    const melde = fehler[pfad];
    return h(
      "div",
      { class: melde ? "feld hat-fehler" : "feld", "data-pfad": pfad },
      zeile,
      eingabe,
      h("small", { class: "feld-hinweis" }, "Eine Leerzeile beginnt einen neuen Absatz."),
      melde ? h("small", { class: "feld-fehler", "data-fehler": pfad }, melde) : null,
    );
  }

  function titelbild(): HTMLElement {
    const datei = h("input", { type: "file", accept: "image/png,image/jpeg,image/webp,image/gif", hidden: true });
    datei.addEventListener("change", async () => {
      const gewaehlt = datei.files?.[0];
      if (!gewaehlt) return;
      const url = await anschluss.ladeBild(gewaehlt).catch(() => null);
      if (!url) return;
      a.bild.src = url.replace("/media/", "../media/");
      zeichne();
      geaendert();
    });
    return h(
      "section",
      { class: "feld-gruppe" },
      h("h2", {}, "Titelbild"),
      h("img", { class: "feld-bild", src: a.bild.src.replace("../media/", "/media/"), alt: "" }),
      h("div", { class: "aktionen" }, h("button", { type: "button", onclick: () => datei.click() }, "Bild ersetzen"), datei),
    );
  }

  function einstieg(): HTMLElement {
    const knopf = h("input", { type: "checkbox", checked: a.einstieg.knopf != null });
    knopf.addEventListener("change", () => {
      a.einstieg.knopf = knopf.checked ? { text: "Kontaktieren sie uns", ziel: "/kontakt" } : null;
      geaendert();
    });
    return h(
      "section",
      { class: "feld-gruppe" },
      h("h2", {}, "Einstieg"),
      feld("einstieg.titel", "Überschrift", a.einstieg.titel, (text) => (a.einstieg.titel = text)),
      textfeld("einstieg.text", "Text", a.einstieg.text, (text) => (a.einstieg.text = text)),
      h("label", { class: "feld-haken" }, knopf, " Knopf «Kontaktieren Sie uns» unter dem Text zeigen"),
    );
  }

  function leistungen(abschnitt: Abschnitt, nr: number): HTMLElement {
    const liste = h("div", { class: "leistungen" });
    abschnitt.leistungen.forEach((punkt, i) => {
      const eingabe = h("textarea", { rows: 1, "aria-label": `Leistung ${i + 1}`, "data-fokus": `${nr}.${i}` });
      eingabe.value = punkt;
      zuTextfeld(eingabe, () => {
        abschnitt.leistungen[i] = eingabe.value;
        geaendert();
      });
      eingabe.addEventListener("keydown", (event) => {
        // Enter legt den nächsten Punkt an. Eine zweite Zeile im selben Punkt geht mit Shift+Enter.
        if (event.key !== "Enter" || event.shiftKey) return;
        event.preventDefault();
        abschnitt.leistungen.splice(i + 1, 0, "");
        fokus = `${nr}.${i + 1}`;
        zeichne();
        geaendert();
      });
      liste.append(h(
        "div",
        { class: "leistung ziehbar" },
        griff((von, nach) => {
          verschiebe(abschnitt.leistungen, von, nach);
          zeichne();
          geaendert();
        }, `Leistung ${i + 1} verschieben`),
        eingabe,
        h("button", {
          type: "button",
          class: "werkzeug-klein",
          title: "Punkt entfernen",
          "aria-label": `Leistung ${i + 1} entfernen`,
          onclick: () => {
            abschnitt.leistungen.splice(i, 1);
            zeichne();
            geaendert();
          },
        }, "✕"),
      ));
    });
    return h(
      "div",
      { class: "feld" },
      h("span", { class: "feld-name" }, "Leistungen (rechte Spalte)"),
      liste,
      h("button", {
        type: "button",
        class: "leise",
        onclick: () => {
          abschnitt.leistungen.push("");
          fokus = `${nr}.${abschnitt.leistungen.length - 1}`;
          zeichne();
          geaendert();
        },
      }, "+ Punkt"),
    );
  }

  function griff(beimLoslassen: (von: number, nach: number) => void, name: string): HTMLElement {
    const el = h("span", {
      class: "griff",
      title: "Ziehen zum Verschieben",
      "aria-label": name,
      onclick: (event: Event) => event.preventDefault(),
    }, "⋮⋮");
    el.addEventListener("pointerdown", (event) => zieheStart(event, el, beimLoslassen));
    return el;
  }

  function abschnittKarte(abschnitt: Abschnitt, nr: number): HTMLElement {
    const hatFehler = Object.keys(fehler).some((pfad) => pfad.startsWith(`abschnitte.${nr}.`));
    const kopfTitel = h("span", { class: "karte-titel" }, abschnitt.titel || "Neuer Abschnitt");
    const zusatz = h("span", { class: "karte-zusatz" }, abschnitt.leistungen.length ? `${abschnitt.leistungen.length} Leistungen` : "");
    const verschieben = (nach: number) => (event: Event) => {
      event.preventDefault();
      verschiebe(a.abschnitte, nr, nach);
      zeichne();
      geaendert();
    };
    const karte = h(
      "details",
      { class: hatFehler ? "abschnitt-karte ziehbar hat-fehler" : "abschnitt-karte ziehbar", open: hatFehler || offen.has(abschnitt) },
      h(
        "summary",
        {},
        kopfTitel,
        zusatz,
        griff((von, nach) => {
          verschiebe(a.abschnitte, von, nach);
          zeichne();
          geaendert();
        }, `Abschnitt «${abschnitt.titel}» verschieben`),
        h("button", { type: "button", class: "werkzeug-klein", title: "Nach oben", "aria-label": "Nach oben", disabled: nr === 0, onclick: verschieben(nr - 1) }, "↑"),
        h("button", { type: "button", class: "werkzeug-klein", title: "Nach unten", "aria-label": "Nach unten", disabled: nr === a.abschnitte.length - 1, onclick: verschieben(nr + 1) }, "↓"),
        h("button", {
          type: "button",
          class: "werkzeug-klein gefahr",
          title: "Abschnitt entfernen",
          "aria-label": "Abschnitt entfernen",
          onclick: async (event: Event) => {
            event.preventDefault();
            const ja = await anschluss.frage({
              titel: "Abschnitt entfernen?",
              text: `«${abschnitt.titel || "Neuer Abschnitt"}» verschwindet aus der Seite.`,
              ja: "Entfernen",
              nein: "Abbrechen",
              gefahr: true,
            });
            if (!ja) return;
            a.abschnitte.splice(nr, 1);
            zeichne();
            geaendert();
          },
        }, "✕"),
      ),
      h(
        "div",
        { class: "karte-inhalt" },
        feld(`abschnitte.${nr}.titel`, "Titel", abschnitt.titel, (text) => {
          abschnitt.titel = text;
          kopfTitel.textContent = text || "Neuer Abschnitt";
        }, { hinweis: "Erscheint auch im Inhaltsverzeichnis oben auf der Seite." }),
        feld(`abschnitte.${nr}.untertitel`, "Untertitel (optional)", abschnitt.untertitel, (text) => (abschnitt.untertitel = text)),
        textfeld(`abschnitte.${nr}.text`, "Text", abschnitt.text, (text) => (abschnitt.text = text)),
        leistungen(abschnitt, nr),
      ),
    );
    karte.addEventListener("toggle", () => {
      if (karte.open) {
        offen.add(abschnitt);
        for (const feldEl of karte.querySelectorAll("textarea")) passeHoeheAn(feldEl);
      } else offen.delete(abschnitt);
    });
    return karte;
  }

  function abschnitte(): HTMLElement {
    return h(
      "section",
      { class: "feld-gruppe" },
      h("h2", {}, "Abschnitte"),
      h("p", { class: "leise" }, "Jeder Abschnitt zeigt links den Text und rechts die Leistungen. Die Reihenfolge hier ist die Reihenfolge auf der Website."),
      h("div", { class: "abschnitt-liste" }, ...a.abschnitte.map(abschnittKarte)),
      h("button", {
        type: "button",
        onclick: () => {
          const neu: Abschnitt = { titel: "", untertitel: "", text: "", leistungen: [] };
          offen.add(neu);
          a.abschnitte.push(neu);
          zeichne();
          geaendert();
        },
      }, "+ Abschnitt"),
    );
  }

  function band(): HTMLElement {
    return h(
      "section",
      { class: "feld-gruppe" },
      h("h2", {}, "Kontakt am Schluss"),
      textfeld("band.text", "Text über dem Knopf", a.band.text, (text) => (a.band.text = text)),
      h("p", { class: "leise" }, `Titel «${a.band.titel}» und Knopf «${a.band.knopf.text}» sind auf allen Seiten gleich.`),
    );
  }

  function zeichne(): void {
    const y = window.scrollY;
    host.replaceChildren(titelbild(), einstieg(), abschnitte(), band());
    for (const feldEl of host.querySelectorAll("textarea")) passeHoeheAn(feldEl);
    window.scrollTo(0, y);
    if (fokus) {
      host.querySelector<HTMLElement>(`[data-fokus="${fokus}"]`)?.focus();
      fokus = null;
    }
  }

  zeichne();

  return {
    markdown: () => schreibeAngebot(anschluss.seitenTitel(), a),
    setze(markdown) {
      const neu = liesAngebot(anschluss.seitenTitel(), markdown);
      if (!neu) return false;
      a = neu;
      fehler = {};
      zeichne();
      geaendert();
      return true;
    },
    fehler() {
      const neu = pruefeAngebot(anschluss.seitenTitel(), a);
      const vorher = JSON.stringify(fehler);
      fehler = neu;
      if (JSON.stringify(neu) !== vorher) {
        const aktiv = document.activeElement as HTMLElement | null;
        // Während des Tippens nicht neu zeichnen, sonst ist der Fokus weg.
        if (!aktiv || !host.contains(aktiv) || Object.keys(neu).length > Object.keys(JSON.parse(vorher)).length) zeichne();
      }
      const namen = Object.keys(neu);
      if (!namen.length) return null;
      return neu._ ?? "Nicht gespeichert: Bitte die rot markierten Felder ausfüllen.";
    },
  };
}
