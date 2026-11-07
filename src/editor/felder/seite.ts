import { alsText, ausText, pruefeFelder, type Felder, type Fehler, type Vorlage } from "../../content/seiten.ts";
import { waehleMedium } from "../ansichten/medien.ts";
import { h } from "../dom.ts";
import { verschiebe, zieheStart } from "./ziehen.ts";

/** Felder statt freier Text. Jede Vorlage sagt unten, welche Felder sie hat; der Rest ist für alle gleich. */

export interface FelderEditor {
  werte(): Felder;
  /** Die Seite als Text, für den Assistenten und den Fassungsvergleich. */
  markdown(): string;
  /** Übernimmt Text in die Felder. False: Er passt nicht hinein, die Felder bleiben, wie sie sind. */
  setze(markdown: string): boolean;
  /** Was das Speichern verhindert, und die Felder zeigen es. Null: alles in Ordnung. */
  fehler(): string | null;
  /** Zeigt Fehler, die der Server gemeldet hat. */
  zeigeFehler(fehler: Fehler): void;
  /** Springt zur Beschreibung eines Bildes. False: Dieses Bild hat hier kein Feld. */
  fokusBild(datei: string): boolean;
}

export interface FelderAnschluss {
  seitenTitel(): string;
  geaendert(): void;
  ladeBild(datei: File): Promise<string>;
  frage(optionen: { titel: string; text: string; ja: string; nein?: string; gefahr?: boolean }): Promise<boolean>;
}

/* eslint-disable-next-line @typescript-eslint/no-explicit-any */
type Daten = any;

/** Ein Feld wächst mit dem Text. In einem zugeklappten Abschnitt ist es 0 hoch; das holt `toggle` nach. */
function passeHoeheAn(feld: HTMLTextAreaElement): void {
  feld.style.height = "auto";
  if (feld.scrollHeight) feld.style.height = `${feld.scrollHeight + 2}px`;
}

