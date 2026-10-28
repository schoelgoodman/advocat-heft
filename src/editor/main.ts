import * as crepeModule from "@milkdown/crepe";
import * as milkdownUtils from "@milkdown/kit/utils";
import "@milkdown/crepe/theme/common/style.css";
import "@milkdown/crepe/theme/frame.css";
import "./redaktion.css";
import type { Art, ContentDocument } from "../content/document.ts";
import { mountAssistent, type Lage } from "./assistent.ts";

interface CrepeApi {
  markdownUpdated(fn: (ctx: unknown, markdown: string, prev: string) => void): void;
}

interface CrepeEditor {
  create(): Promise<unknown>;
  destroy(): Promise<unknown>;
  getMarkdown(): string;
  on(fn: (api: CrepeApi) => void): unknown;
  editor: { action(fn: unknown): void };
}

interface CrepeCtor {
  new (config: {
    root: HTMLElement;
    defaultValue: string;
    features?: Record<string, boolean>;
    featureConfigs?: Record<string, unknown>;
  }): CrepeEditor;
  Feature: {
    CodeMirror: string;
    Latex: string;
    AI: string;
    TopBar: string;
    ImageBlock: string;
    BlockEdit: string;
    Toolbar: string;
    Placeholder: string;
  };
}

const Crepe = (crepeModule as unknown as { Crepe: CrepeCtor }).Crepe;
// Die Typen von @milkdown/utils lösen unter NodeNext nicht auf. Daher von Hand, wie bei Crepe.
const { replaceAll } = milkdownUtils as unknown as { replaceAll(markdown: string, flush?: boolean): unknown };

interface PageSummary {
  rel: string;
  titel: string;
  art: Art;
  datum: string;
  nummer: number | null;
  entwurf: boolean;
  href: string;
  auszug: string;
}

type Doc = ContentDocument & { href: string };

interface Anfrage {
  id: string;
  eingang: string;
  vorname: string;
  name: string;
  email: string;
  nachricht: string;
  telegram?: "gesendet" | "fehler" | "aus";
  status: "neu" | "gelesen" | "erledigt";
  seit?: string;
}

type AnfragenFilter = "offen" | "erledigt" | "alle";

const root = document.querySelector<HTMLElement>("#redaktion");
if (!root) throw new Error("Redaktion fehlt");

let crepe: CrepeEditor | null = null;
let current: Doc | null = null;
let saveTimer: number | null = null;
let armed = false;
let alleBriefe: PageSummary[] = [];
let alleSeiten: PageSummary[] = [];
let sichtbar = 10;
let alleAnfragen: Anfrage[] = [];
let anfragenStand = "";
let anfragenFilter: AnfragenFilter = "offen";
let briefeFilter: "alle" | "entwuerfe" | "online" = "alle";
let wuenscheFilter: "offen" | "erledigt" | "alle" = "offen";

interface Wunsch {
  id: string;
  art: "design" | "funktion";
  text: string;
  seite: string;
  eingang: string;
  status: "offen" | "erledigt";
  erledigtAm?: string;
  telegram: "gesendet" | "fehler" | "aus";
}
let alleWuensche: Wunsch[] = [];
let gewaehlt: string | null = null;

root.innerHTML = `
  <button type="button" class="verzeichnis-auf" id="verzeichnis-auf" title="Verzeichnis zeigen" aria-label="Verzeichnis zeigen" aria-expanded="false">
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
  </button>
  <div class="redaktion">
    <aside id="verzeichnis">
      <button type="button" class="wort" id="heim" title="Zur Startseite">
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M3 11 12 4l9 7M6 9.5V20h4.5v-5.5h3V20H18V9.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>
        Redaktion
      </button>
      <!-- Jede Gruppe gleich: der Pfeil klappt die Liste auf, der Name öffnet die Übersicht, wo es eine gibt. -->
      <details id="anfragen-gruppe">
        <summary><button type="button" class="gruppe-titel" id="anfragen-titel">Kontaktaufnahme</button><span class="zahl" id="anfragen-zahl"></span></summary>
        <nav id="anfragen-liste"></nav>
        <button type="button" class="leise mehr" id="anfragen-alle">Übersicht aller Anfragen</button>
      </details>
      <details id="briefe-gruppe">
        <summary><button type="button" class="gruppe-titel" id="briefe-titel">Newsletter</button></summary>
        <nav id="briefe"></nav>
        <button type="button" class="leise mehr" id="mehr" hidden></button>
        <button type="button" class="leise mehr" id="briefe-alle">Übersicht aller Newsletter</button>
      </details>
      <details id="seiten-gruppe">
        <summary><span class="gruppe-titel">Übrige Seiten</span></summary>
        <nav id="seiten"></nav>
      </details>
      <div class="gruppe-zeile">
        <button type="button" class="gruppe-titel" id="wuensche-link">Wünsche</button><span class="zahl" id="wuensche-zahl"></span><span class="marke neu" id="wuensche-neu" hidden>Neu</span>
      </div>
      <details id="papierkorb-gruppe" hidden>
        <summary><span class="gruppe-titel">Papierkorb</span></summary>
        <p class="leise">Gelöschte Entwürfe. Zurückgeholt sind sie wieder Entwürfe.</p>
        <nav id="papierkorb"></nav>
      </details>
    </aside>
    <main>
      <section id="start">
        <h1 id="gruss">Guten Tag, Patrick.</h1>
        <div class="aufgaben">
          <article class="aufgabe" id="start-anfragen"></article>
          <article class="aufgabe" id="start-briefe"></article>
        </div>
        <p class="wunsch-hinweis">Fehlt etwas in der Redaktion oder soll die Website anders aussehen? <button type="button" class="leise" id="start-wunsch">Wunsch schreiben →</button></p>
      </section>
      <section id="anfragen" hidden>
        <h1>Kontaktaufnahme</h1>
        <div class="kacheln" id="anfragen-kacheln" role="group" aria-label="Anfragen filtern"></div>
        <p class="leise" id="anfragen-text"></p>
        <ol id="anfragen-karten"></ol>
      </section>
      <section id="briefe-seite" hidden>
        <div class="seitenkopf">
          <h1>Newsletter</h1>
          <button type="button" class="haupt" id="briefe-neu">Neuen Newsletter schreiben</button>
        </div>
        <div class="kacheln" id="briefe-kacheln" role="group" aria-label="Newsletter filtern"></div>
        <input type="search" class="suche" id="briefe-suche" placeholder="Nach Thema oder Nummer suchen …" aria-label="Newsletter suchen">
        <p class="leise" id="briefe-text"></p>
        <ol id="briefe-karten"></ol>
      </section>
      <section id="wuensche-seite" hidden>
        <h1>Wünsche</h1>
        <p class="leise einleitung">Was in der Redaktion fehlt oder an der Website anders sein soll. Jeder Wunsch geht per Telegram an die Betreuung der Website. Beim Formulieren hilft der Assistent rechts.</p>
        <form class="neuer-wunsch" id="wunsch-form">
          <label>Art
            <select id="wunsch-art">
              <option value="funktion">Funktion der Redaktion</option>
              <option value="design">Aussehen der Website</option>
            </select>
          </label>
          <textarea id="wunsch-text" rows="4" placeholder="Was fehlt oder soll anders sein, und wozu?"></textarea>
          <div class="aktionen">
            <button type="submit" class="haupt">Wunsch senden</button>
            <p class="leise" id="wunsch-meldung" aria-live="polite"></p>
          </div>
        </form>
        <div class="kacheln" id="wuensche-kacheln" role="group" aria-label="Wünsche filtern"></div>
        <ol id="wuensche-karten"></ol>
      </section>
      <form id="blatt" hidden>
        <div class="leiste">
          <p class="stand" id="stand"></p>
          <p class="speicher" id="speicher" aria-live="polite"></p>
          <div class="aktionen" id="aktionen"></div>
        </div>
        <p class="kennung" id="kennung"></p>
        <textarea id="titel" class="titel" rows="1" autocomplete="off"></textarea>
        <div class="angaben" id="angaben">
          <label class="datum" id="nummer-feld">Nummer <input type="number" id="nummer" min="1" max="9999" step="1" inputmode="numeric"></label>
          <label class="datum" id="datum-feld">Datum <input type="date" id="datum"></label>
        </div>
        <p class="nummer-hinweis" id="nummer-hinweis" hidden></p>
        <div id="editor"></div>
        <p class="tipp">Tipp: Am Anfang einer leeren Zeile <kbd>/</kbd> tippen für Zwischentitel, Liste oder Bild. Text markieren für fett, kursiv oder Link.</p>
        <details id="fassungen-gruppe">
          <summary>Frühere Fassungen</summary>
          <p class="leise">Jede Fassung lässt sich ansehen und zurückholen. Nichts geht verloren.</p>
          <ol id="fassungen"></ol>
          <article id="vorschau" hidden></article>
        </details>
      </form>
    </main>
  </div>
  <dialog id="frage">
    <form method="dialog">
      <h2 id="frage-titel"></h2>
      <p id="frage-text"></p>
      <div class="aktionen">
        <button value="nein" id="frage-nein">Abbrechen</button>
        <button value="ja" id="frage-ja" class="haupt"></button>
      </div>
    </form>
  </dialog>
`;

