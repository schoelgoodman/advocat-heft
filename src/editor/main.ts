import * as crepeModule from "@milkdown/crepe";
import "@milkdown/crepe/theme/common/style.css";
import "@milkdown/crepe/theme/frame.css";
import "./redaktion.css";
import type { Art, ContentDocument } from "../content/document.ts";

interface CrepeApi {
  markdownUpdated(fn: (ctx: unknown, markdown: string, prev: string) => void): void;
}

interface CrepeEditor {
  create(): Promise<unknown>;
  destroy(): Promise<unknown>;
  getMarkdown(): string;
  on(fn: (api: CrepeApi) => void): unknown;
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

interface PageSummary {
  rel: string;
  titel: string;
  art: Art;
  datum: string;
  nummer: number | null;
  entwurf: boolean;
  href: string;
}

type Doc = ContentDocument & { href: string };

const root = document.querySelector<HTMLElement>("#redaktion");
if (!root) throw new Error("Redaktion fehlt");

let crepe: CrepeEditor | null = null;
let current: Doc | null = null;
let saveTimer: number | null = null;
let armed = false;
let alleBriefe: PageSummary[] = [];
let alleSeiten: PageSummary[] = [];
let sichtbar = 10;

root.innerHTML = `
  <div class="redaktion">
    <aside>
      <button type="button" class="wort" id="heim" title="Zur Startseite">
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M3 11 12 4l9 7M6 9.5V20h4.5v-5.5h3V20H18V9.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>
        Redaktion
      </button>
      <button type="button" class="haupt" data-neu>+ Neuer Newsletter</button>
      <details id="briefe-gruppe" open>
        <summary>Newsletter</summary>
        <nav id="briefe"></nav>
        <button type="button" class="leise mehr" id="mehr" hidden></button>
      </details>
      <details id="seiten-gruppe">
        <summary>Übrige Seiten</summary>
        <nav id="seiten"></nav>
      </details>
      <details id="papierkorb-gruppe" hidden>
        <summary>Papierkorb</summary>
        <p class="leise">Gelöschte Entwürfe. Zurückgeholt sind sie wieder Entwürfe.</p>
        <nav id="papierkorb"></nav>
      </details>
    </aside>
    <main>
      <section id="start">
        <h1>Guten Tag, Patrick.</h1>
        <p>Was möchten Sie tun?</p>
        <button type="button" class="haupt gross" data-neu>Neuen Newsletter schreiben</button>
        <p class="leise">Oder links einen Newsletter zum Bearbeiten wählen.</p>
      </section>
      <form id="blatt" hidden>
        <div class="leiste">
          <p class="stand" id="stand"></p>
          <p class="speicher" id="speicher" aria-live="polite"></p>
          <div class="aktionen" id="aktionen"></div>
        </div>
        <p class="kennung" id="kennung"></p>
        <textarea id="titel" class="titel" rows="1" autocomplete="off"></textarea>
        <label class="datum" id="datum-feld">Datum <input type="date" id="datum"></label>
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
const form = root.querySelector<HTMLFormElement>("#blatt")!;
const stand = root.querySelector<HTMLElement>("#stand")!;
const speicher = root.querySelector<HTMLElement>("#speicher")!;
const aktionen = root.querySelector<HTMLElement>("#aktionen")!;
const kennung = root.querySelector<HTMLElement>("#kennung")!;
const titelInput = root.querySelector<HTMLTextAreaElement>("#titel")!;
const datumFeld = root.querySelector<HTMLElement>("#datum-feld")!;
const datumInput = root.querySelector<HTMLInputElement>("#datum")!;
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

function setSaved(text: string, kind: "ok" | "busy" | "fehler" = "ok"): void {
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
  kopieren:
    '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="5" y="5" width="8.5" height="8.5" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M3 10.5V2.5h8" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>',
  online:
    '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8s-2.4 4.5-6.5 4.5S1.5 8 1.5 8z" fill="none" stroke="currentColor" stroke-width="1.3"/><circle cx="8" cy="8" r="2" fill="currentColor"/></svg>',
  entwurf:
    '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8s-2.4 4.5-6.5 4.5S1.5 8 1.5 8z" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M2.5 13.5l11-11" stroke="currentColor" stroke-width="1.3"/></svg>',
};

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

  const werkzeuge = document.createElement("span");
  werkzeuge.className = "werkzeuge";
  werkzeuge.append(icon(ICONS.kopieren, "Kopie anlegen", () => void copyPage(page.rel)));
  if (page.rel !== STARTSEITE) {
    werkzeuge.append(
      page.entwurf
        ? icon(ICONS.entwurf, "Entwurf · Veröffentlichen", () => void publish(page.rel))
        : icon(ICONS.online, "Online · Von der Website nehmen", () => void unpublish(page.rel)),
    );
  }
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
}

function markCurrent(): void {
  for (const item of root!.querySelectorAll<HTMLButtonElement>("nav button[data-rel]")) {
    item.toggleAttribute("aria-current", item.dataset.rel === current?.rel);
  }
  if (current) (isBrief(current) ? briefeGruppe : seitenGruppe).open = true;
}

/** Hält das Thema im Verzeichnis gleich, während getippt wird. */
function updateListLabel(): void {
  if (!current || !isBrief(current)) return;
  const item = briefe.querySelector<HTMLElement>(`button[data-rel="${CSS.escape(current.rel)}"] .thema`);
  if (item) item.textContent = titelInput.value.trim() || "Noch ohne Thema";
}

function collect(): ContentDocument {
  if (!current || !crepe) throw new Error("Keine Seite");
  const brief = isBrief(current);
  return {
    rel: current.rel,
    art: current.art,
    nummer: current.nummer,
    entwurf: current.entwurf,
    titel: brief ? briefTitel(current.nummer, titelInput.value) : titelInput.value.trim() || current.titel,
    datum: brief ? datumInput.value || current.datum : current.datum,
    body: forFile(crepe.getMarkdown()).trim(),
  };
}

function same(a: ContentDocument, b: ContentDocument): boolean {
  return a.titel === b.titel && a.datum === b.datum && a.body.trim() === b.body.trim();
}

function viewHref(doc: Doc): string {
  return `${publicOrigin}${doc.href}`;
}

/** Zeigt, wo die Seite steht und was als Nächstes zu tun ist. */
function renderStand(): void {
  if (!current) return;
  const doc = current;
  aktionen.replaceChildren();
  if (doc.entwurf) {
    stand.innerHTML = `<span class="marke">Entwurf</span> Nur hier in der Redaktion sichtbar.`;
    aktionen.append(
      button("Löschen", "leise", () => void deleteDraft()),
      button("Kopie anlegen", "leise", () => void copyPage(doc.rel)),
      button("Vorschau", "", () => void openPreview()),
      button("Veröffentlichen", "haupt", () => void publish()),
    );
    return;
  }
  stand.innerHTML = `<span class="marke online">Online</span> Änderungen erscheinen sofort auf der Website.`;
  aktionen.append(button("Kopie anlegen", "leise", () => void copyPage(doc.rel)));
  if (doc.rel !== STARTSEITE) aktionen.append(button("Zurückziehen", "leise", () => void unpublish()));
  const link = document.createElement("a");
  link.className = "knopf";
  link.href = viewHref(doc);
  link.target = "_blank";
  link.rel = "noopener";
  link.textContent = "Auf der Website ansehen ↗";
  aktionen.append(link);
}

function showStart(): void {
  current = null;
  form.hidden = true;
  start.hidden = false;
  history.replaceState(null, "", location.pathname + location.search);
  markCurrent();
}

async function openPage(rel: string): Promise<void> {
  await flushCommit();
  const response = await fetch(`/api/pages?rel=${encodeURIComponent(rel)}`);
  if (!response.ok) {
    showStart();
    return;
  }
  current = (await response.json()) as Doc;
  const brief = isBrief(current);
  start.hidden = true;
  form.hidden = false;
  kennung.textContent = brief ? `Newsletter ${current.nummer ?? ""}` : current.art === "recht" ? "Rechtliches" : "Seite";
  titelInput.placeholder = brief ? "Thema, z. B. Revision des Erbrechts" : "Titel";
  titelInput.value = brief ? thema(current.titel) : current.titel;
  fitTitel();
  datumFeld.hidden = !brief;
  datumInput.value = current.datum;
  fassungenGruppe.open = false;
  setSaved("");
  renderStand();
  history.replaceState(null, "", `#${current.rel}`);
  renderBriefe();
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
    setSaved("Nicht gespeichert. Verbindung prüfen.", "fehler");
    return false;
  }
  if (current.rel === doc.rel) current = { ...current, ...doc };
  setSaved("Gespeichert ✓");
  return true;
}

