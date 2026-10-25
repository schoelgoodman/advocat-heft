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
  };
}

const Crepe = (crepeModule as unknown as { Crepe: CrepeCtor }).Crepe;

interface PageSummary {
  rel: string;
  titel: string;
  art: Art;
  datum: string;
  nummer: number | null;
}

const root = document.querySelector<HTMLElement>("#redaktion");
if (!root) throw new Error("Redaktion fehlt");

let crepe: CrepeEditor | null = null;
let current: ContentDocument | null = null;
let saveTimer: number | null = null;
let armed = false;

root.innerHTML = `
  <div class="redaktion">
    <aside>
      <p class="wort">Redaktion</p>
      <button type="button" id="neu">Neue Ausgabe</button>
      <nav id="liste"></nav>
      <section>
        <h2>Frühere Fassungen</h2>
        <ol id="fassungen"></ol>
        <article id="vorschau" hidden></article>
      </section>
    </aside>
    <form id="blatt">
      <p class="status" id="status">Wählen Sie eine Seite.</p>
      <label>Titel <input name="titel" required></label>
      <div class="felder">
        <label>Datum <input name="datum" placeholder="2026-10-01"></label>
        <label>Nummer <input name="nummer" inputmode="numeric"></label>
        <label>Art
          <select name="art">
            <option value="brief">Brief</option>
            <option value="kapitel">Kapitel</option>
            <option value="recht">Recht</option>
          </select>
        </label>
      </div>
      <div id="editor"></div>
    </form>
  </div>
`;

const liste = root.querySelector<HTMLElement>("#liste")!;
const status = root.querySelector<HTMLElement>("#status")!;
const form = root.querySelector<HTMLFormElement>("#blatt")!;
const editorHost = root.querySelector<HTMLElement>("#editor")!;
const fassungen = root.querySelector<HTMLOListElement>("#fassungen")!;
const vorschau = root.querySelector<HTMLElement>("#vorschau")!;

function field(name: string): HTMLInputElement | HTMLSelectElement {
  const element = form.elements.namedItem(name);
  if (!(element instanceof HTMLInputElement) && !(element instanceof HTMLSelectElement)) {
    throw new Error(name);
  }
  return element;
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
      [Crepe.Feature.Toolbar]: { linkLabel: "Link" },
      [Crepe.Feature.ImageBlock]: { onUpload: uploadImage },
      [Crepe.Feature.BlockEdit]: {
        textGroup: {
          label: "Text",
          text: null,
          h1: { label: "Abschnitt" },
          h2: { label: "Abschnitt" },
          h3: { label: "Unterabschnitt" },
          h4: null,
          h5: null,
          h6: null,
          quote: { label: "Zitat" },
          divider: null,
        },
        listGroup: {
          label: "Liste",
          bulletList: { label: "Liste" },
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
  if (current && currentRelMatches(markdown)) {
    current = { ...current, body: forFile(next.getMarkdown()).trim() };
  }
  armed = true;
}

function currentRelMatches(markdown: string): boolean {
  return current != null && current.body.trim() === markdown.trim();
}

async function loadList(selectRel?: string): Promise<void> {
  const response = await fetch("/api/pages");
  const json = (await response.json()) as { pages: PageSummary[] };
  liste.replaceChildren();
  for (const page of json.pages) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = page.titel;
    button.dataset.rel = page.rel;
    if (page.rel === selectRel) button.setAttribute("aria-current", "true");
    button.addEventListener("click", () => void openPage(page.rel));
    liste.append(button);
  }
}

function collect(): ContentDocument {
  if (!current || !crepe) throw new Error("Keine Seite");
  const nummerRaw = field("nummer").value.trim();
  return {
    rel: current.rel,
    titel: field("titel").value.trim() || current.titel,
    datum: field("datum").value.trim(),
    art: field("art").value as Art,
    nummer: nummerRaw ? Number(nummerRaw) : null,
    body: forFile(crepe.getMarkdown()).trim(),
  };
}

function same(a: ContentDocument, b: ContentDocument): boolean {
  return (
    a.titel === b.titel &&
    a.datum === b.datum &&
    a.art === b.art &&
    a.nummer === b.nummer &&
    a.body.trim() === b.body.trim()
  );
}

async function openPage(rel: string): Promise<void> {
  await flushCommit();
  const response = await fetch(`/api/pages?rel=${encodeURIComponent(rel)}`);
  current = (await response.json()) as ContentDocument;
  field("titel").value = current.titel;
  field("datum").value = current.datum;
  field("nummer").value = current.nummer == null ? "" : String(current.nummer);
  field("art").value = current.art;
  status.textContent = current.rel;
  await mountEditor(current.body);
  await loadHistory(rel);
  for (const button of liste.querySelectorAll("button")) {
    button.toggleAttribute("aria-current", button.dataset.rel === rel);
  }
}

function scheduleSave(): void {
  if (!armed) return;
  if (saveTimer != null) window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => void save(), 600);
}