const briefe = root.querySelector<HTMLElement>("#briefe")!;
const seiten = root.querySelector<HTMLElement>("#seiten")!;
const mehr = root.querySelector<HTMLButtonElement>("#mehr")!;
const briefeGruppe = root.querySelector<HTMLDetailsElement>("#briefe-gruppe")!;
const seitenGruppe = root.querySelector<HTMLDetailsElement>("#seiten-gruppe")!;
const papierkorb = root.querySelector<HTMLElement>("#papierkorb")!;
const papierkorbGruppe = root.querySelector<HTMLDetailsElement>("#papierkorb-gruppe")!;
const start = root.querySelector<HTMLElement>("#start")!;
const anfragenGruppe = root.querySelector<HTMLDetailsElement>("#anfragen-gruppe")!;
const anfragenListe = root.querySelector<HTMLElement>("#anfragen-liste")!;
const anfragenZahl = root.querySelector<HTMLElement>("#anfragen-zahl")!;
const anfragenSeite = root.querySelector<HTMLElement>("#anfragen")!;
const briefeSeite = root.querySelector<HTMLElement>("#briefe-seite")!;
const briefeKacheln = root.querySelector<HTMLElement>("#briefe-kacheln")!;
const briefeSuche = root.querySelector<HTMLInputElement>("#briefe-suche")!;
const briefeText = root.querySelector<HTMLElement>("#briefe-text")!;
const briefeKarten = root.querySelector<HTMLOListElement>("#briefe-karten")!;
const wuenscheSeite = root.querySelector<HTMLElement>("#wuensche-seite")!;
const wuenscheKacheln = root.querySelector<HTMLElement>("#wuensche-kacheln")!;
const wuenscheKarten = root.querySelector<HTMLOListElement>("#wuensche-karten")!;
const wuenscheZahl = root.querySelector<HTMLElement>("#wuensche-zahl")!;
const wuenscheNeu = root.querySelector<HTMLElement>("#wuensche-neu")!;
const wunschForm = root.querySelector<HTMLFormElement>("#wunsch-form")!;
const wunschArt = root.querySelector<HTMLSelectElement>("#wunsch-art")!;
const wunschText = root.querySelector<HTMLTextAreaElement>("#wunsch-text")!;
const wunschMeldung = root.querySelector<HTMLElement>("#wunsch-meldung")!;
const anfragenText = root.querySelector<HTMLElement>("#anfragen-text")!;
const anfragenKacheln = root.querySelector<HTMLElement>("#anfragen-kacheln")!;
const startAnfragen = root.querySelector<HTMLElement>("#start-anfragen")!;
const startBriefe = root.querySelector<HTMLElement>("#start-briefe")!;
const anfragenKarten = root.querySelector<HTMLOListElement>("#anfragen-karten")!;
const form = root.querySelector<HTMLFormElement>("#blatt")!;
const stand = root.querySelector<HTMLElement>("#stand")!;
const speicher = root.querySelector<HTMLElement>("#speicher")!;
const aktionen = root.querySelector<HTMLElement>("#aktionen")!;
const kennung = root.querySelector<HTMLElement>("#kennung")!;
const titelInput = root.querySelector<HTMLTextAreaElement>("#titel")!;
const datumFeld = root.querySelector<HTMLElement>("#datum-feld")!;
const datumInput = root.querySelector<HTMLInputElement>("#datum")!;
const nummerFeld = root.querySelector<HTMLElement>("#nummer-feld")!;
const nummerInput = root.querySelector<HTMLInputElement>("#nummer")!;
const nummerHinweis = root.querySelector<HTMLElement>("#nummer-hinweis")!;
const editorHost = root.querySelector<HTMLElement>("#editor")!;
const fassungenGruppe = root.querySelector<HTMLDetailsElement>("#fassungen-gruppe")!;
const fassungen = root.querySelector<HTMLOListElement>("#fassungen")!;
const vorschau = root.querySelector<HTMLElement>("#vorschau")!;

const frage = root.querySelector<HTMLDialogElement>("#frage")!;
const frageTitel = root.querySelector<HTMLElement>("#frage-titel")!;
const frageText = root.querySelector<HTMLElement>("#frage-text")!;
const frageJa = root.querySelector<HTMLButtonElement>("#frage-ja")!;
const frageNein = root.querySelector<HTMLButtonElement>("#frage-nein")!;

/** Fragt auf der Seite statt mit dem Browser-Dialog. Ohne `nein` ist es nur ein Hinweis. */
function ask(options: { titel: string; text: string; ja: string; nein?: string; gefahr?: boolean }): Promise<boolean> {
  frageTitel.textContent = options.titel;
  frageText.textContent = options.text;
  frageJa.textContent = options.ja;
  frageJa.classList.toggle("gefahr", options.gefahr === true);
  frageNein.hidden = options.nein == null;
  frageNein.textContent = options.nein ?? "";
  frage.returnValue = "";
  frage.showModal();
  frageJa.focus();
  return new Promise((resolve) => {
    frage.addEventListener("close", () => resolve(frage.returnValue === "ja"), { once: true });
  });
}

/** Die öffentliche Adresse kommt vom Server (PUBLIC_URL). Lokal ist es derselbe Server. */
let publicOrigin = "";

const dateFormat = new Intl.DateTimeFormat("de-CH", { day: "numeric", month: "short", year: "numeric" });

function shortDate(iso: string): string {
  const date = new Date(`${iso}T12:00:00`);
  return Number.isNaN(date.getTime()) ? "" : dateFormat.format(date);
}

/** Der Titel eines Newsletters ist „Newsletter 36: Thema“. Bearbeitet wird nur das Thema. */
function thema(titel: string): string {
  return titel.replace(/^Newsletter\s+\d+\s*:?\s*/i, "").trim();
}

function briefTitel(nummer: number | null, text: string): string {
  const head = `Newsletter ${nummer ?? ""}`.trim();
  return text.trim() ? `${head}: ${text.trim()}` : head;
}

/** Die Startseite bleibt immer online. */
const STARTSEITE = "kapitel/willkommen.md";

function isBrief(doc: Pick<ContentDocument, "art"> | null | undefined): boolean {
  return doc?.art === "brief";
}

function forEditor(markdown: string): string {
  return markdown.replaceAll("](../media/", "](/media/");
}

function forFile(markdown: string): string {
  return markdown.replaceAll("](/media/", "](../media/");
}