/** Wartendes Speichern sofort ausführen. */
async function saveNow(): Promise<boolean> {
  if (saveTimer != null) window.clearTimeout(saveTimer);
  return save();
}

async function flushCommit(): Promise<void> {
  if (saveTimer != null) await saveNow();
  await fetch("/api/commit", { method: "POST", keepalive: true });
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
  await flushCommit();
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
    knöpfe.append(
      button("Ansehen", "leise", () => void showRevision(rel, revision)),
      button("Diese Fassung zurückholen", "leise", () => void restoreRevision(rel, revision)),
    );
    item.append(when, text, knöpfe);
    fassungen.append(item);
  }
  if (json.revisions.length === 0) {
    const item = document.createElement("li");
    item.textContent = "Noch keine früheren Fassungen.";
    fassungen.append(item);
  }
}

async function showRevision(rel: string, revision: Revision): Promise<void> {
  const params = new URLSearchParams({ rel, rev: revision.rev, path: revision.path });
  const response = await fetch(`/api/history?${params}`);
  const json = (await response.json()) as { html: string; titel: string };
  vorschau.hidden = false;
  vorschau.innerHTML = `<h3>${esc(json.titel)}</h3>${json.html}`;
  vorschau.scrollIntoView({ behavior: "smooth", block: "start" });
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
window.addEventListener("pagehide", () => void flushCommit());
window.addEventListener("beforeunload", (event) => {
  if (saveTimer != null) event.preventDefault();
});
root.querySelector("#heim")!.addEventListener("click", async () => {
  await flushCommit();
  showStart();
});
for (const element of root.querySelectorAll<HTMLButtonElement>("[data-neu]")) {
  element.addEventListener("click", () => void newBrief());
}
mehr.addEventListener("click", () => {
  sichtbar += 10;
  renderBriefe();
});

const info = (await fetch("/api/info").then((response) => response.json()).catch(() => ({}))) as { publicUrl?: string };
publicOrigin = info.publicUrl ?? "";
await loadList();
const wanted = decodeURIComponent(location.hash.slice(1));
if (wanted) await openPage(wanted);