async function save(): Promise<void> {
  if (!current || !crepe) return;
  const doc = collect();
  if (same(doc, current)) {
    status.textContent = current.rel;
    return;
  }
  status.textContent = "Speichert …";
  const response = await fetch("/api/pages", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(doc),
  });
  if (!response.ok) {
    status.textContent = "Speichern fehlgeschlagen";
    return;
  }
  current = doc;
  status.textContent = "Gespeichert. Die Fassung folgt nach einer kurzen Pause.";
}

async function flushCommit(): Promise<void> {
  if (saveTimer != null) {
    window.clearTimeout(saveTimer);
    saveTimer = null;
    await save();
  }
  await fetch("/api/commit", { method: "POST", keepalive: true });
}

async function loadHistory(rel: string): Promise<void> {
  vorschau.hidden = true;
  fassungen.replaceChildren();
  const response = await fetch(`/api/history?rel=${encodeURIComponent(rel)}`);
  const json = (await response.json()) as { revisions: { rev: string; date: string; message: string }[] };
  for (const revision of json.revisions) {
    const item = document.createElement("li");
    const when = document.createElement("time");
    when.dateTime = revision.date;
    when.textContent = revision.date.slice(0, 16).replace("T", " ");
    const text = document.createElement("span");
    text.textContent = revision.message;
    const preview = document.createElement("button");
    preview.type = "button";
    preview.textContent = "Ansehen";
    preview.addEventListener("click", () => void showRevision(rel, revision.rev));
    const restoreButton = document.createElement("button");
    restoreButton.type = "button";
    restoreButton.textContent = "Herstellen";
    restoreButton.addEventListener("click", () => void restoreRevision(rel, revision.rev));
    item.append(when, text, preview, restoreButton);
    fassungen.append(item);
  }
}

async function showRevision(rel: string, rev: string): Promise<void> {
  const response = await fetch(`/api/history?rel=${encodeURIComponent(rel)}&rev=${encodeURIComponent(rev)}`);
  const json = (await response.json()) as { html: string; titel: string };
  vorschau.hidden = false;
  vorschau.innerHTML = `<h3>${esc(json.titel)}</h3>${json.html}`;
}

async function restoreRevision(rel: string, rev: string): Promise<void> {
  const response = await fetch("/api/restore", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ rel, rev }),
  });
  if (!response.ok) {
    status.textContent = "Wiederherstellen fehlgeschlagen";
    return;
  }
  await openPage(rel);
  status.textContent = "Fassung wiederhergestellt.";
}

form.addEventListener("input", () => scheduleSave());
window.addEventListener("pagehide", () => void flushCommit());

root.querySelector<HTMLButtonElement>("#neu")!.addEventListener("click", async () => {
  const titel = window.prompt("Titel der neuen Ausgabe") ?? "";
  if (!titel.trim()) return;
  await flushCommit();
  const response = await fetch("/api/briefs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ titel }),
  });
  if (!response.ok) {
    status.textContent = "Neue Ausgabe fehlgeschlagen";
    return;
  }
  const doc = (await response.json()) as ContentDocument;
  await loadList(doc.rel);
  await openPage(doc.rel);
});

await loadList();