function esc(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function button(label: string, className: string, onClick: () => void): HTMLButtonElement {
  const element = document.createElement("button");
  element.type = "button";
  element.className = className;
  element.textContent = label;
  element.addEventListener("click", onClick);
  return element;
}

/** Das Titelfeld wächst mit dem Text, damit lange Themen ganz sichtbar bleiben. */
function fitTitel(): void {
  titelInput.style.height = "auto";
  titelInput.style.height = `${titelInput.scrollHeight}px`;
}

/** Eine Meldung, die das nächste „Gespeichert ✓“ nicht gleich überschreibt, etwa nach dem Word-Import. */
let haltMeldungBis = 0;

function setSaved(text: string, kind: "ok" | "busy" | "fehler" = "ok"): void {
  if (Date.now() < haltMeldungBis && (text === "Gespeichert ✓" || kind === "busy")) return;
  speicher.textContent = text;
  speicher.dataset.kind = kind;
}

async function uploadImage(file: File): Promise<string> {
  const response = await fetch("/api/media", {
    method: "POST",
    headers: { "x-filename": file.name },
    body: file,
  });
  if (!response.ok) throw new Error("Bild wurde nicht gespeichert");
  const json = (await response.json()) as { url: string };
  return json.url.replace("../media/", "/media/");
}

async function mountEditor(markdown: string): Promise<void> {
  armed = false;
  if (crepe) {
    await crepe.destroy();
    crepe = null;
  }
  editorHost.replaceChildren();
  const next = new Crepe({
    root: editorHost,
    defaultValue: forEditor(markdown),
    features: {
      [Crepe.Feature.CodeMirror]: false,
      [Crepe.Feature.Latex]: false,
      [Crepe.Feature.AI]: false,
      [Crepe.Feature.TopBar]: false,
    },
    featureConfigs: {
      [Crepe.Feature.Placeholder]: { text: "Hier den Text schreiben …", mode: "doc" },
      [Crepe.Feature.Toolbar]: { linkLabel: "Link" },
      [Crepe.Feature.ImageBlock]: {
        onUpload: uploadImage,
        blockUploadButton: "Bild hochladen",
        blockUploadPlaceholderText: "oder Bildadresse einfügen",
        blockConfirmButton: "Übernehmen",
        blockCaptionPlaceholderText: "Bildunterschrift",
      },
      [Crepe.Feature.BlockEdit]: {
        textGroup: {
          label: "Text",
          text: { label: "Absatz" },
          h1: null,
          h2: { label: "Zwischentitel" },
          h3: { label: "Kleiner Zwischentitel" },
          h4: null,
          h5: null,
          h6: null,
          quote: { label: "Zitat" },
          divider: null,
        },
        listGroup: {
          label: "Liste",
          bulletList: { label: "Aufzählung" },
          orderedList: { label: "Nummerierte Liste" },
          taskList: null,
        },
        advancedGroup: {
          label: "Bild",
          image: { label: "Bild" },
          codeBlock: null,
          table: null,
          math: null,
        },
      },
    },
  });
  next.on((api) => {
    api.markdownUpdated((_ctx, markdownNow, prev) => {
      if (!armed || markdownNow === prev) return;
      scheduleSave();
    });
  });
  await next.create();
  crepe = next;
  // Crepe schreibt manche Zeilen anders, als sie in der Datei stehen.
  // Diese Fassung ist der Ausgangspunkt, kein Speichern.
  if (current && current.body.trim() === markdown.trim()) {
    current = { ...current, body: forFile(next.getMarkdown()).trim() };
  }
  armed = true;
}

const ICONS = {
  mehr: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="3" cy="8" r="1.4" fill="currentColor"/><circle cx="8" cy="8" r="1.4" fill="currentColor"/><circle cx="13" cy="8" r="1.4" fill="currentColor"/></svg>',
};

/** Ein Menü für alle Einträge im Verzeichnis. Es liegt über allem, damit das Verzeichnis es nicht abschneidet. */
const menue = document.createElement("div");
menue.className = "menue";
menue.popover = "auto";
menue.setAttribute("role", "menu");
root.append(menue);
let menueAnker: HTMLElement | null = null;
/** Drückt Patrick den «…» eines offenen Menüs, soll der Klick danach es nicht wieder öffnen. */
let menueSchliesst = false;
menue.addEventListener("toggle", (event) => {
  menueAnker?.setAttribute("aria-expanded", String((event as ToggleEvent).newState === "open"));
  if ((event as ToggleEvent).newState !== "closed") return;
  if (menue.contains(document.activeElement) || document.activeElement === document.body) menueAnker?.focus({ preventScroll: true });
});
menue.addEventListener("keydown", (event) => {
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
  event.preventDefault();
  const punkte = [...menue.querySelectorAll<HTMLButtonElement>("button")];
  const jetzt = punkte.indexOf(document.activeElement as HTMLButtonElement);
  punkte[(jetzt + (event.key === "ArrowDown" ? 1 : -1) + punkte.length) % punkte.length]?.focus();
});

function zeigeMenue(anker: HTMLElement, page: PageSummary): void {
  // Ein Klick auf denselben Knopf schliesst das Menü. Der Browser hat es beim Drücken schon zugemacht.
  if (menueSchliesst) {
    menueSchliesst = false;
    return;
  }
  menueAnker?.setAttribute("aria-expanded", "false");
  menueAnker = anker;
  const ansehen: [string, () => void] = page.entwurf
    ? ["Vorschau ↗", () => (page.rel === current?.rel ? void openPreview() : void window.open(`/api/preview?rel=${encodeURIComponent(page.rel)}`, "_blank"))]
    : ["Auf der Website ansehen ↗", () => void window.open(`${publicOrigin}${page.href}`, "_blank", "noopener")];
  const punkte: [string, () => void][] = [
    ["Öffnen", () => void openPage(page.rel)],
    ["Kopie anlegen", () => void copyPage(page.rel)],
    ansehen,
  ];
  menue.replaceChildren(
    ...punkte.map(([label, aktion]) => {
      const punkt = button(label, "", () => {
        menue.hidePopover();
        aktion();
      });
      punkt.setAttribute("role", "menuitem");
      return punkt;
    }),
  );
  menue.showPopover();
  const rahmen = anker.getBoundingClientRect();
  const unten = rahmen.bottom + 4 + menue.offsetHeight > window.innerHeight;
  menue.style.top = `${unten ? rahmen.top - 4 - menue.offsetHeight : rahmen.bottom + 4}px`;
  menue.style.left = `${Math.max(8, rahmen.right - menue.offsetWidth)}px`;
  menue.querySelector("button")?.focus();
}

function icon(svg: string, label: string, onClick: () => void): HTMLButtonElement {
  const element = document.createElement("button");
  element.type = "button";
  element.className = "werkzeug";
  element.title = label;
  element.setAttribute("aria-label", label);
  element.innerHTML = svg;
  element.addEventListener("click", onClick);
  return element;
}

function listItem(page: PageSummary): HTMLElement {
  const item = document.createElement("button");
  item.type = "button";
  item.dataset.rel = page.rel;
  const head = document.createElement("span");
  head.className = "kopfzeile";
  const text = document.createElement("span");
  text.className = "thema";
  if (page.art === "brief") {
    head.innerHTML = page.entwurf
      ? `<span class="marke">Entwurf</span> Nr. ${page.nummer ?? ""}`
      : `Nr. ${page.nummer ?? ""} · ${esc(shortDate(page.datum))}`;
    text.textContent = thema(page.titel) || "Noch ohne Thema";
    item.append(head, text);
  } else {
    head.innerHTML = `<span class="marke">Entwurf</span>`;
    text.textContent = page.titel;
    item.append(...(page.entwurf ? [head, text] : [text]));
  }
  item.addEventListener("click", () => void openPage(page.rel));

  // Veröffentlichen und Zurückziehen stehen beim offenen Blatt, nicht hier: ein Klick daneben wäre zu leicht.
  const werkzeuge = document.createElement("span");
  werkzeuge.className = "werkzeuge";
  const mehrKnopf = icon(ICONS.mehr, "Weitere Aktionen", () => zeigeMenue(mehrKnopf, page));
  mehrKnopf.setAttribute("aria-haspopup", "menu");
  mehrKnopf.setAttribute("aria-expanded", "false");
  mehrKnopf.addEventListener("pointerdown", () => {
    menueSchliesst = menueAnker === mehrKnopf && menue.matches(":popover-open");
  });
  werkzeuge.append(mehrKnopf);
  const zeile = document.createElement("div");
  zeile.className = "eintrag";
  zeile.append(item, werkzeuge);
  return zeile;
}

function trashItem(page: PageSummary): HTMLElement {
  const zeile = document.createElement("div");
  zeile.className = "eintrag geloescht";
  const text = document.createElement("span");
  text.className = "thema";
  text.textContent = isBrief(page) ? `Nr. ${page.nummer ?? ""} · ${thema(page.titel) || "Ohne Thema"}` : page.titel;
  zeile.append(text, button("Zurückholen", "leise", () => void restoreFromTrash(page.rel)));
  return zeile;
}

async function loadList(): Promise<void> {
  const response = await fetch("/api/pages");
  const json = (await response.json()) as { pages: PageSummary[] };
  alleSeiten = json.pages;
  alleBriefe = json.pages.filter((page) => page.art === "brief");
  seiten.replaceChildren(...json.pages.filter((page) => page.art !== "brief").map(listItem));
  renderBriefe();
  const geloescht = (await fetch("/api/papierkorb")
    .then((res) => res.json())
    .catch(() => ({ pages: [] }))) as { pages: PageSummary[] };
  papierkorb.replaceChildren(...geloescht.pages.map(trashItem));
  papierkorbGruppe.hidden = geloescht.pages.length === 0;
}

/** Zeigt die neuesten Newsletter, ältere erst auf Wunsch. */
function renderBriefe(): void {
  const offen = alleBriefe.findIndex((page) => page.rel === current?.rel);
  if (offen >= sichtbar) sichtbar = Math.ceil((offen + 1) / 10) * 10;
  briefe.replaceChildren(...alleBriefe.slice(0, sichtbar).map(listItem));
  const rest = alleBriefe.length - sichtbar;
  mehr.hidden = rest <= 0;
  mehr.textContent = `Ältere anzeigen (noch ${rest})`;
  markCurrent();
  renderStartBriefe();
  if (!briefeSeite.hidden) renderBriefUebersicht();
}

/** Eine Karte auf der Startseite: Titel, eine grosse Zeile, Kleingedrucktes, eine kurze Liste, ein Knopf. */
function aufgabe(
  host: HTMLElement,
  options: { titel: string; gross: string; leise: string; liste: { label: string; info: string; onClick: () => void }[]; knopf: HTMLButtonElement | HTMLButtonElement[] },
): void {
  const titel = document.createElement("h2");
  titel.textContent = options.titel;
  const gross = document.createElement("p");
  gross.className = "gross";
  gross.textContent = options.gross;
  const leise = document.createElement("p");
  leise.className = "leise";
  leise.textContent = options.leise;
  const liste = document.createElement("ul");
  for (const eintrag of options.liste) {
    const item = document.createElement("li");
    const link = button(eintrag.label, "", eintrag.onClick);
    const info = document.createElement("span");
    info.textContent = eintrag.info;
    link.append(info);
    item.append(link);
    liste.append(item);
  }
  const knoepfe = document.createElement("div");
  knoepfe.className = "aktionen";
  knoepfe.append(...[options.knopf].flat());
  host.replaceChildren(titel, gross, leise, ...(options.liste.length ? [liste] : []), knoepfe);
}

function renderStartBriefe(): void {
  const entwuerfe = alleBriefe.filter((page) => page.entwurf);
  const zuletzt = alleBriefe.find((page) => !page.entwurf);
  const neu = button("Neuen Newsletter schreiben", "haupt", () => void newBrief());
  // Entwürfe zuerst, die wollen fertig werden. Sonst die letzten veröffentlichten.
  const liste = (entwuerfe.length ? entwuerfe : alleBriefe).slice(0, 3).map((page) => ({
    label: thema(page.titel) || "Noch ohne Thema",
    info: page.entwurf ? `Entwurf · Nr. ${page.nummer ?? ""}` : `Nr. ${page.nummer ?? ""} · ${shortDate(page.datum)}`,
    onClick: () => void openPage(page.rel),
  }));
  aufgabe(startBriefe, {
    titel: "Newsletter",
    gross: entwuerfe.length
      ? `${entwuerfe.length === 1 ? "Ein Entwurf wartet" : `${entwuerfe.length} Entwürfe warten`}`
      : "Keine offenen Entwürfe",
    leise: zuletzt
      ? `Zuletzt erschienen: Nr. ${zuletzt.nummer ?? ""} am ${shortDate(zuletzt.datum)}.`
      : "Der erste Newsletter erscheint, sobald Sie ihn veröffentlichen.",
    liste,
    knopf: [neu, button("Zur Übersicht", "", () => void showBriefe())],
  });
}

/** Auf dem Telefon steht das Verzeichnis über der Seite. Dort klappt es nicht von selbst auf. */
const schmal = window.matchMedia("(max-width: 800px)");

/** Nach einem Wechsel an den Anfang der Ansicht. Auf dem Telefon am Verzeichnis vorbei. */
function nachOben(): void {
  if (schmal.matches) root!.querySelector("main")!.scrollIntoView();
  else window.scrollTo({ top: 0 });
}

/** Jede Ansicht bekommt einen Eintrag im Verlauf des Browsers, damit «Zurück» in der Redaktion bleibt. */
function merke(hash: string): void {
  if (decodeURIComponent(location.hash.slice(1)) === hash) return;
  history.pushState(null, "", hash ? `#${hash}` : location.pathname + location.search);
}

function markCurrent(): void {
  for (const item of root!.querySelectorAll<HTMLButtonElement>("nav button[data-rel]")) {
    item.toggleAttribute("aria-current", item.dataset.rel === current?.rel);
  }
  for (const item of root!.querySelectorAll<HTMLButtonElement>("nav button[data-anfrage]")) {
    item.toggleAttribute("aria-current", item.dataset.anfrage === gewaehlt);
  }
  if (current && !schmal.matches) (isBrief(current) ? briefeGruppe : seitenGruppe).open = true;
}

/** Hält das Thema im Verzeichnis gleich, während getippt wird. */
function updateListLabel(): void {
  if (!current || !isBrief(current)) return;
  const item = briefe.querySelector<HTMLElement>(`button[data-rel="${CSS.escape(current.rel)}"] .thema`);
  if (item) item.textContent = titelInput.value.trim() || "Noch ohne Thema";
}

/** Die Nummer aus dem Feld. Nur ein Entwurf darf sie ändern: online hängt die Adresse daran. */
function gewaehlteNummer(): number | null {
  if (!current || !isBrief(current) || !current.entwurf) return current?.nummer ?? null;
  const wert = Number(nummerInput.value);
  return Number.isInteger(wert) && wert > 0 && wert < 10_000 ? wert : current.nummer;
}

/** Warnt, wenn ein anderer Newsletter dieselbe Nummer hat. Verboten ist es erst beim Veröffentlichen. */
function pruefeNummer(): void {
  const nummer = gewaehlteNummer();
  const andere = alleBriefe.filter((page) => page.rel !== current?.rel && page.nummer === nummer);
  const online = andere.find((page) => !page.entwurf);
  nummerHinweis.hidden = andere.length === 0 || !current?.entwurf;
  nummerHinweis.textContent = online
    ? `Nr. ${nummer} ist schon online: «${thema(online.titel)}». So lässt er sich nicht veröffentlichen.`
    : `Nr. ${nummer} hat auch ${andere.length === 1 ? "ein anderer Entwurf" : `${andere.length} andere Entwürfe`}.`;
  nummerHinweis.classList.toggle("fehler", online != null);
}

function collect(): ContentDocument {
  if (!current || !crepe) throw new Error("Keine Seite");
  const brief = isBrief(current);
  const nummer = gewaehlteNummer();
  return {
    rel: current.rel,
    art: current.art,
    nummer,
    entwurf: current.entwurf,
    titel: brief ? briefTitel(nummer, titelInput.value) : titelInput.value.trim() || current.titel,
    datum: brief ? datumInput.value || current.datum : current.datum,
    body: forFile(crepe.getMarkdown()).trim(),
  };
}

function same(a: ContentDocument, b: ContentDocument): boolean {
  return a.titel === b.titel && a.datum === b.datum && a.nummer === b.nummer && a.body.trim() === b.body.trim();
}

function viewHref(doc: Doc): string {
  return `${publicOrigin}${doc.href}`;
}

/** Zeigt, wo die Seite steht und was als Nächstes zu tun ist. */
function renderStand(): void {
  if (!current) return;
  const doc = current;
  nummerInput.disabled = !doc.entwurf;
  nummerFeld.title = doc.entwurf ? "" : "Die Nummer lässt sich nur im Entwurf ändern. Online hängt die Adresse daran.";
  nummerInput.value = String(doc.nummer ?? "");
  pruefeNummer();
  aktionen.replaceChildren();
  // Online sieht das Blatt anders aus: jede Änderung ist sofort auf der Website.
  form.dataset.stand = doc.entwurf ? "entwurf" : "online";
  // Was die Seite wegnimmt (Löschen, Zurückziehen) steht links für sich, die übrigen Knöpfe rechts.
  if (doc.entwurf) {
    stand.innerHTML = `<span class="marke">Entwurf</span> Nur hier in der Redaktion sichtbar.`;
    aktionen.append(
      button("Löschen", "leise weg", () => void deleteDraft()),
      button("Word importieren", "leise", () => wordInput.click()),
      button("Kopie anlegen", "leise", () => void copyPage(doc.rel)),
      button("Vorschau", "", () => void openPreview()),
      button("Veröffentlichen", "haupt", () => void publish()),
    );
    return;
  }
  stand.innerHTML = `<span class="marke online">Online</span> Jede Änderung erscheint sofort auf der Website.`;
  if (doc.rel !== STARTSEITE) aktionen.append(button("Zurückziehen", "leise weg", () => void unpublish()));
  aktionen.append(button("Kopie anlegen", "leise", () => void copyPage(doc.rel)));
  const link = document.createElement("a");
  link.className = "knopf";
  link.href = viewHref(doc);
  link.target = "_blank";
  link.rel = "noopener";
  link.textContent = "Auf der Website ansehen ↗";
  aktionen.append(link);
}

/** «Guten Morgen» bis elf, dann «Guten Tag», ab fünf «Guten Abend». Auch spät in der Nacht noch Abend. */
function gruss(): string {
  const stunde = new Date().getHours();
  if (stunde >= 5 && stunde < 11) return "Guten Morgen, Patrick.";
  if (stunde >= 11 && stunde < 17) return "Guten Tag, Patrick.";
  return "Guten Abend, Patrick.";
}

function showStart(): void {
  root!.querySelector("#gruss")!.textContent = gruss();
  current = null;
  gewaehlt = null;
  form.hidden = true;
  anfragenSeite.hidden = true;
  briefeSeite.hidden = true;
  wuenscheSeite.hidden = true;
  start.hidden = false;
  merke("");
  // Auf der Startseite ist das Verzeichnis zugeklappt. Eine geöffnete Seite klappt ihre Gruppe selbst auf.
  for (const gruppe of root!.querySelectorAll<HTMLDetailsElement>("aside details")) gruppe.open = false;
  markCurrent();
}

async function openPage(rel: string): Promise<void> {
  if (!(await flushCommit())) return;
  const response = await fetch(`/api/pages?rel=${encodeURIComponent(rel)}`);
  if (!response.ok) {
    showStart();
    return;
  }
  current = (await response.json()) as Doc;
  gewaehlt = null;
  const brief = isBrief(current);
  start.hidden = true;
  anfragenSeite.hidden = true;
  briefeSeite.hidden = true;
  wuenscheSeite.hidden = true;
  form.hidden = false;
  kennung.textContent = brief ? `Newsletter ${current.nummer ?? ""}` : current.art === "recht" ? "Rechtliches" : "Seite";
  titelInput.placeholder = brief ? "Thema, z. B. Revision des Erbrechts" : "Titel";
  titelInput.value = brief ? thema(current.titel) : current.titel;
  fitTitel();
  datumFeld.hidden = !brief;
  datumInput.value = current.datum;
  nummerFeld.hidden = !brief;
  nummerInput.value = String(current.nummer ?? "");
  fassungenGruppe.open = false;
  setSaved("");
  renderStand();
  merke(current.rel);
  renderBriefe();
  if (schmal.matches) nachOben();
  await mountEditor(current.body);
  void loadHistory(current.rel);
  if (brief && current.entwurf && !titelInput.value) titelInput.focus();
}

function scheduleSave(): void {
  if (!armed) return;
  setSaved("Ungespeichert …", "busy");
  if (saveTimer != null) window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => void save(), 600);
}

