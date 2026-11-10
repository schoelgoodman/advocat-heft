import { allgemeinAus, pruefeAllgemein, type Allgemein, type AllgemeinFehler } from "../../content/allgemein.ts";
import { assistentBeimStart, merkeAssistentBeimStart } from "../assistent.ts";
import { fehlerText, h, toast } from "../dom.ts";
import { schrift, setzeSchrift, setzeThema, thema, type Schrift, type Thema } from "../einstellungen.ts";

/**
 * «Verwaltung», «Allgemein»: Firma, Adresse, Telefon, E-Mail, Handelsregister und der Kontakt am
 * Schluss der Newsletter. Anders als die Seiten speichert sie erst mit «Speichern»: Die Angaben
 * gelten dann sofort auf der ganzen Website und ersetzen die alten im Rechtlichen.
 */

export interface AllgemeinAnsicht {
  lade(): Promise<void>;
  /** Gibt es Änderungen, die noch nicht gespeichert sind? */
  ungespeichert(): boolean;
  /** Vergisst die Änderungen, etwa wenn Patrick trotzdem wechselt. */
  verwirf(): void;
}

interface Feld {
  pfad: string;
  name: string;
  hinweis?: string;
  platzhalter?: string;
  art?: "email" | "tel" | "url";
  schmal?: boolean;
}

const GRUPPEN: { titel: string; notiz?: string; felder: Feld[] }[] = [
  {
    titel: "Firma und Adresse",
    notiz: "Im Fuss jeder Seite, auf der Kontaktseite, im Impressum und im Datenschutz.",
    felder: [
      { pfad: "firma", name: "Firma" },
      { pfad: "strasse", name: "Strasse und Hausnummer" },
      { pfad: "plz", name: "Postleitzahl", schmal: true, platzhalter: "9000" },
      { pfad: "ort", name: "Ort", hinweis: "So, wie er in der Adresse steht, zum Beispiel «St.Gallen». Davor steht «CH-» und die Postleitzahl." },
      {
        pfad: "karte",
        name: "Link zu Google Maps",
        art: "url",
        platzhalter: "https://maps.app.goo.gl/…",
        hinweis: "Führt von der Adresse im Fuss und von «In Google Maps öffnen» auf der Kontaktseite zu Google Maps. In Google Maps: «Teilen», dann «Link kopieren». Leer: kein Link. Die eingebettete Karte auf der Kontaktseite steht bei der Seite Kontakt.",
      },
    ],
  },
  {
    titel: "Telefon und E-Mail",
    notiz: "Im Fuss, neben jedem «Kontaktieren Sie uns.», auf der Kontaktseite und im Rechtlichen.",
    felder: [
      { pfad: "telefon", name: "Telefon", art: "tel", platzhalter: "+41 71 242 30 30" },
      { pfad: "email", name: "E-Mail", art: "email", platzhalter: "office@advocat-finanz.ch" },
    ],
  },
  {
    titel: "Handelsregister",
    notiz: "Steht im Impressum.",
    felder: [
      { pfad: "uid", name: "UID", platzhalter: "CHE-…" },
      { pfad: "handelsregister", name: "Handelsregister-Nr." },
      { pfad: "mwst", name: "MWST-Nr." },
      { pfad: "gerichtsstand", name: "Gerichtsstand" },
      { pfad: "vertreten", name: "Vertreten durch" },
    ],
  },
  {
    titel: "Kontakt am Schluss der Newsletter",
    notiz: "Unter jedem Newsletter, mit Telefon, E-Mail und dem Knopf zur Kontaktseite. Neue Seiten bekommen diesen Text als Vorgabe; die bestehenden Seiten haben ihren eigenen unter «Kontakt am Schluss».",
    felder: [
      { pfad: "band.titel", name: "Titel" },
      { pfad: "band.text", name: "Satz darunter" },
    ],
  },
];

