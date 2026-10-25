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

root.innerHTML = `
  <div class="redaktion">
    <aside>
      <p class="wort">Redaktion</p>
      <button type="button" class="haupt" data-neu>+ Neuer Newsletter</button>
      <h2>Newsletter</h2>
      <nav id="briefe"></nav>
      <details id="seiten-gruppe">
        <summary>Übrige Seiten</summary>
        <nav id="seiten"></nav>
      </details>
    </aside>
    <main>
      <section id="start">
        <h1>Guten Tag.</h1>
        <p>Was möchten Sie tun?</p>
        <button type="button" class="haupt gross" data-neu>Neuen Newsletter schreiben</button>
        <p class="leise">Oder links einen Newsletter zum Bearbeiten wählen.</p>
        <ol class="schritte">
          <li><strong>Thema</strong> eingeben</li>
          <li><strong>Text</strong> schreiben. Er wird laufend gespeichert.</li>
          <li><strong>Vorschau</strong> ansehen, dann <strong>Veröffentlichen</strong>.</li>
        </ol>
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
const seitenGruppe = root.querySelector<HTMLDetailsElement>("#seiten-gruppe")!;
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

function isBrief(doc: ContentDocument | null): boolean {
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

function listItem(page: PageSummary): HTMLButtonElement {
  const item = document.createElement("button");
  item.type = "button";
  item.dataset.rel = page.rel;
  if (page.art === "brief") {
    const head = document.createElement("span");
    head.className = "kopfzeile";
    head.innerHTML = page.entwurf
      ? `<span class="marke">Entwurf</span> Nr. ${page.nummer ?? ""}`
      : `Nr. ${page.nummer ?? ""} · ${esc(shortDate(page.datum))}`;
    const text = document.createElement("span");
    text.className = "thema";
    text.textContent = thema(page.titel) || "Noch ohne Thema";
    item.append(head, text);
  } else {
    item.textContent = page.titel;
  }
  item.addEventListener("click", () => void openPage(page.rel));
  return item;
}

async function loadList(): Promise<void> {
  const response = await fetch("/api/pages");
  const json = (await response.json()) as { pages: PageSummary[] };
  briefe.replaceChildren(...json.pages.filter((page) => page.art === "brief").map(listItem));
  seiten.replaceChildren(...json.pages.filter((page) => page.art !== "brief").map(listItem));
  markCurrent();
}

function markCurrent(): void {
  for (const item of root!.querySelectorAll<HTMLButtonElement>("nav button")) {
    item.toggleAttribute("aria-current", item.dataset.rel === current?.rel);
  }
  if (current && !isBrief(current)) seitenGruppe.open = true;
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
      button("Entwurf löschen", "leise", () => void deleteDraft()),
      button("Vorschau", "", () => void openPreview()),
      button("Veröffentlichen", "haupt", () => void publish()),
    );
    return;
  }
  stand.innerHTML = `<span class="marke online">Online</span> Änderungen erscheinen sofort auf der Website.`;
  if (isBrief(doc)) aktionen.append(button("Zurückziehen", "leise", () => void unpublish()));
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
  markCurrent();
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

async function publish(): Promise<void> {
  if (!current) return;
  if (isBrief(current) && !titelInput.value.trim()) {
    titelInput.focus();
    setSaved("Bitte zuerst ein Thema eingeben.", "fehler");
    return;
  }
  if (!(await saveNow())) return;
  const titel = current.titel;
  const ja = await ask({
    titel: "Jetzt veröffentlichen?",
    text: `„${titel}“ erscheint sofort auf der Website und auf der Startseite.`,
    ja: "Veröffentlichen",
    nein: "Noch nicht",
  });
  if (!ja) return;
  setSaved("Veröffentlicht …", "busy");
  const response = await post("/api/publish", { rel: current.rel });
  if (!response.ok) {
    setSaved(await errorText(response, "Veröffentlichen fehlgeschlagen."), "fehler");
    return;
  }
  current = (await response.json()) as Doc;
  history.replaceState(null, "", `#${current.rel}`);
  renderStand();
  setSaved("Veröffentlicht ✓");
  await loadList();
  void loadHistory(current.rel);
}

async function unpublish(): Promise<void> {
  if (!current) return;
  if (!(await saveNow())) return;
  const ja = await ask({
    titel: "Von der Website nehmen?",
    text: `„${current.titel}“ verschwindet von der Website. Der Text bleibt hier als Entwurf erhalten.`,
    ja: "Zurückziehen",
    nein: "Abbrechen",
  });
  if (!ja || !current) return;
  const response = await post("/api/unpublish", { rel: current.rel });
  if (!response.ok) {
    setSaved(await errorText(response, "Zurückziehen fehlgeschlagen."), "fehler");
    return;
  }
  current = (await response.json()) as Doc;
  renderStand();
  setSaved("Zurückgezogen. Jetzt nur noch als Entwurf hier.");
  await loadList();
  void loadHistory(current.rel);
}

async function deleteDraft(): Promise<void> {
  if (!current?.entwurf) return;
  const ja = await ask({
    titel: "Entwurf löschen?",
    text: `„${current.titel}“ wird gelöscht.`,
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
for (const element of root.querySelectorAll<HTMLButtonElement>("[data-neu]")) {
  element.addEventListener("click", () => void newBrief());
}

const info = (await fetch("/api/info").then((response) => response.json()).catch(() => ({}))) as { publicUrl?: string };
publicOrigin = info.publicUrl ?? "";
await loadList();
const wanted = decodeURIComponent(location.hash.slice(1));
if (wanted) await openPage(wanted);