async function save(): Promise<boolean> {
  saveTimer = null;
  if (!current || !crepe) return true;
  const doc = collect();
  if (same(doc, current)) {
    setSaved("Gespeichert ✓");
    return true;
  }
  setSaved("Speichert …", "busy");
  const response = await fetch("/api/pages", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(doc),
  }).catch(() => null);
  if (!response?.ok) {
    setSaved("Nicht gespeichert. Die Verbindung fehlt, die Redaktion versucht es gleich wieder.", "fehler");
    // Der wartende Versuch hält auch die Warnung beim Schliessen des Fensters wach.
    saveTimer = window.setTimeout(() => void save(), 5000);
    return false;
  }
  const neueNummer = current.rel === doc.rel && current.nummer !== doc.nummer;
  if (current.rel === doc.rel) current = { ...current, ...doc };
  setSaved("Gespeichert ✓");
  // Das Verzeichnis zeigt die Nummer und sortiert danach.
  if (neueNummer) void loadList().then(pruefeNummer);
  return true;
}

/** Wartendes Speichern sofort ausführen. */
async function saveNow(): Promise<boolean> {
  if (saveTimer != null) window.clearTimeout(saveTimer);
  return save();
}

/**
 * Vor jedem Wechsel: Wartendes speichern, dann eine Fassung schreiben.
 * Geht das Speichern nicht, entscheidet Patrick, ob die Änderungen verloren gehen dürfen.
 */
async function flushCommit(): Promise<boolean> {
  if (saveTimer != null && !(await saveNow())) {
    const weg = await ask({
      titel: "Nicht gespeichert",
      text: "Die letzten Änderungen sind noch nicht gespeichert, weil die Verbindung zum Server fehlt. Wer jetzt wechselt, verliert sie.",
      ja: "Trotzdem wechseln",
      nein: "Hierbleiben",
      gefahr: true,
    });
    if (!weg) {
      // «Zurück» im Browser hat die Adresse schon geändert. Sie soll wieder zum offenen Blatt passen.
      if (current) merke(current.rel);
      return false;
    }
    if (saveTimer != null) window.clearTimeout(saveTimer);
    saveTimer = null;
  }
  await fetch("/api/commit", { method: "POST", keepalive: true }).catch(() => null);
  return true;
}

async function post(url: string, payload: unknown): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

async function errorText(response: Response, fallback: string): Promise<string> {
  const json = (await response.json().catch(() => ({}))) as { error?: string };
  return json.error ?? fallback;
}

async function newBrief(): Promise<void> {
  if (!(await flushCommit())) return;
  const response = await fetch("/api/briefs", { method: "POST" });
  if (!response.ok) {
    await ask({
      titel: "Das hat nicht geklappt",
      text: await errorText(response, "Der neue Newsletter liess sich nicht anlegen."),
      ja: "OK",
    });
    return;
  }
  const doc = (await response.json()) as Doc;
  current = doc;
  await loadList();
  await openPage(doc.rel);
}

async function openPreview(): Promise<void> {
  if (!current) return;
  // Das Fenster sofort öffnen, sonst blockiert der Browser es nach dem Speichern.
  const win = window.open("", "_blank");
  await saveNow();
  const url = `/api/preview?rel=${encodeURIComponent(current.rel)}`;
  if (win) win.location.href = url;
  else window.location.href = url;
}

/** Fehler beim offenen Blatt in der Leiste, sonst als Hinweis. */
async function melde(offen: boolean, text: string): Promise<void> {
  if (offen) setSaved(text, "fehler");
  else await ask({ titel: "Das hat nicht geklappt", text, ja: "OK" });
}

/** Ohne `rel` das offene Blatt. Aus dem Verzeichnis auch jede andere Seite. */
async function publish(rel = current?.rel): Promise<void> {
  if (!rel) return;
  const offen = current?.rel === rel;
  if (offen) {
    if (isBrief(current) && !titelInput.value.trim()) {
      titelInput.focus();
      setSaved("Bitte zuerst ein Thema eingeben.", "fehler");
      return;
    }
    if (!(await saveNow())) return;
  }
  const page = offen ? current : alleSeiten.find((item) => item.rel === rel);
  if (!page) return;
  if (isBrief(page) && !thema(page.titel)) {
    await ask({ titel: "Noch ohne Thema", text: "Bitte den Newsletter öffnen und zuerst ein Thema eingeben.", ja: "OK" });
    return;
  }
  const ja = await ask({
    titel: "Jetzt veröffentlichen?",
    text: isBrief(page)
      ? `„${page.titel}“ erscheint sofort auf der Website und auf der Startseite.`
      : `„${page.titel}“ erscheint sofort auf der Website.`,
    ja: "Veröffentlichen",
    nein: "Noch nicht",
  });
  if (!ja) return;
  if (offen) setSaved("Veröffentlicht …", "busy");
  const response = await post("/api/publish", { rel });
  if (!response.ok) {
    await melde(current?.rel === rel, await errorText(response, "Veröffentlichen fehlgeschlagen."));
    return;
  }
  const doc = (await response.json()) as Doc;
  if (current?.rel === rel) {
    current = doc;
    // Die Datei hat jetzt das Thema im Namen. Derselbe Eintrag im Verlauf, nur mit neuer Adresse.
    history.replaceState(null, "", `#${current.rel}`);
    renderStand();
    setSaved("Veröffentlicht ✓");
    void loadHistory(current.rel);
  }
  await loadList();
}