/* eslint-disable-next-line @typescript-eslint/no-explicit-any */
const lies = (daten: Allgemein, pfad: string): string => String(pfad.split(".").reduce((wert: any, teil) => wert?.[teil], daten) ?? "");
function schreibe(daten: Allgemein, pfad: string, wert: string): void {
  const teile = pfad.split(".");
  const letzter = teile.pop()!;
  /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
  (teile.reduce((obj: any, teil) => obj[teil], daten) as Record<string, string>)[letzter] = wert;
}

export function allgemeinAnsicht(host: HTMLElement): AllgemeinAnsicht {
  let gespeichert: Allgemein | null = null;
  let daten: Allgemein | null = null;
  let version = "";
  let fehler: AllgemeinFehler = {};
  let speichertGerade = false;

  const formular = h("div", { class: "allgemein-felder" });
  const speichern = h("button", { type: "button", class: "haupt", id: "allgemein-speichern" }, "Speichern");
  const verwerfen = h("button", { type: "button", id: "allgemein-verwerfen" }, "Verwerfen");
  const stand = h("p", { class: "stand", role: "status" });

  const geaendert = () => daten != null && gespeichert != null && JSON.stringify(daten) !== JSON.stringify(gespeichert);

  function zeigeStand(): void {
    const offen = geaendert();
    speichern.disabled = !offen || speichertGerade;
    verwerfen.hidden = !offen;
    stand.textContent = speichertGerade ? "Speichert …" : offen ? "Nicht gespeichert. «Speichern» ändert die Angaben sofort auf der ganzen Website." : "Gilt so auf der Website.";
  }

  function feld(f: Feld): HTMLElement {
    const meldung = fehler[f.pfad];
    const eingabe = h("input", {
      type: f.art ?? "text",
      placeholder: f.platzhalter,
      autocomplete: "off",
      spellcheck: f.art ? "false" : null,
      inputmode: f.pfad === "plz" ? "numeric" : null,
      maxlength: 300,
    });
    eingabe.value = lies(daten!, f.pfad);
    eingabe.addEventListener("input", () => {
      schreibe(daten!, f.pfad, eingabe.value);
      // Ein Fehler verschwindet, sobald er behoben ist.
      if (fehler[f.pfad] && !pruefeAllgemein(allgemeinAus(daten))[f.pfad]) {
        delete fehler[f.pfad];
        rahmen.classList.remove("hat-fehler");
        rahmen.querySelector(".feld-fehler")?.remove();
      }
      zeigeStand();
    });
    const rahmen = h(
      "label",
      { class: `${meldung ? "feld hat-fehler" : "feld"}${f.schmal ? " schmal" : ""}`, "data-pfad": f.pfad },
      h("span", { class: "feld-name" }, f.name),
      eingabe,
      f.hinweis ? h("small", { class: "feld-hinweis" }, f.hinweis) : null,
      meldung ? h("small", { class: "feld-fehler" }, meldung) : null,
    );
    return rahmen;
  }

  /**
   * Der Teil «Redaktion»: keine Angaben der Website, sondern Vorlieben. Sie gelten sofort, ohne «Speichern»,
   * und stehen im Browser, nicht im Inhalt.
   */
  function redaktionGruppen(): HTMLElement[] {
    const haken = h("input", { type: "checkbox", id: "assistent-beim-start", checked: assistentBeimStart() });
    haken.addEventListener("change", () => {
      merkeAssistentBeimStart(haken.checked);
      toast(haken.checked ? "Der Assistent ist beim Öffnen der Redaktion wieder da." : "Der Assistent bleibt beim Öffnen der Redaktion zu. Der Knopf «Assistent» unten rechts öffnet ihn.");
    });
    /** Eine Auswahl aus wenigen Möglichkeiten, als Knöpfe nebeneinander. */
    const wahl = <T extends string>(id: string, name: string, heute: T, moeglich: [T, string][], setze: (wert: T) => void, hinweis: string): HTMLElement => {
      const knoepfe = moeglich.map(([wert, text]) => {
        const knopf = h("button", { type: "button", "data-wert": wert, "aria-pressed": String(wert === heute) }, text);
        knopf.addEventListener("click", () => {
          setze(wert);
          for (const anderer of knoepfe) anderer.setAttribute("aria-pressed", String(anderer === knopf));
        });
        return knopf;
      });
      return h(
        "div",
        { class: "wahl", id },
        h("span", { class: "feld-name", id: `${id}-name` }, name),
        h("div", { class: "wahl-knoepfe", role: "group", "aria-labelledby": `${id}-name` }, ...knoepfe),
        h("small", { class: "feld-hinweis" }, hinweis),
      );
    };
    return [
      h(
        "section",
        { class: "feld-gruppe" },
        h("h2", {}, "Darstellung"),
        h("p", { class: "leise" }, "Wie die Redaktion aussieht. Die Website und die Vorschau bleiben, wie Besucher sie sehen."),
        wahl<Thema>("wahl-thema", "Aussehen", thema(), [["hell", "Hell"], ["dunkel", "Dunkel"], ["geraet", "Wie das Gerät"]], setzeThema,
          "«Wie das Gerät» folgt der Einstellung von Computer oder Telefon, etwa abends dunkel."),
        wahl<Schrift>("wahl-schrift", "Schriftgrösse", schrift(), [["normal", "Normal"], ["gross", "Gross"]], setzeSchrift,
          "«Gross» vergrössert alles in der Redaktion um eine Stufe."),
      ),
      h(
        "section",
        { class: "feld-gruppe" },
        h("h2", {}, "Assistent"),
        h("p", { class: "leise" }, "Der Assistent rechts hilft beim Schreiben und mit der Redaktion."),
        h("div", { class: "wahl" },
          h("label", { class: "feld-haken" }, haken, " Assistent beim Öffnen der Redaktion zeigen"),
          h("small", { class: "feld-hinweis" }, "Ohne Haken wartet er hinter dem Knopf «Assistent» unten rechts. Auf dem Telefon und in schmalen Fenstern ist das immer so."),
        ),
      ),
    ];
  }

  function zeichne(): void {
    if (!daten) return;
    formular.replaceChildren(...GRUPPEN.map((gruppe) => h(
      "section",
      { class: "feld-gruppe" },
      h("h2", {}, gruppe.titel),
      gruppe.notiz ? h("p", { class: "leise" }, gruppe.notiz) : null,
      ...gruppe.felder.map(feld),
    )));
    zeigeStand();
  }

  async function sichere(): Promise<void> {
    if (!daten || !geaendert() || speichertGerade) return;
    fehler = pruefeAllgemein(allgemeinAus(daten));
    if (Object.keys(fehler).length) {
      zeichne();
      formular.querySelector(".hat-fehler input")?.scrollIntoView({ block: "center", behavior: "smooth" });
      toast("Nicht gespeichert: Bitte die rot markierten Felder prüfen.", undefined, true);
      return;
    }
    speichertGerade = true;
    zeigeStand();
    const antwort = await fetch("/api/allgemein", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ allgemein: daten, version }),
    }).catch(() => null);
    speichertGerade = false;
    if (!antwort?.ok) {
      if (antwort?.status === 422) {
        fehler = ((await antwort.json().catch(() => ({}))) as { felder?: AllgemeinFehler }).felder ?? {};
        zeichne();
        toast("Nicht gespeichert: Bitte die rot markierten Felder prüfen.", undefined, true);
        return;
      }
      zeigeStand();
      toast(antwort ? await fehlerText(antwort, "Speichern ging nicht.") : "Keine Verbindung zum Server. Nichts gespeichert.", undefined, true);
      return;
    }
    const json = (await antwort.json()) as { allgemein: Allgemein; version: string; angepasst: string[] };
    gespeichert = json.allgemein;
    daten = structuredClone(json.allgemein);
    version = json.version;
    fehler = {};
    zeichne();
    toast(json.angepasst.length
      ? `Gespeichert. Auch im Text angepasst: ${json.angepasst.join(", ")}.`
      : "Gespeichert. Die Website ist in wenigen Sekunden überall aktuell.");
  }

  speichern.addEventListener("click", () => void sichere());
  verwerfen.addEventListener("click", () => {
    if (!gespeichert) return;
    daten = structuredClone(gespeichert);
    fehler = {};
    zeichne();
  });
  // Ctrl+S (Mac: Cmd+S) wie bei den Seiten.
  host.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      void sichere();
    }
  });

  // Zwei Teile auf einer Seite. Die Leiste mit «Speichern» gehört nur zur Website: In der Redaktion gilt alles sofort.
  const teilWebsite = h(
    "div",
    { id: "allgemein-website", role: "tabpanel", "aria-labelledby": "reiter-website" },
    h("p", { class: "leise einleitung" }, "Firma, Adresse und Kontakt, wie sie auf der Website stehen: im Fuss jeder Seite, auf der Kontaktseite, neben jedem «Kontaktieren Sie uns.» und in den Angaben für Google. Erst «Speichern» ändert sie, dann aber sofort überall. Stehen die alten Angaben im Impressum, im Datenschutz, im Disclaimer oder im Text der Kontaktseite, werden sie dort mit ersetzt."),
    h("div", { class: "leiste allgemein-leiste" }, stand, h("div", { class: "aktionen" }, verwerfen, speichern)),
    formular,
  );
  const teilRedaktion = h(
    "div",
    { id: "allgemein-redaktion", role: "tabpanel", "aria-labelledby": "reiter-redaktion", hidden: true },
    h("p", { class: "leise einleitung" }, "Wie die Redaktion für dich aussieht und sich verhält. Jede Wahl gilt sofort, ohne «Speichern», und nur in diesem Browser: Auf dem Telefon oder an einem anderen Computer wählst du für sich. An der Website ändert sich dadurch nichts."),
    h("div", { class: "allgemein-felder" }, ...redaktionGruppen()),
  );
  const reiter = ([["website", "Website", teilWebsite], ["redaktion", "Redaktion", teilRedaktion]] as const).map(([wert, text, teil]) => {
    const knopf = h("button", { type: "button", role: "tab", id: `reiter-${wert}`, "data-wert": wert, "aria-controls": teil.id, "aria-selected": String(wert === "website") }, text);
    knopf.addEventListener("click", () => zeigeTeil(wert));
    return { wert, knopf, teil };
  });
  function zeigeTeil(wert: "website" | "redaktion"): void {
    for (const eintrag of reiter) {
      eintrag.knopf.setAttribute("aria-selected", String(eintrag.wert === wert));
      eintrag.teil.hidden = eintrag.wert !== wert;
    }
  }

  host.replaceChildren(
    h("h1", {}, "Allgemein"),
    h("p", { class: "leise einleitung" }, "Die Einstellungen, in zwei Teilen: «Website» für die Angaben, die Besucher sehen, «Redaktion» für deine Arbeit hier."),
    h("div", { class: "wahl-knoepfe reiter", id: "allgemein-reiter", role: "tablist", "aria-label": "Einstellungen für" }, ...reiter.map((eintrag) => eintrag.knopf)),
    teilWebsite,
    teilRedaktion,
  );

  return {
    async lade() {
      const antwort = await fetch("/api/allgemein", { cache: "no-store" });
      if (!antwort.ok) throw new Error(await fehlerText(antwort, "Die Angaben liessen sich nicht laden."));
      const json = (await antwort.json()) as { allgemein: Allgemein; version: string };
      gespeichert = json.allgemein;
      daten = structuredClone(json.allgemein);
      version = json.version;
      fehler = {};
      zeichne();
    },
    ungespeichert: geaendert,
    verwirf() {
      if (gespeichert) daten = structuredClone(gespeichert);
      fehler = {};
    },
  };
}