const mediaPfad = (src: string) => src.replace(/^\.\.\/media\//, "/media/");
const dateiPfad = (name: string) => `../media/${name}`;

interface ListenOptionen {
  neu?: () => unknown;
  neuLabel?: string;
  titel: (eintrag: Daten) => string;
  zusatz?: (eintrag: Daten) => string;
  /** Wie viele mindestens bleiben müssen. */
  mindestens?: number;
}

export function mountSeite(host: HTMLElement, vorlage: Vorlage, start: Felder, anschluss: FelderAnschluss): FelderEditor {
  let daten: Daten = structuredClone(start);
  let fehler: Fehler = {};
  /** Offene Einträge. Am Objekt, nicht an der Nummer: So bleiben sie beim Verschieben offen. */
  let offen = new WeakSet<object>();
  /** Neue Punkte bekommen den Fokus nach dem Neuzeichnen. */
  let fokus: string | null = null;

  const lies = (pfad: string): Daten => pfad.split(".").reduce((wert: Daten, teil) => wert?.[teil], daten);
  const schreibe = (pfad: string, wert: unknown) => {
    const teile = pfad.split(".");
    const letzter = teile.pop()!;
    teile.reduce((obj: Daten, teil) => obj[teil], daten)[letzter] = wert;
  };

  function pruefeStill(): void {
    const neu = pruefeFelder(vorlage, anschluss.seitenTitel(), daten);
    for (const pfad of Object.keys(fehler)) {
      if (neu[pfad]) continue;
      host.querySelector(`[data-pfad="${CSS.escape(pfad)}"]`)?.classList.remove("hat-fehler");
      host.querySelector(`[data-fehler="${CSS.escape(pfad)}"]`)?.remove();
    }
    fehler = neu;
  }

  const geaendert = () => {
    // Steht schon ein Fehler da, verschwindet er, sobald er behoben ist.
    if (Object.keys(fehler).length) pruefeStill();
    anschluss.geaendert();
  };
  const neuGezeichnet = () => {
    zeichne();
    geaendert();
  };

  function rahmen(tag: "label" | "div", pfad: string, kopf: HTMLElement, eingabe: HTMLElement, hinweis?: string): HTMLElement {
    const meldung = fehler[pfad];
    return h(
      tag,
      { class: meldung ? "feld hat-fehler" : "feld", "data-pfad": pfad },
      kopf,
      eingabe,
      hinweis ? h("small", { class: "feld-hinweis" }, hinweis) : null,
      meldung ? h("small", { class: "feld-fehler", "data-fehler": pfad }, meldung) : null,
    );
  }

  /** Eine Zeile Text. */
  function zeile(pfad: string, name: string, optionen: { hinweis?: string; platzhalter?: string; beimTippen?: (text: string) => void } = {}): HTMLElement {
    const eingabe = h("input", { type: "text", placeholder: optionen.platzhalter });
    eingabe.value = String(lies(pfad) ?? "");
    eingabe.addEventListener("input", () => {
      schreibe(pfad, eingabe.value);
      optionen.beimTippen?.(eingabe.value);
      geaendert();
    });
    return rahmen("label", pfad, h("span", { class: "feld-name" }, name), eingabe, optionen.hinweis);
  }

  /** Text mit Absätzen und Aufzählungen. Zwei Knöpfe, damit niemand die Schreibweise kennen muss. */
  function text(pfad: string, name: string, optionen: { hinweis?: string; einfach?: boolean } = {}): HTMLElement {
    const eingabe = h("textarea", { rows: 3 });
    eingabe.value = String(lies(pfad) ?? "");
    eingabe.addEventListener("input", () => {
      passeHoeheAn(eingabe);
      schreibe(pfad, eingabe.value);
      geaendert();
    });
    const umforme = (macher: (auswahl: string) => string) => {
      const { selectionStart: von, selectionEnd: bis, value } = eingabe;
      eingabe.setRangeText(macher(value.slice(von, bis)), von, bis, "select");
      eingabe.focus();
      eingabe.dispatchEvent(new Event("input"));
    };
    const kopf = h(
      "span",
      { class: "feld-kopf" },
      h("span", { class: "feld-name" }, name),
      optionen.einfach
        ? null
        : h(
            "span",
            { class: "feld-werkzeuge" },
            h("button", { type: "button", class: "leise", onclick: () => umforme((auswahl) => `**${auswahl || "fetter Text"}**`) }, "Fett"),
            h("button", {
              type: "button",
              class: "leise",
              onclick: () => umforme((auswahl) => `\n\n${(auswahl || "Punkt").split("\n").map((z) => `- ${z.replace(/^- /, "")}`).join("\n")}\n\n`),
            }, "Aufzählung"),
          ),
    );
    return rahmen("div", pfad, kopf, eingabe, optionen.hinweis ?? (optionen.einfach ? undefined : "Eine Leerzeile beginnt einen neuen Absatz."));
  }

  /**
   * Ein Bild: `pfad` zeigt auf eine Datei, oder mit `beschreibung` auf { src, alt }.
   * `nurBeimTeilen`: Hintergrund- oder Vorschaubild. Seine Beschreibung sieht nur, wer die Seite geteilt bekommt.
   */
  function bild(pfad: string, name: string, optionen: { beschreibung?: boolean; nurBeimTeilen?: boolean; hinweis?: string; dunkel?: boolean } = {}): HTMLElement {
    const srcPfad = optionen.beschreibung === undefined && typeof lies(pfad) === "string" ? pfad : `${pfad}.src`;
    const src = String(lies(srcPfad) ?? "");
    const setze = (wert: string) => {
      schreibe(srcPfad, wert);
      neuGezeichnet();
    };
    const datei = h("input", { type: "file", accept: "image/png,image/jpeg,image/webp,image/gif,image/svg+xml", hidden: true });
    datei.addEventListener("change", async () => {
      const gewaehlt = datei.files?.[0];
      if (!gewaehlt) return;
      const url = await anschluss.ladeBild(gewaehlt).catch(() => null);
      if (url) setze(url.replace("/media/", "../media/"));
    });
    const meldung = fehler[srcPfad];
    const dateiName = src.split("/").pop() ?? "";
    return h(
      "div",
      { class: meldung ? "feld hat-fehler" : "feld", "data-pfad": srcPfad, "data-bild": optionen.nurBeimTeilen ? null : dateiName },
      h("span", { class: "feld-name" }, name),
      src ? h("img", { class: optionen.dunkel ? "feld-bild dunkel" : "feld-bild", src: mediaPfad(src), alt: "" }) : null,
      h(
        "div",
        { class: "aktionen" },
        h("button", { type: "button", onclick: () => datei.click() }, src ? "Bild ersetzen" : "Bild hochladen"),
        h("button", {
          type: "button",
          class: "leise",
          onclick: async () => {
            const gewaehlt = await waehleMedium();
            if (gewaehlt) setze(dateiPfad(gewaehlt));
          },
        }, "Aus Medien wählen"),
        datei,
      ),
      optionen.hinweis ? h("small", { class: "feld-hinweis" }, optionen.hinweis) : null,
      meldung ? h("small", { class: "feld-fehler", "data-fehler": srcPfad }, meldung) : null,
      optionen.beschreibung
        ? zeile(`${pfad}.alt`, "Bildbeschreibung", {
            hinweis: optionen.nurBeimTeilen
              ? "Was ist zu sehen? Erscheint, wenn jemand die Seite teilt (WhatsApp, LinkedIn), nicht in der Google-Suche."
              : "Für Google und blinde Menschen: Was ist zu sehen?",
          })
        : null,
    );
  }

  /** Beschriftung und Ziel eines Knopfs. */
  function knopf(pfad: string, name: string): HTMLElement {
    return h(
      "div",
      { class: "feld-paar" },
      zeile(`${pfad}.text`, `${name}: Beschriftung`),
      zeile(`${pfad}.ziel`, `${name}: führt zu`, { platzhalter: "/kontakt oder https://…" }),
    );
  }

  /** Ein Knopf, der auch fehlen darf. */
  function knopfHaken(pfad: string, name: string): HTMLElement {
    const haken = h("input", { type: "checkbox", checked: lies(pfad) != null });
    haken.addEventListener("change", () => {
      schreibe(pfad, haken.checked ? { text: "Kontaktieren Sie uns", ziel: "/kontakt" } : null);
      neuGezeichnet();
    });
    return h("div", { class: "feld" }, h("label", { class: "feld-haken" }, haken, ` ${name}`), lies(pfad) ? knopf(pfad, "Knopf") : null);
  }

  function griff(beimLoslassen: (von: number, nach: number) => void, name: string): HTMLElement {
    const el = h("span", { class: "griff", title: "Ziehen zum Verschieben", "aria-label": name, onclick: (event: Event) => event.preventDefault() }, "⋮⋮");
    el.addEventListener("pointerdown", (event) => zieheStart(event, el, beimLoslassen));
    return el;
  }

  /** Einfache Punkte, einer je Zeile. Enter legt den nächsten an, Shift+Enter eine zweite Zeile im selben. */
  function punkte(pfad: string, name: string): HTMLElement {
    const liste: string[] = lies(pfad);
    const reihe = h("div", { class: "leistungen" });
    liste.forEach((punkt, i) => {
      const eingabe = h("textarea", { rows: 1, "aria-label": `${name} ${i + 1}`, "data-fokus": `${pfad}.${i}` });
      eingabe.value = punkt;
      eingabe.addEventListener("input", () => {
        passeHoeheAn(eingabe);
        liste[i] = eingabe.value;
        geaendert();
      });
      eingabe.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" || event.shiftKey) return;
        event.preventDefault();
        liste.splice(i + 1, 0, "");
        fokus = `${pfad}.${i + 1}`;
        neuGezeichnet();
      });
      reihe.append(h(
        "div",
        { class: "leistung ziehbar" },
        griff((von, nach) => {
          verschiebe(liste, von, nach);
          neuGezeichnet();
        }, `${name} ${i + 1} verschieben`),
        eingabe,
        h("button", {
          type: "button",
          class: "werkzeug-klein",
          title: "Punkt entfernen",
          "aria-label": `${name} ${i + 1} entfernen`,
          onclick: () => {
            liste.splice(i, 1);
            neuGezeichnet();
          },
        }, "✕"),
      ));
    });
    return h(
      "div",
      { class: "feld" },
      h("span", { class: "feld-name" }, name),
      reihe,
      h("button", {
        type: "button",
        class: "leise",
        onclick: () => {
          liste.push("");
          fokus = `${pfad}.${liste.length - 1}`;
          neuGezeichnet();
        },
      }, "+ Punkt"),
    );
  }

  /** Eine sortierbare Liste von Einträgen mit eigenen Feldern, zugeklappt. */
  function liste(pfad: string, inhalt: (eintragPfad: string, eintrag: Daten) => (HTMLElement | null)[], optionen: ListenOptionen): HTMLElement[] {
    const eintraege: Daten[] = lies(pfad);
    const karte = (eintrag: Daten, nr: number) => {
      const eintragPfad = `${pfad}.${nr}`;
      const hatFehler = Object.keys(fehler).some((name) => name.startsWith(`${eintragPfad}.`));
      const kopfTitel = h("span", { class: "karte-titel" }, optionen.titel(eintrag) || "Neuer Eintrag");
      const verschieben = (nach: number) => (event: Event) => {
        event.preventDefault();
        verschiebe(eintraege, nr, nach);
        neuGezeichnet();
      };
      const kann = eintraege.length > (optionen.mindestens ?? 0);
      const el = h(
        "details",
        { class: hatFehler ? "abschnitt-karte ziehbar hat-fehler" : "abschnitt-karte ziehbar", open: hatFehler || offen.has(eintrag) },
        h(
          "summary",
          {},
          kopfTitel,
          h("span", { class: "karte-zusatz" }, optionen.zusatz?.(eintrag) ?? ""),
          eintraege.length > 1
            ? griff((von, nach) => {
                verschiebe(eintraege, von, nach);
                neuGezeichnet();
              }, `«${optionen.titel(eintrag)}» verschieben`)
            : null,
          h("button", { type: "button", class: "werkzeug-klein", title: "Nach oben", "aria-label": "Nach oben", disabled: nr === 0, onclick: verschieben(nr - 1) }, "↑"),
          h("button", { type: "button", class: "werkzeug-klein", title: "Nach unten", "aria-label": "Nach unten", disabled: nr === eintraege.length - 1, onclick: verschieben(nr + 1) }, "↓"),
          kann && optionen.neu
            ? h("button", {
                type: "button",
                class: "werkzeug-klein gefahr",
                title: "Entfernen",
                "aria-label": "Entfernen",
                onclick: async (event: Event) => {
                  event.preventDefault();
                  const ja = await anschluss.frage({
                    titel: "Entfernen?",
                    text: `«${optionen.titel(eintrag) || "Neuer Eintrag"}» verschwindet aus der Seite.`,
                    ja: "Entfernen",
                    nein: "Abbrechen",
                    gefahr: true,
                  });
                  if (!ja) return;
                  eintraege.splice(eintraege.indexOf(eintrag), 1);
                  neuGezeichnet();
                },
              }, "✕")
            : null,
        ),
        h("div", { class: "karte-inhalt" }, ...inhalt(eintragPfad, eintrag)),
      );
      el.addEventListener("input", () => {
        kopfTitel.textContent = optionen.titel(eintrag) || "Neuer Eintrag";
      });
      el.addEventListener("toggle", () => {
        if (el.open) {
          offen.add(eintrag);
          for (const feld of el.querySelectorAll("textarea")) passeHoeheAn(feld);
        } else offen.delete(eintrag);
      });
      return el;
    };
    const teile: (HTMLElement | null)[] = [
      h("div", { class: "abschnitt-liste" }, ...eintraege.map(karte)),
      optionen.neu
        ? h("button", {
            type: "button",
            class: "liste-neu",
            onclick: () => {
              const neu = optionen.neu!() as object;
              offen.add(neu);
              eintraege.push(neu);
              neuGezeichnet();
            },
          }, `+ ${optionen.neuLabel ?? "Eintrag"}`)
        : null,
    ];
    return teile.filter((el): el is HTMLElement => el !== null);
  }

  const gruppe = (titel: string, ...kinder: (HTMLElement | HTMLElement[] | null)[]) =>
    h("section", { class: "feld-gruppe" }, h("h2", {}, titel), ...kinder.flat());
  const notiz = (text_: string) => h("p", { class: "leise" }, text_);

  const titelbild = () => gruppe("Titelbild", bild("bild", "Bild oben auf der Seite", { beschreibung: true, nurBeimTeilen: true, hinweis: "Querformat, mindestens 2000 Pixel breit. Darüber steht der Titel der Seite." }));
  const band = () => gruppe(
    "Kontakt am Schluss",
    zeile("band.titel", "Titel"),
    text("band.text", "Text über dem Knopf", { einfach: true }),
    knopf("band.knopf", "Knopf"),
    notiz("Telefon und E-Mail neben dem Knopf stehen auf allen Seiten gleich. Sie kommen aus «Verwaltung», «Allgemein»."),
  );
  const karten = (pfad: string) => liste(pfad, (p) => [
    zeile(`${p}.titel`, "Titel"),
    bild(`${p}.bild`, "Bild"),
    zeile(`${p}.ziel`, "Führt zu", { platzhalter: "/privatpersonen" }),
  ], { titel: (k) => k.titel, neu: () => ({ titel: "", bild: lies(`${pfad}.0.bild`) ?? lies("bild.src"), ziel: "" }), neuLabel: "Karte", mindestens: 1 });

  const AUFBAU: Record<Vorlage, () => HTMLElement[]> = {
    abschnitte: () => [
      titelbild(),
      gruppe("Einstieg", zeile("einstieg.titel", "Überschrift"), text("einstieg.text", "Text"), knopfHaken("einstieg.knopf", "Knopf unter dem Text zeigen")),
      gruppe(
        "Abschnitte",
        notiz("Mit Leistungen steht links der Text und rechts die Liste, und der Abschnitt erscheint im Inhaltsverzeichnis oben. Die Reihenfolge hier ist die auf der Website."),
        liste("abschnitte", (p) => [
          zeile(`${p}.titel`, "Titel"),
          zeile(`${p}.untertitel`, "Untertitel (optional)"),
          text(`${p}.text`, "Text"),
          punkte(`${p}.leistungen`, "Leistungen (rechte Spalte)"),
        ], {
          titel: (a) => a.titel,
          zusatz: (a) => (a.leistungen.length ? `${a.leistungen.length} Leistungen` : ""),
          neu: () => ({ titel: "", untertitel: "", text: "", leistungen: [] }),
          neuLabel: "Abschnitt",
        }),
      ),
      band(),
    ],
    uebersicht: () => [
      titelbild(),
      gruppe("Text", text("text", "Text")),
      gruppe("Karten", notiz("Bild mit Titel, die zu einer anderen Seite führen."), karten("karten")),
      band(),
    ],
    start: () => [
      gruppe(
        "Kopf der Startseite",
        bild("bild", "Grosses Bild", { beschreibung: true, nurBeimTeilen: true }),
        bild("signet", "Zeichen über dem Titel", { dunkel: true }),
        zeile("titel", "Titel"),
        zeile("untertitel", "Untertitel"),
      ),
      gruppe("Einstieg", zeile("einstieg.titel", "Überschrift"), text("einstieg.text", "Text")),
      gruppe("Karten", karten("karten"), knopf("kartenKnopf", "Knopf darunter")),
      gruppe("Neuigkeiten", notiz("Die drei neuesten Newsletter erscheinen hier von selbst."), zeile("neuigkeiten.titel", "Titel"), knopf("neuigkeiten.knopf", "Knopf darunter")),
      band(),
    ],
    "ueber-uns": () => [
      titelbild(),
      gruppe("Einstieg", zeile("einstieg.titel", "Überschrift"), text("einstieg.text", "Text"), knopfHaken("einstieg.knopf", "Knopf unter dem Text zeigen")),
      gruppe(
        "Person",
        zeile("sparring.titel", "Titel des Abschnitts"),
        bild("sparring.portrait", "Porträt", { beschreibung: true }),
        zeile("sparring.name", "Name"),
        text("sparring.angaben", "Angaben unter dem Namen"),
        liste("sparring.stationen", (p) => [zeile(`${p}.titel`, "Titel"), text(`${p}.text`, "Text")], { titel: (s) => s.titel, neu: () => ({ titel: "", text: "" }), neuLabel: "Station" }),
      ),
      gruppe(
        "Partner",
        zeile("partner.titel", "Titel des Abschnitts"),
        liste("partner.firmen", (p) => [
          zeile(`${p}.name`, "Name"),
          zeile(`${p}.untertitel`, "Zeile darunter"),
          text(`${p}.text`, "Text"),
          bild(`${p}.logo`, "Logo", { beschreibung: true }),
          zeile(`${p}.link`, "Webseite", { platzhalter: "https://…" }),
        ], {
          titel: (f) => f.name,
          neu: () => ({ name: "", untertitel: "", text: "", logo: { src: lies("sparring.portrait.src"), alt: "" }, link: "" }),
          neuLabel: "Partner",
        }),
      ),
      band(),
    ],
    kontakt: () => [
      titelbild(),
      gruppe("Einstieg", zeile("einstieg.titel", "Überschrift"), text("einstieg.text", "Text", { hinweis: "Das Formular kommt von selbst daneben. Ein Link schreibt sich so: [Text](mailto:adresse@beispiel.ch)." })),
      gruppe("Standort", zeile("standort.titel", "Titel"), text("standort.text", "Text", { einfach: true })),
      gruppe(
        "Adresse",
        notiz("Adresse, E-Mail und Telefon selbst stehen unter «Verwaltung», «Allgemein» und gelten dort für die ganze Website. Hier nur die Titel darüber."),
        zeile("adresse.titel", "Titel Adresse"),
        zeile("email.titel", "Titel E-Mail"),
        zeile("telefon.titel", "Titel Telefon"),
      ),
      gruppe("Karte", zeile("karte", "Einbettungs-Link von Google Maps", { platzhalter: "https://www.google.com/maps/embed?…" })),
    ],
    neuigkeiten: () => [
      gruppe("Einleitung", notiz("Die Liste der Newsletter, die Suche und die Jahre baut die Website selbst."), text("text", "Kurzer Text über der Liste", { einfach: true })),
      gruppe("Vorschaubild", bild("bild", "Bild beim Teilen der Seite", { beschreibung: true, nurBeimTeilen: true, hinweis: "Erscheint, wenn jemand die Seite teilt. Auf der Seite selbst steht kein Titelbild." })),
      band(),
    ],
  };

  function zeichne(): void {
    const y = window.scrollY;
    host.replaceChildren(...AUFBAU[vorlage]());
    for (const feld of host.querySelectorAll("textarea")) passeHoeheAn(feld);
    window.scrollTo(0, y);
    if (fokus) {
      host.querySelector<HTMLElement>(`[data-fokus="${CSS.escape(fokus)}"]`)?.focus();
      fokus = null;
    }
  }

  zeichne();

  return {
    werte: () => structuredClone(daten),
    markdown: () => alsText(vorlage, anschluss.seitenTitel(), daten),
    setze(markdown) {
      const neu = ausText(vorlage, anschluss.seitenTitel(), markdown);
      if (!neu) return false;
      daten = neu;
      offen = new WeakSet();
      fehler = {};
      neuGezeichnet();
      return true;
    },
    fehler() {
      const neu = pruefeFelder(vorlage, anschluss.seitenTitel(), daten);
      const namen = Object.keys(neu).filter((name) => name !== "titel");
      const vorher = Object.keys(fehler).length;
      const hinzu = Object.keys(neu).some((name) => !fehler[name]);
      fehler = neu;
      // Während des Tippens nicht neu zeichnen, sonst ist der Fokus weg. Nur wenn etwas dazukommt.
      if (hinzu || namen.length !== vorher) zeichne();
      if (!namen.length) return neu.titel ?? null;
      return neu._ ?? "Nicht gespeichert: Bitte die rot markierten Felder ausfüllen.";
    },
    zeigeFehler(neu) {
      fehler = neu;
      zeichne();
      host.querySelector(".hat-fehler")?.scrollIntoView({ block: "center", behavior: "smooth" });
    },
    fokusBild(datei) {
      const feld = host.querySelector<HTMLElement>(`[data-bild="${CSS.escape(datei)}"]`);
      const karte = feld?.closest("details");
      if (karte) karte.open = true;
      const beschreibung = feld?.querySelector<HTMLInputElement>("input[type=text]");
      if (!feld || !beschreibung) return false;
      feld.scrollIntoView({ block: "center", behavior: "smooth" });
      beschreibung.focus({ preventScroll: true });
      return true;
    },
  };
}