async function unpublish(rel = current?.rel): Promise<void> {
  if (!rel) return;
  const offen = current?.rel === rel;
  if (offen && !(await saveNow())) return;
  const page = offen ? current : alleSeiten.find((item) => item.rel === rel);
  if (!page) return;
  const ja = await ask({
    titel: "Von der Website nehmen?",
    text: `„${page.titel}“ verschwindet von der Website. Der Text bleibt hier als Entwurf erhalten.`,
    ja: "Zurückziehen",
    nein: "Abbrechen",
  });
  if (!ja) return;
  const response = await post("/api/unpublish", { rel });
  if (!response.ok) {
    await melde(current?.rel === rel, await errorText(response, "Zurückziehen fehlgeschlagen."));
    return;
  }
  const doc = (await response.json()) as Doc;
  if (current?.rel === rel) {
    current = doc;
    renderStand();
    setSaved("Zurückgezogen. Jetzt nur noch als Entwurf hier.");
    void loadHistory(current.rel);
  }
  await loadList();
}

/** Legt eine Kopie als Entwurf an und öffnet sie. Ein Newsletter bekommt die nächste Nummer. */
async function copyPage(rel: string): Promise<void> {
  if (current?.rel === rel && !(await saveNow())) return;
  const response = await post("/api/copy", { rel });
  if (!response.ok) {
    await melde(current?.rel === rel, await errorText(response, "Die Kopie liess sich nicht anlegen."));
    return;
  }
  const doc = (await response.json()) as Doc;
  await loadList();
  await openPage(doc.rel);
  setSaved("Kopie angelegt ✓");
}

async function restoreFromTrash(rel: string): Promise<void> {
  const response = await post("/api/zurueckholen", { rel });
  if (!response.ok) {
    await melde(false, await errorText(response, "Zurückholen fehlgeschlagen."));
    return;
  }
  const doc = (await response.json()) as Doc;
  await loadList();
  await openPage(doc.rel);
  setSaved("Aus dem Papierkorb zurückgeholt ✓");
}

async function deleteDraft(): Promise<void> {
  if (!current?.entwurf) return;
  const ja = await ask({
    titel: "Entwurf löschen?",
    text: `„${current.titel}“ kommt in den Papierkorb. Von dort lässt es sich zurückholen.`,
    ja: "Löschen",
    nein: "Abbrechen",
    gefahr: true,
  });
  if (!ja || !current?.entwurf) return;
  if (saveTimer != null) window.clearTimeout(saveTimer);
  saveTimer = null;
  const response = await fetch(`/api/pages?rel=${encodeURIComponent(current.rel)}`, { method: "DELETE" });
  if (!response.ok) {
    setSaved(await errorText(response, "Löschen fehlgeschlagen."), "fehler");
    return;
  }
  showStart();
  await loadList();
}

interface Revision {
  rev: string;
  date: string;
  message: string;
  path: string;
}

async function loadHistory(rel: string): Promise<void> {
  vorschau.hidden = true;
  fassungen.replaceChildren();
  const response = await fetch(`/api/history?rel=${encodeURIComponent(rel)}`);
  const json = (await response.json()) as { revisions: Revision[] };
  if (current?.rel !== rel) return;
  for (const revision of json.revisions) {
    const item = document.createElement("li");
    const when = document.createElement("time");
    when.dateTime = revision.date;
    when.textContent = new Date(revision.date).toLocaleString("de-CH", { dateStyle: "medium", timeStyle: "short" });
    const text = document.createElement("span");
    text.textContent = revision.message;
    const knöpfe = document.createElement("span");
    knöpfe.className = "knoepfe";
    const ansehen = button("Ansehen", "leise", () => void showRevision(rel, revision, item, ansehen));
    ansehen.dataset.ansehen = "";
    knöpfe.append(ansehen, button("Diese Fassung zurückholen", "leise", () => void restoreRevision(rel, revision)));
    item.append(when, text, knöpfe);
    fassungen.append(item);
  }
  if (json.revisions.length === 0) {
    const item = document.createElement("li");
    item.textContent = "Noch keine früheren Fassungen.";
    fassungen.append(item);
  }
}

/** Absätze, Zwischentitel und Listenpunkte, in der Fassung wie im Editor. */
const BLOECKE = "p, h1, h2, h3, h4, li:not(:has(p)), blockquote:not(:has(p))";

function norm(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function bloecke(host: Element): HTMLElement[] {
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
function markiereUnterschiede(alt: HTMLElement): { anders: number; neu: number } {
  // Nur der Text selbst, nicht die Menüs von Crepe daneben.
  const jetzt = bloecke(editorHost.querySelector(".ProseMirror") ?? editorHost).map((block) => norm(block.textContent ?? ""));
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

let offeneFassung: HTMLElement | null = null;

/** Zeigt die Fassung direkt unter ihrem Eintrag. Ein zweiter Klick schliesst sie. */
async function showRevision(rel: string, revision: Revision, item: HTMLElement, knopf: HTMLButtonElement): Promise<void> {
  for (const andere of fassungen.querySelectorAll<HTMLButtonElement>("[data-ansehen]")) andere.textContent = "Ansehen";
  if (offeneFassung === item && !vorschau.hidden) {
    vorschau.hidden = true;
    offeneFassung = null;
    return;
  }
  const params = new URLSearchParams({ rel, rev: revision.rev, path: revision.path });
  const response = await fetch(`/api/history?${params}`);
  const json = (await response.json()) as { html: string; titel: string };
  if (current?.rel !== rel) return;
  offeneFassung = item;
  knopf.textContent = "Schliessen";
  vorschau.innerHTML = `<p class="legende"></p><h3 class="fassung-titel">${esc(json.titel)}</h3>${json.html}`;
  const titel = vorschau.querySelector<HTMLElement>(".fassung-titel")!;
  if (json.titel !== collect().titel) titel.classList.add("anders");
  const { anders, neu } = markiereUnterschiede(vorschau);
  // Nur sagen, was wirklich anders ist.
  const teile = [
    titel.classList.contains("anders") ? "Der Titel war anders." : "",
    anders ? `${anders === 1 ? "1 Absatz steht" : `${anders} Absätze stehen`} so nicht mehr im Text (gelb, geänderte Wörter hervorgehoben).` : "",
    neu ? `Seither ${neu === 1 ? "ist 1 Absatz" : `sind ${neu} Absätze`} dazugekommen.` : "",
  ].filter(Boolean);
  vorschau.querySelector(".legende")!.textContent = teile.length ? teile.join(" ") : "Diese Fassung ist gleich wie der jetzige Text.";
  item.append(vorschau);
  vorschau.hidden = false;
  vorschau.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

async function restoreRevision(rel: string, revision: Revision): Promise<void> {
  const ja = await ask({
    titel: "Diese Fassung zurückholen?",
    text: "Der jetzige Text wird ersetzt, bleibt aber unter „Frühere Fassungen“ erhalten.",
    ja: "Zurückholen",
    nein: "Abbrechen",
  });
  if (!ja) return;
  await saveNow();
  const response = await post("/api/restore", { rel, rev: revision.rev, path: revision.path });
  if (!response.ok) {
    setSaved(await errorText(response, "Zurückholen fehlgeschlagen."), "fehler");
    return;
  }
  await openPage(rel);
  setSaved("Fassung zurückgeholt ✓");
  await loadList();
}

const eingangFormat = new Intl.DateTimeFormat("de-CH", { dateStyle: "medium", timeStyle: "short" });

const TELEGRAM: Record<NonNullable<Anfrage["telegram"]>, string> = {
  gesendet: "an Telegram gesendet",
  fehler: "Telegram fehlgeschlagen",
  aus: "Telegram aus",
};

const STATUS_MARKE: Record<Anfrage["status"], string> = {
  neu: `<span class="marke neu">Neu</span>`,
  gelesen: `<span class="marke">Gelesen</span>`,
  erledigt: `<span class="marke online">Erledigt</span>`,
};

function wer(anfrage: Anfrage): string {
  return `${anfrage.vorname} ${anfrage.name}`;
}

function offen(anfrage: Anfrage): boolean {
  return anfrage.status !== "erledigt";
}

/** „vor 3 Tagen“, für die älteste offene Anfrage. */
function wartetSeit(iso: string): string {
  const tage = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (tage <= 0) return "seit heute";
  if (tage === 1) return "seit gestern";
  return `seit ${tage} Tagen`;
}

function zaehle() {
  const neu = alleAnfragen.filter((a) => a.status === "neu").length;
  const offene = alleAnfragen.filter(offen).length;
  return { neu, offen: offene, erledigt: alleAnfragen.length - offene, alle: alleAnfragen.length };
}

function anfrageItem(anfrage: Anfrage): HTMLElement {
  const item = document.createElement("button");
  item.type = "button";
  item.dataset.anfrage = anfrage.id;
  item.toggleAttribute("aria-current", anfrage.id === gewaehlt);
  const head = document.createElement("span");
  head.className = "kopfzeile";
  head.innerHTML = `${anfrage.status === "neu" ? STATUS_MARKE.neu + " " : ""}${esc(eingangFormat.format(new Date(anfrage.eingang)))}`;
  const text = document.createElement("span");
  text.className = "thema";
  text.textContent = wer(anfrage);
  item.append(head, text);
  item.addEventListener("click", () => void openAnfrage(anfrage.id));
  const zeile = document.createElement("div");
  zeile.className = anfrage.status === "neu" ? "eintrag ungelesen" : "eintrag";
  zeile.append(item);
  return zeile;
}

function anfrageKarte(anfrage: Anfrage): HTMLElement {
  const karte = document.createElement("li");
  karte.id = `anfrage-${anfrage.id}`;
  karte.dataset.status = anfrage.status;
  karte.classList.toggle("gewaehlt", anfrage.id === gewaehlt);
  const kopf = document.createElement("p");
  kopf.className = "kopfzeile";
  kopf.innerHTML = `${STATUS_MARKE[anfrage.status]} `;
  const when = document.createElement("time");
  when.dateTime = anfrage.eingang;
  when.textContent = eingangFormat.format(new Date(anfrage.eingang));
  kopf.append(when);
  if (anfrage.status === "erledigt" && anfrage.seit) kopf.append(` · erledigt am ${eingangFormat.format(new Date(anfrage.seit))}`);
  if (anfrage.telegram) kopf.append(` · ${TELEGRAM[anfrage.telegram]}`);
  const name = document.createElement("h2");
  name.textContent = wer(anfrage);
  const mail = document.createElement("a");
  mail.href = `mailto:${encodeURIComponent(anfrage.email).replace("%40", "@")}?subject=${encodeURIComponent("Ihre Anfrage an Advocat Finanz")}`;
  mail.textContent = anfrage.email;
  const nachricht = document.createElement("p");
  nachricht.className = "nachricht";
  nachricht.textContent = anfrage.nachricht;
  const knoepfe = document.createElement("div");
  knoepfe.className = "aktionen";
  const antworten = document.createElement("a");
  antworten.className = "knopf";
  antworten.href = mail.href;
  antworten.textContent = "Per E-Mail antworten";
  // Wer antwortet, hat sie gelesen.
  antworten.addEventListener("click", () => {
    if (anfrage.status === "neu") void setStatus(anfrage.id, "gelesen");
  });
  if (anfrage.status === "erledigt") {
    knoepfe.append(antworten, button("Wieder öffnen", "leise", () => void setStatus(anfrage.id, "gelesen")));
  } else {
    knoepfe.append(button("Erledigt ✓", "haupt", () => void setStatus(anfrage.id, "erledigt")), antworten);
    knoepfe.append(
      anfrage.status === "neu"
        ? button("Als gelesen markieren", "leise", () => void setStatus(anfrage.id, "gelesen"))
        : button("Als ungelesen markieren", "leise", () => void setStatus(anfrage.id, "neu")),
    );
  }
  karte.append(kopf, name, mail, nachricht, knoepfe);
  return karte;
}

/** Holt die Anfragen und zeichnet alles neu, was davon abhängt. Unverändert: nichts. */
async function loadAnfragen(force = false): Promise<void> {
  const json = (await fetch("/api/anfragen", { cache: "no-store" })
    .then((res) => res.json())
    .catch(() => null)) as { anfragen: Anfrage[] } | null;
  if (!json) return;
  const stand = JSON.stringify(json.anfragen);
  if (!force && stand === anfragenStand) return;
  anfragenStand = stand;
  alleAnfragen = json.anfragen;
  renderAnfragen();
}

function renderAnfragen(): void {
  const zahl = zaehle();
  document.title = `${zahl.neu ? `(${zahl.neu}) ` : ""}Redaktion · Advocat Finanz`;
  anfragenZahl.textContent = zahl.neu ? `${zahl.neu} neu` : "";

  // Im Verzeichnis nur, was noch offen ist. Erledigte stehen in der Übersicht.
  const offene = alleAnfragen.filter(offen);
  anfragenListe.replaceChildren(...offene.map(anfrageItem));
  if (offene.length === 0) {
    const leer = document.createElement("p");
    leer.className = "leise";
    leer.textContent = alleAnfragen.length ? "Alle Anfragen sind erledigt." : "Noch keine Anfragen.";
    anfragenListe.append(leer);
  }

  renderStartAnfragen(zahl);
  if (!anfragenSeite.hidden) renderUebersicht();
}

function renderStartAnfragen(zahl: ReturnType<typeof zaehle>): void {
  // Neue zuerst. Gibt es keine, die noch offenen.
  const zeigen = (zahl.neu ? alleAnfragen.filter((a) => a.status === "neu") : alleAnfragen.filter(offen)).slice(0, 3);
  startAnfragen.classList.toggle("dringend", zahl.neu > 0);
  aufgabe(startAnfragen, {
    titel: "Kontaktaufnahme",
    gross: zahl.neu
      ? zahl.neu === 1 ? "Eine neue Anfrage" : `${zahl.neu} neue Anfragen`
      : "Keine neuen Anfragen",
    leise: zahl.alle
      ? `${zahl.offen} offen · ${zahl.erledigt} erledigt`
      : "Anfragen aus dem Kontaktformular erscheinen hier.",
    liste: zeigen.map((anfrage) => ({
      label: wer(anfrage),
      info: `${anfrage.status === "neu" ? "Neu" : "Gelesen"} · ${eingangFormat.format(new Date(anfrage.eingang))}`,
      onClick: () => void openAnfrage(anfrage.id),
    })),
    knopf: button("Zur Kontaktaufnahme", zahl.neu ? "haupt" : "", () => void showAnfragen()),
  });
}

function kachel(filter: AnfragenFilter, wert: number, label: string, unter: string): HTMLButtonElement {
  const element = document.createElement("button");
  element.type = "button";
  element.className = "kachel";
  element.setAttribute("aria-pressed", String(anfragenFilter === filter));
  element.innerHTML = `<span class="label">${esc(label)}</span><span class="wert">${wert}</span><span class="unter">${esc(unter)}</span>`;
  element.addEventListener("click", () => {
    anfragenFilter = filter;
    renderUebersicht();
  });
  return element;
}

function renderUebersicht(): void {
  const zahl = zaehle();
  anfragenKacheln.replaceChildren(
    kachel("offen", zahl.offen, "Offen", zahl.neu ? `davon ${zahl.neu} neu` : "keine neuen"),
    kachel("erledigt", zahl.erledigt, "Erledigt", zahl.alle ? `${Math.round((zahl.erledigt / zahl.alle) * 100)} % aller Anfragen` : "–"),
    kachel("alle", zahl.alle, "Gesamt", `${alleAnfragen.filter((a) => Date.now() - new Date(a.eingang).getTime() < 30 * 86_400_000).length} in den letzten 30 Tagen`),
  );
  const sichtbare = alleAnfragen.filter((a) =>
    anfragenFilter === "alle" ? true : anfragenFilter === "offen" ? offen(a) : !offen(a),
  );
  const aeltesteOffene = alleAnfragen.filter(offen).at(-1);
  if (alleAnfragen.length === 0) anfragenText.textContent = "Noch keine Anfragen über das Kontaktformular.";
  else if (anfragenFilter === "offen") {
    anfragenText.textContent = aeltesteOffene
      ? `Offene Anfragen, die neueste zuerst. Die älteste wartet ${wartetSeit(aeltesteOffene.eingang)}.`
      : "Keine offenen Anfragen. Alles erledigt.";
  } else if (anfragenFilter === "erledigt") {
    anfragenText.textContent = sichtbare.length ? "Erledigte Anfragen, die neueste zuerst." : "Noch nichts erledigt.";
  } else anfragenText.textContent = "Alle Anfragen, die neueste zuerst.";
  anfragenKarten.replaceChildren(...sichtbare.map(anfrageKarte));
}

async function setStatus(id: string, status: Anfrage["status"]): Promise<void> {
  const response = await fetch("/api/anfragen", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id, status }),
  }).catch(() => null);
  if (!response?.ok) {
    await ask({
      titel: "Das hat nicht geklappt",
      text: response ? await errorText(response, "Der Stand liess sich nicht speichern.") : "Keine Verbindung zum Server.",
      ja: "OK",
    });
    return;
  }
  await loadAnfragen(true);
}

function briefKachel(filter: typeof briefeFilter, wert: number, label: string, unter: string): HTMLButtonElement {
  const element = document.createElement("button");
  element.type = "button";
  element.className = "kachel";
  element.setAttribute("aria-pressed", String(briefeFilter === filter));
  element.innerHTML = `<span class="label">${esc(label)}</span><span class="wert">${wert}</span><span class="unter">${esc(unter)}</span>`;
  element.addEventListener("click", () => {
    briefeFilter = filter;
    renderBriefUebersicht();
  });
  return element;
}

function briefKarte(page: PageSummary): HTMLElement {
  const karte = document.createElement("li");
  karte.dataset.entwurf = String(page.entwurf);
  const kopf = document.createElement("p");
  kopf.className = "kopfzeile";
  kopf.innerHTML = page.entwurf
    ? `<span class="marke">Entwurf</span> Nr. ${page.nummer ?? ""} · ${esc(shortDate(page.datum))}`
    : `<span class="marke online">Online</span> Nr. ${page.nummer ?? ""} · ${esc(shortDate(page.datum))}`;
  const titel = document.createElement("h2");
  const link = button(thema(page.titel) || "Noch ohne Thema", "titel-knopf", () => void openPage(page.rel));
  titel.append(link);
  const text = document.createElement("p");
  text.className = "auszug";
  text.textContent = page.auszug || "Noch kein Text.";
  const knoepfe = document.createElement("div");
  knoepfe.className = "aktionen";
  knoepfe.append(button("Bearbeiten", "", () => void openPage(page.rel)));
  if (page.entwurf) knoepfe.append(button("Veröffentlichen", "haupt", () => void publish(page.rel)));
  else {
    const ansehen = document.createElement("a");
    ansehen.className = "knopf";
    ansehen.href = `${publicOrigin}${page.href}`;
    ansehen.target = "_blank";
    ansehen.rel = "noopener";
    ansehen.textContent = "Auf der Website ansehen ↗";
    knoepfe.append(ansehen);
  }
  knoepfe.append(button("Kopie anlegen", "leise", () => void copyPage(page.rel)));
  karte.append(kopf, titel, text, knoepfe);
  return karte;
}

/** Alle Newsletter auf einen Blick: Zahlen oben, Suche, darunter die Karten. Entwürfe zuerst. */
function renderBriefUebersicht(): void {
  const entwuerfe = alleBriefe.filter((page) => page.entwurf);
  const online = alleBriefe.filter((page) => !page.entwurf);
  const zuletzt = online[0];
  briefeKacheln.replaceChildren(
    briefKachel("entwuerfe", entwuerfe.length, "Entwürfe", entwuerfe.length ? "warten aufs Veröffentlichen" : "keine offenen"),
    briefKachel("online", online.length, "Online", zuletzt ? `zuletzt Nr. ${zuletzt.nummer ?? ""} am ${shortDate(zuletzt.datum)}` : "noch keiner"),
    briefKachel("alle", alleBriefe.length, "Gesamt", "alle Newsletter"),
  );
  const suche = briefeSuche.value.trim().toLowerCase();
  const sichtbare = alleBriefe
    .filter((page) => (briefeFilter === "alle" ? true : briefeFilter === "entwuerfe" ? page.entwurf : !page.entwurf))
    .filter((page) => !suche || page.titel.toLowerCase().includes(suche) || String(page.nummer ?? "") === suche.replace(/^nr\.?\s*/, ""));
  if (suche) briefeText.textContent = sichtbare.length ? `${sichtbare.length} Treffer für «${briefeSuche.value.trim()}».` : `Nichts gefunden für «${briefeSuche.value.trim()}».`;
  else if (briefeFilter === "entwuerfe") briefeText.textContent = sichtbare.length ? "Entwürfe, nur hier in der Redaktion sichtbar." : "Keine offenen Entwürfe.";
  else if (briefeFilter === "online") briefeText.textContent = "Veröffentlichte Newsletter, der neueste zuerst.";
  else briefeText.textContent = "Alle Newsletter. Entwürfe zuerst, dann der neueste.";
  briefeKarten.replaceChildren(...sichtbare.map(briefKarte));
}

/** Die Übersicht der Newsletter, wie die Kontaktaufnahme. */
async function showBriefe(): Promise<void> {
  if (!(await flushCommit())) return;
  current = null;
  gewaehlt = null;
  markCurrent();
  start.hidden = true;
  form.hidden = true;
  anfragenSeite.hidden = true;
  briefeSeite.hidden = false;
  wuenscheSeite.hidden = true;
  if (!schmal.matches) briefeGruppe.open = true;
  merke("newsletter");
  renderBriefUebersicht();
  nachOben();
}

const ART_LABEL: Record<Wunsch["art"], string> = { design: "Aussehen der Website", funktion: "Funktion der Redaktion" };

/** Wünsche zeigen Absätze und **fett** wie im Assistenten, sonst reinen Text. */
function wunschHtml(text: string): string {
  return esc(text)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/^\s*[-*•]\s+/gm, "• ")
    .replace(/\n/g, "<br>");
}

async function loadWuensche(): Promise<void> {
  const json = (await fetch("/api/wuensche", { cache: "no-store" })
    .then((res) => res.json())
    .catch(() => null)) as { wuensche: Wunsch[] } | null;
  if (!json) return;
  alleWuensche = json.wuensche;
  const offene = alleWuensche.filter((w) => w.status === "offen").length;
  wuenscheZahl.textContent = offene ? `${offene} offen` : "";
  if (!wuenscheSeite.hidden) renderWuensche();
}

function wunschKachel(filter: typeof wuenscheFilter, wert: number, label: string, unter: string): HTMLButtonElement {
  const element = document.createElement("button");
  element.type = "button";
  element.className = "kachel";
  element.setAttribute("aria-pressed", String(wuenscheFilter === filter));
  element.innerHTML = `<span class="label">${esc(label)}</span><span class="wert">${wert}</span><span class="unter">${esc(unter)}</span>`;
  element.addEventListener("click", () => {
    wuenscheFilter = filter;
    renderWuensche();
  });
  return element;
}

async function aendereWunsch(id: string, aenderung: { status?: Wunsch["status"]; aktion?: "senden" }): Promise<void> {
  const response = await fetch("/api/wuensche", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id, ...aenderung }),
  }).catch(() => null);
  if (!response?.ok) {
    await ask({ titel: "Das hat nicht geklappt", text: response ? await errorText(response, "Der Wunsch liess sich nicht ändern.") : "Keine Verbindung zum Server.", ja: "OK" });
    return;
  }
  await loadWuensche();
}

function wunschKarte(wunsch: Wunsch): HTMLElement {
  const karte = document.createElement("li");
  karte.dataset.status = wunsch.status;
  const kopf = document.createElement("p");
  kopf.className = "kopfzeile";
  kopf.innerHTML = `${wunsch.status === "erledigt" ? `<span class="marke online">Erledigt</span>` : `<span class="marke">Offen</span>`} ${esc(ART_LABEL[wunsch.art])} · ${esc(eingangFormat.format(new Date(wunsch.eingang)))}${
    wunsch.status === "erledigt" && wunsch.erledigtAm ? ` · erledigt am ${esc(shortDate(wunsch.erledigtAm.slice(0, 10)))}` : ""
  }${wunsch.seite ? ` · ${esc(wunsch.seite)}` : ""}`;
  const text = document.createElement("p");
  text.className = "nachricht";
  text.innerHTML = wunschHtml(wunsch.text);
  const knoepfe = document.createElement("div");
  knoepfe.className = "aktionen";
  knoepfe.append(
    wunsch.status === "offen"
      ? button("Als erledigt markieren", "", () => void aendereWunsch(wunsch.id, { status: "erledigt" }))
      : button("Wieder öffnen", "leise", () => void aendereWunsch(wunsch.id, { status: "offen" })),
  );
  if (wunsch.telegram !== "gesendet") {
    const hinweis = document.createElement("span");
    hinweis.className = "telegram-fehlt";
    hinweis.textContent = wunsch.telegram === "aus" ? "Telegram ist nicht eingerichtet." : "Telegram hat nicht geklappt.";
    knoepfe.append(hinweis, button("Nochmals senden", "leise", () => void aendereWunsch(wunsch.id, { aktion: "senden" })));
  }
  karte.append(kopf, text, knoepfe);
  return karte;
}

function renderWuensche(): void {
  const offene = alleWuensche.filter((w) => w.status === "offen");
  const erledigte = alleWuensche.filter((w) => w.status === "erledigt");
  wuenscheKacheln.replaceChildren(
    wunschKachel("offen", offene.length, "Offen", offene.length ? "warten auf die Betreuung" : "nichts offen"),
    wunschKachel("erledigt", erledigte.length, "Erledigt", erledigte.length ? "umgesetzt oder beantwortet" : "–"),
    wunschKachel("alle", alleWuensche.length, "Gesamt", "alle Wünsche"),
  );
  const sichtbare = wuenscheFilter === "alle" ? alleWuensche : wuenscheFilter === "offen" ? offene : erledigte;
  if (sichtbare.length) wuenscheKarten.replaceChildren(...sichtbare.map(wunschKarte));
  else {
    const leer = document.createElement("li");
    leer.className = "leer";
    leer.textContent = alleWuensche.length ? "Hier ist nichts." : "Noch keine Wünsche. Oben einen schreiben oder den Assistenten fragen.";
    wuenscheKarten.replaceChildren(leer);
  }
}

const WUENSCHE_GESEHEN = "wuensche-gesehen";

/** Die Seite «Wünsche». Beim ersten Besuch verschwindet die Marke „Neu“ im Verzeichnis. */
async function showWuensche(): Promise<void> {
  if (!(await flushCommit())) return;
  current = null;
  gewaehlt = null;
  markCurrent();
  start.hidden = true;
  form.hidden = true;
  anfragenSeite.hidden = true;
  briefeSeite.hidden = true;
  wuenscheSeite.hidden = false;
  merke("wuensche");
  try {
    localStorage.setItem(WUENSCHE_GESEHEN, "1");
  } catch {
    // Dann bleibt „Neu“ eben stehen.
  }
  wuenscheNeu.hidden = true;
  await loadWuensche();
  renderWuensche();
  nachOben();
}

/** Die Übersicht: Zahlen oben, darunter die Anfragen des gewählten Filters. */
async function showAnfragen(): Promise<boolean> {
  if (!(await flushCommit())) return false;
  current = null;
  gewaehlt = null;
  markCurrent();
  start.hidden = true;
  form.hidden = true;
  anfragenSeite.hidden = false;
  briefeSeite.hidden = true;
  wuenscheSeite.hidden = true;
  if (!schmal.matches) anfragenGruppe.open = true;
  merke("anfragen");
  await loadAnfragen(true);
  nachOben();
  return true;
}

/** Eine Anfrage aus dem Verzeichnis: in der Übersicht zeigen und als gelesen merken. */
async function openAnfrage(id: string): Promise<void> {
  if (!(await showAnfragen())) return;
  const anfrage = alleAnfragen.find((a) => a.id === id);
  if (!anfrage) return;
  gewaehlt = id;
  // Der Filter muss die gewählte Anfrage zeigen.
  if (!offen(anfrage) && anfragenFilter === "offen") anfragenFilter = "alle";
  if (offen(anfrage) && anfragenFilter === "erledigt") anfragenFilter = "offen";
  if (anfrage.status === "neu") await setStatus(id, "gelesen");
  else renderAnfragen();
  document.getElementById(`anfrage-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

form.addEventListener("submit", (event) => event.preventDefault());
titelInput.addEventListener("keydown", (event) => {
  // Ein Titel hat keine Zeilenumbrüche. Enter springt in den Text.
  if (event.key !== "Enter") return;
  event.preventDefault();
  editorHost.querySelector<HTMLElement>("[contenteditable]")?.focus();
});
titelInput.addEventListener("input", () => {
  titelInput.value = titelInput.value.replace(/\s*\n\s*/g, " ");
  fitTitel();
  updateListLabel();
  scheduleSave();
});
datumInput.addEventListener("input", () => scheduleSave());
nummerInput.addEventListener("input", () => {
  if (!current || !isBrief(current)) return;
  kennung.textContent = `Newsletter ${gewaehlteNummer() ?? ""}`;
  pruefeNummer();
  scheduleSave();
});
window.addEventListener("pagehide", () => {
  void fetch("/api/commit", { method: "POST", keepalive: true }).catch(() => null);
});
window.addEventListener("beforeunload", (event) => {
  if (saveTimer != null) event.preventDefault();
});
// Ist die Verbindung zurück, gleich speichern statt auf den nächsten Versuch zu warten.
window.addEventListener("online", () => {
  if (saveTimer != null) void saveNow();
});
// Ctrl+S oder Cmd+S speichert sofort, statt dass der Browser die Seite herunterlädt.
document.addEventListener("keydown", (event) => {
  if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "s") return;
  event.preventDefault();
  if (current && !form.hidden) void saveNow();
});
/**
 * Auf einem kleinen Laptop mit offenem Assistenten wird das Verzeichnis zur Schublade links,
 * damit der Text seine Breite behält. Ob die Schublade gilt, entscheidet das CSS; hier nur auf und zu.
 */
const verzeichnis = root.querySelector<HTMLElement>("#verzeichnis")!;
const verzeichnisAuf = root.querySelector<HTMLButtonElement>("#verzeichnis-auf")!;
function zeigeVerzeichnis(offen: boolean): void {
  document.body.classList.toggle("verzeichnis-offen", offen);
  verzeichnisAuf.setAttribute("aria-expanded", String(offen));
}
verzeichnisAuf.addEventListener("click", (event) => {
  event.stopPropagation();
  const offen = !document.body.classList.contains("verzeichnis-offen");
  zeigeVerzeichnis(offen);
  if (offen) verzeichnis.querySelector<HTMLElement>("button, summary")?.focus();
});
// Ein Klick daneben schliesst sie, ebenso jede Wahl darin, die eine andere Ansicht öffnet.
document.addEventListener("click", (event) => {
  if (!document.body.classList.contains("verzeichnis-offen")) return;
  const ziel = event.target as Element;
  if (!verzeichnis.contains(ziel) || ziel.closest("nav button[data-rel], nav button[data-anfrage], button.mehr:not(#mehr), button.gruppe-titel, #heim")) {
    zeigeVerzeichnis(false);
  }
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && document.body.classList.contains("verzeichnis-offen")) {
    zeigeVerzeichnis(false);
    verzeichnisAuf.focus();
  }
});
root.querySelector("#heim")!.addEventListener("click", async () => {
  if (await flushCommit()) showStart();
});
root.querySelector("#anfragen-alle")!.addEventListener("click", () => void showAnfragen());
root.querySelector("#briefe-alle")!.addEventListener("click", () => void showBriefe());
root.querySelector("#wuensche-link")!.addEventListener("click", () => void showWuensche());
root.querySelector("#start-wunsch")!.addEventListener("click", async () => {
  await showWuensche();
  wunschText.focus();
});
try {
  wuenscheNeu.hidden = localStorage.getItem(WUENSCHE_GESEHEN) === "1";
} catch {
  wuenscheNeu.hidden = true;
}
wunschForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = wunschText.value.trim();
  if (!text) {
    wunschText.focus();
    return;
  }
  const knopf = wunschForm.querySelector<HTMLButtonElement>('button[type="submit"]')!;
  knopf.disabled = true;
  wunschMeldung.textContent = "Wird gesendet …";
  const response = await fetch("/api/wuensche", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ art: wunschArt.value, text, seite: "" }),
  }).catch(() => null);
  knopf.disabled = false;
  if (!response?.ok) {
    wunschMeldung.textContent = response ? await errorText(response, "Senden ging nicht.") : "Keine Verbindung zum Server.";
    return;
  }
  const wunsch = (await response.json()) as Wunsch;
  wunschText.value = "";
  wunschMeldung.textContent =
    wunsch.telegram === "gesendet"
      ? "Gesendet ✓"
      : wunsch.telegram === "aus"
        ? "Gespeichert. Telegram ist hier nicht eingerichtet."
        : "Gespeichert. Telegram hat nicht geklappt, unten nochmals senden.";
  wuenscheFilter = "offen";
  await loadWuensche();
  renderWuensche();
});
root.querySelector("#briefe-neu")!.addEventListener("click", () => void newBrief());
briefeSuche.addEventListener("input", () => renderBriefUebersicht());
// Der Name einer Gruppe öffnet ihre Übersicht. Auf- und zuklappen macht der Rest der Zeile mit dem Pfeil.
for (const [titel, zeige] of [
  ["#briefe-titel", showBriefe],
  ["#anfragen-titel", showAnfragen],
] as const) {
  root.querySelector(titel)!.addEventListener("click", (event) => {
    event.preventDefault();
    void zeige();
  });
}
// Neue Anfragen erscheinen ohne Neuladen.
window.setInterval(() => void loadAnfragen(), 60_000);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
  void loadAnfragen();
  // Wer die Redaktion morgens offen liess, wird abends nicht mehr mit «Guten Morgen» begrüsst.
  root.querySelector("#gruss")!.textContent = gruss();
});
mehr.addEventListener("click", () => {
  sichtbar += 10;
  renderBriefe();
});

/** Unsichtbares Dateifeld für «Word importieren». */
const wordInput = document.createElement("input");
wordInput.type = "file";
wordInput.accept = ".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document";
wordInput.hidden = true;
root.append(wordInput);
wordInput.addEventListener("change", () => {
  const file = wordInput.files?.[0];
  wordInput.value = "";
  if (file) void importiereWord(file);
});

/** Eine Word-Datei ersetzt den Text des offenen Entwurfs. Bilder kommen mit. */
async function importiereWord(file: File): Promise<void> {
  if (!current || !crepe) return;
  if (!current.entwurf) {
    await ask({ titel: "Nur in einen Entwurf", text: "Word-Dateien lassen sich nur in einen Entwurf importieren. Für einen neuen Newsletter zuerst «Neuen Newsletter schreiben».", ja: "OK" });
    return;
  }
  if (!/\.docx$/i.test(file.name)) {
    await ask({ titel: "Keine .docx-Datei", text: `«${file.name}» ist keine Word-Datei im Format .docx. Bitte in Word unter «Speichern unter» als «Word-Dokument (.docx)» speichern.`, ja: "OK" });
    return;
  }
  if (forFile(crepe.getMarkdown()).trim()) {
    const ja = await ask({
      titel: "Text ersetzen?",
      text: `Der Entwurf hat schon Text. «${file.name}» ersetzt ihn. Zurück geht es mit Ctrl+Z oder unter «Frühere Fassungen».`,
      ja: "Ersetzen",
      nein: "Abbrechen",
    });
    if (!ja) return;
  }
  const rel = current.rel;
  setSaved("Word-Datei wird gelesen …", "busy");
  const response = await fetch(`/api/import?rel=${encodeURIComponent(rel)}`, { method: "POST", body: file }).catch(() => null);
  if (!response?.ok) {
    setSaved(response ? await errorText(response, "Die Word-Datei liess sich nicht lesen.") : "Keine Verbindung zum Server.", "fehler");
    return;
  }
  const json = (await response.json()) as { markdown: string; thema: string; bilder: string[]; ausgelassen: number };
  if (current?.rel !== rel || !crepe) return;
  // Als normale Änderung: Ctrl+Z holt den alten Text zurück.
  crepe.editor.action(replaceAll(forEditor(json.markdown)));
  if (json.thema && !titelInput.value.trim()) setzeThema(json.thema);
  if (!(await saveNow())) return;
  const bilder = json.bilder.length === 1 ? "1 Bild" : `${json.bilder.length} Bilder`;
  const fehlend = json.ausgelassen
    ? ` · ${json.ausgelassen} ${json.ausgelassen === 1 ? "Bild ist" : "Bilder sind"} in einem Format, das die Website nicht zeigt. Bitte selbst einsetzen.`
    : "";
  setSaved(`Word importiert ✓ · ${bilder}${fehlend}`, fehlend ? "fehler" : "ok");
  haltMeldungBis = Date.now() + (fehlend ? 15_000 : 6000);
}

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/**
 * Beim Ziehen kennt der Browser nur die Art der Datei, nicht den Namen. Ohne Angabe könnte es Word sein.
 * Der Zähler, weil jedes Kind des Editors beim Darüberziehen selbst «enter» und «leave» meldet.
 */
let ziehen = 0;
function wordImZug(event: DragEvent): boolean {
  return [...(event.dataTransfer?.items ?? [])].some((item) => item.kind === "file" && (item.type === DOCX || item.type === ""));
}
function zielAus(): void {
  ziehen = 0;
  delete editorHost.dataset.ziel;
}
editorHost.addEventListener("dragenter", (event) => {
  if (!wordImZug(event)) return;
  ziehen++;
  editorHost.dataset.ziel = current?.entwurf ? "word" : "nein";
});
editorHost.addEventListener("dragleave", () => {
  if (ziehen > 0 && --ziehen === 0) zielAus();
});
window.addEventListener("dragend", zielAus);
window.addEventListener("drop", zielAus);

// Eine .docx auf den Text ziehen importiert sie. Bilder und alles andere behandelt der Editor wie bisher.
editorHost.addEventListener(
  "drop",
  (event) => {
    zielAus();
    const file = [...(event.dataTransfer?.files ?? [])].find((f) => /\.docx$/i.test(f.name));
    if (!file) return;
    event.preventDefault();
    event.stopPropagation();
    void importiereWord(file);
  },
  true,
);

function setzeThema(text: string): void {
  titelInput.value = isBrief(current) ? thema(text) : text.trim();
  fitTitel();
  updateListLabel();
  scheduleSave();
}

/** Was der Assistent sieht und wie er Text einsetzt. */
function lage(): Lage {
  if (!current || !crepe || form.hidden) {
    return { ansicht: !anfragenSeite.hidden ? "anfragen" : !briefeSeite.hidden ? "briefe" : !wuenscheSeite.hidden ? "wuensche" : "start" };
  }
  const doc = collect();
  return { ansicht: "blatt", rel: doc.rel, art: doc.art, titel: doc.titel, datum: doc.datum, entwurf: doc.entwurf, body: doc.body };
}

const info = (await fetch("/api/info").then((response) => response.json()).catch(() => ({}))) as {
  publicUrl?: string;
  assistent?: boolean;
};
publicOrigin = info.publicUrl ?? "";
void mountAssistent(
  {
    lage,
    offen: () => (current && crepe && !form.hidden ? { rel: current.rel, titel: collect().titel } : null),
    markdown: () => (crepe && current ? forFile(crepe.getMarkdown()).trim() : null),
    // Als normale Änderung im Editor: Ctrl+Z macht sie rückgängig, gespeichert wird wie beim Tippen.
    setzeText: (markdown) => crepe?.editor.action(replaceAll(forEditor(markdown))),
    setzeThema,
    neuerNewsletter: async (text) => {
      // Ein leerer Entwurf, der schon offen ist, wird genommen statt einen zweiten anzulegen.
      const leer = current && isBrief(current) && current.entwurf && crepe && !form.hidden && !collect().body.trim();
      if (!leer) {
        await newBrief();
        if (!current || !isBrief(current) || !current.entwurf) return null;
      }
      setzeThema(text);
      return current!.rel;
    },
    // Während des Schreibens den Zustand ersetzen, nicht ändern: keine hundert Rückgängig-Schritte.
    schreibeLive: (markdown) => crepe?.editor.action(replaceAll(forEditor(markdown), true)),
    speichere: () => scheduleSave(),
    zeigeWuensche: () => void showWuensche(),
    frage: ask,
    oeffneNewsletter: (text) => {
      const page = alleBriefe.find((item) => thema(item.titel) === text.trim());
      if (page) void openPage(page.rel);
      return page != null;
    },
    editor: editorHost,
  },
  info.assistent === true,
);
/** Zeigt die Ansicht zur Adresse: beim Laden und bei «Zurück» oder «Vorwärts» im Browser. */
async function folge(): Promise<void> {
  const wanted = decodeURIComponent(location.hash.slice(1));
  if (wanted === "anfragen") await showAnfragen();
  else if (wanted === "newsletter") await showBriefe();
  else if (wanted === "wuensche") await showWuensche();
  else if (wanted) await openPage(wanted);
  else if (await flushCommit()) showStart();
}
window.addEventListener("popstate", () => void folge());

await loadList();
await loadAnfragen();
await loadWuensche();
await folge();
