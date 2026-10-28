import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import zlib from "node:zlib";
import { watch } from "chokidar";
import { createServer as createVite, type ViteDevServer } from "vite";
import { parseDocument, publicPath, redirectTarget, serializeDocument, type Art, type ContentDocument } from "../content/document.ts";
import { editorOrder, loadDocuments, loadPapierkorb, PAPIERKORB } from "../content/load.ts";
import { notFoundPage } from "../design/page.ts";
import { commitIfChanged, ensureContentGit, logFile, restoreFile, showFile } from "../git/history.ts";
import { anfragenDir, contentDir, repoRoot, siteDir } from "../paths.ts";
import { buildSite, previewPage, rebuildDocuments } from "../render/build.ts";
import { publishMedia } from "../render/media.ts";
import { handleAnfrage, listAnfragen, setAnfrageStatus } from "./anfrage.ts";
import { importWord } from "./word.ts";
import { assistentBereit, clearVerlauf, handleChat, readVerlauf } from "./chat.ts";
import { aendereWunsch, listWuensche, neuerWunsch } from "./wuensche.ts";

// Lokal stehen Schlüssel wie XAI_API_KEY in .env (gitignoriert). Auf Neo setzt sie der Container.
if (process.env.NODE_ENV !== "production") {
  try {
    process.loadEnvFile(path.join(repoRoot, ".env"));
  } catch {
    // Keine .env.
  }
}

const PORT = Number(process.env.PORT ?? 4321);

/**
 * Auf Neo laufen zwei Container aus demselben Image.
 * `seite`: setzt und liefert die öffentliche Seite, nimmt Anfragen an. Schreibt als einziger nach SITE_DIR.
 * `redaktion`: Editor und API. Schreibt nur Inhalt und Fassungen; die Seite merkt die Änderung an den Dateien.
 * Ohne ROLLE (lokal) macht ein Prozess beides.
 */
const ROLLE = process.env.ROLLE ?? "beide";
if (!["seite", "redaktion", "beide"].includes(ROLLE)) throw new Error(`Unbekannte ROLLE "${ROLLE}"`);
const setztSeite = ROLLE !== "redaktion";
const hatRedaktion = ROLLE !== "seite";

/** Die öffentliche Adresse, für „Auf der Website ansehen“. Leer: derselbe Server. */
const PUBLIC_URL = (process.env.PUBLIC_URL ?? "").replace(/\/+$/, "");

/** Setzt geänderte Seiten neu, wenn dieser Prozess die Seite setzt. Sonst tut es der Container `seite`. */
async function updateSite(rels: string[]): Promise<void> {
  if (setztSeite) await rebuildDocuments(rels);
}
const ARTS: readonly Art[] = ["brief", "kapitel", "recht"];

let commitTimer: NodeJS.Timeout | null = null;
let pendingMessage = "Fassung";
const pendingFiles = new Set<string>();

function scheduleCommit(message: string, rel: string): void {
  pendingMessage = message;
  pendingFiles.add(rel);
  if (commitTimer) clearTimeout(commitTimer);
  commitTimer = setTimeout(() => {
    commitTimer = null;
    void flushPending().catch((error: unknown) => {
      console.error("Inhalts-Git:", error instanceof Error ? error.message : error);
    });
  }, 20_000);
}

async function flushPending(): Promise<string | null> {
  if (commitTimer) clearTimeout(commitTimer);
  commitTimer = null;
  const files = [...pendingFiles];
  pendingFiles.clear();
  return commitIfChanged(pendingMessage, files);
}

function commitMessage(doc: Pick<ContentDocument, "art" | "titel" | "nummer">): string {
  const titel = doc.titel.replace(/[\r\n]/g, " ").slice(0, 120);
  if (doc.art === "brief") return titel;
  if (doc.art === "recht") return `Recht: ${titel}`;
  return `Kapitel: ${titel}`;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

/** Das Thema ist der Titel ohne „Newsletter 36:“. */
function thema(titel: string): string {
  return titel.replace(/^Newsletter\s+\d+\s*:?\s*/i, "").trim();
}

async function readDoc(rel: string): Promise<ContentDocument> {
  return parseDocument(await fs.readFile(path.join(contentDir(), rel), "utf8"), rel);
}

async function writeDoc(doc: ContentDocument): Promise<void> {
  const file = path.join(contentDir(), doc.rel);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, serializeDocument(doc), "utf8");
}

/** Der Anfang des Textes ohne Markdown, für die Übersicht der Newsletter. */
function auszug(body: string): string {
  const text = body
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+.*$/gm, " ")
    .replace(/[*_>`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > 220 ? `${text.slice(0, 220).replace(/\s+\S*$/, "")} …` : text;
}

function summary(doc: ContentDocument) {
  return {
    auszug: doc.art === "brief" ? auszug(doc.body) : "",
    rel: doc.rel,
    titel: doc.titel,
    art: doc.art,
    datum: doc.datum,
    nummer: doc.nummer,
    entwurf: doc.entwurf,
    href: publicPath(doc.rel),
  };
}

/** Die Startseite bleibt immer online. */
const STARTSEITE = "kapitel/willkommen.md";

async function exists(rel: string): Promise<boolean> {
  return fs.stat(path.join(contentDir(), rel)).then(() => true, () => false);
}

/** Der Pfad selbst, wenn er frei ist, sonst mit -2, -3 … */
async function freeRel(rel: string): Promise<string> {
  if (!(await exists(rel))) return rel;
  const stem = rel.slice(0, -".md".length);
  for (let i = 2; ; i += 1) {
    const next = `${stem}-${i}.md`;
    if (!(await exists(next))) return next;
  }
}

/** Auch Newsletter im Papierkorb zählen, sonst bekäme ein neuer ihre Nummer. */
async function nextNummer(): Promise<number> {
  const docs = [...(await loadDocuments()), ...(await loadPapierkorb())];
  return Math.max(0, ...docs.filter((doc) => doc.art === "brief").map((doc) => doc.nummer ?? 0)) + 1;
}

function briefRel(nummer: number): string {
  return `briefe/${String(nummer).padStart(4, "0")}-newsletter-${nummer}.md`;
}

function trashRel(value: string): string {
  const rel = path.posix.normalize(String(value));
  if (!rel.startsWith(`${PAPIERKORB}/`)) throw new Error("Nicht im Papierkorb");
  safeRel(rel.slice(PAPIERKORB.length + 1));
  return rel;
}

function safeRel(value: string): string {
  const rel = path.normalize(value).replaceAll("\\", "/").replace(/^\.\//, "");
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel) || !rel.endsWith(".md")) {
    throw new Error("Ungültiger Pfad");
  }
  if (!rel.startsWith("briefe/") && !rel.startsWith("kapitel/") && !rel.startsWith("recht/")) {
    throw new Error("Ungültiger Ordner");
  }
  return rel;
}

async function readBody(req: http.IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

function sendJson(res: http.ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(body);
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".woff2": "font/woff2",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".xml": "application/xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".ico": "image/x-icon",
};

/** Text lohnt sich zu packen, Bilder und Schriften sind es schon. */
const PACKBAR = new Set([".html", ".css", ".js", ".xml", ".txt", ".svg"]);

/**
 * Wie lange der Browser eine Datei behalten darf. Schriften ändern ihren Namen nie,
 * Bilder selten. HTML, CSS und JS fragen jedes Mal nach, sonst sieht man Änderungen erst spät.
 */
function cacheControl(urlPath: string): string {
  if (urlPath.startsWith("/fonts/")) return "public, max-age=31536000, immutable";
  if (urlPath.startsWith("/media/") || urlPath.startsWith("/brand/")) return "public, max-age=604800";
  return "no-cache";
}

function send(req: http.IncomingMessage, res: http.ServerResponse, file: string, data: Buffer, urlPath: string): void {
  const ext = path.extname(file).toLowerCase();
  const headers: http.OutgoingHttpHeaders = {
    "content-type": MIME[ext] ?? "application/octet-stream",
    "cache-control": cacheControl(urlPath),
  };
  if (PACKBAR.has(ext)) {
    headers.vary = "Accept-Encoding";
    if (/\bgzip\b/.test(String(req.headers["accept-encoding"] ?? "")) && data.length > 1024) {
      headers["content-encoding"] = "gzip";
      data = zlib.gzipSync(data);
    }
  }
  res.writeHead(200, headers);
  res.end(data);
}

/**
 * Bilder aus WordPress, z.B. /wp-content/uploads/2021/05/Logo.png, liegen jetzt unter /media/.
 * Google kennt die alten Adressen noch.
 */
async function wordpressMedia(pathname: string): Promise<string | null> {
  const match = /^\/wp-content\/uploads\/(?:.*\/)?([^/]+)$/.exec(pathname);
  if (!match) return null;
  let name = match[1];
  try {
    name = decodeURIComponent(name);
  } catch {
    return null;
  }
  name = name.replace(/[^A-Za-z0-9._-]+/g, "-");
  const found = await fs.stat(path.join(siteDir(), "media", name)).then((stat) => stat.isFile(), () => false);
  return found ? `/media/${name}` : null;
}

async function serveStatic(req: http.IncomingMessage, urlPath: string, res: http.ServerResponse): Promise<boolean> {
  const decoded = decodeURIComponent(urlPath.split("?")[0] ?? "/");
  if (decoded.includes("\0") || decoded.split("/").includes("..")) return false;
  let file = path.join(siteDir(), decoded);
  const stat = await fs.stat(file).catch(() => null);
  if (stat?.isDirectory() || !path.extname(decoded)) {
    file = path.join(file, "index.html");
  }
  // Ein frisch hochgeladenes Bild liegt im Inhalt, bevor die Seite es kopiert hat.
  const fallback = decoded.startsWith("/media/") ? path.join(contentDir(), decoded) : null;
  for (const candidate of fallback ? [file, fallback] : [file]) {
    try {
      const data = await fs.readFile(candidate);
      send(req, res, candidate, data, decoded);
      return true;
    } catch {
      // Nächster Ort.
    }
  }
  return false;
}

function editorHtml(): string {
  return `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Redaktion · Advocat Finanz</title>
</head>
<body>
  <div id="redaktion"></div>
  <script type="module" src="/src/editor/main.ts"></script>
</body>
</html>`;
}

async function handleApi(req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<void> {
  if (req.method === "GET" && url.pathname === "/api/pages") {
    const rel = url.searchParams.get("rel");
    if (!rel) {
      const docs = await loadDocuments();
      sendJson(res, 200, { pages: editorOrder(docs).map(summary) });
      return;
    }
    const doc = await readDoc(safeRel(rel));
    sendJson(res, 200, { ...doc, href: publicPath(doc.rel) });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/papierkorb") {
    const docs = await loadPapierkorb();
    docs.sort((a, b) => a.titel.localeCompare(b.titel, "de"));
    sendJson(res, 200, { pages: docs.map(summary) });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/anfragen") {
    // Personendaten: nie zwischenspeichern.
    res.setHeader("cache-control", "no-store");
    sendJson(res, 200, { anfragen: await listAnfragen() });
    return;
  }

  if (req.method === "PUT" && url.pathname === "/api/anfragen") {
    const payload = JSON.parse((await readBody(req)).toString("utf8")) as { id?: string; status?: string };
    await setAnfrageStatus(String(payload.id ?? ""), String(payload.status ?? ""));
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/info") {
    sendJson(res, 200, { publicUrl: PUBLIC_URL, assistent: assistentBereit() });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/chat") {
    res.setHeader("cache-control", "no-store");
    sendJson(res, 200, { verlauf: await readVerlauf() });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/chat") {
    await handleChat(JSON.parse((await readBody(req)).toString("utf8")), res);
    return;
  }

  if (req.method === "DELETE" && url.pathname === "/api/chat") {
    await clearVerlauf();
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/wuensche") {
    res.setHeader("cache-control", "no-store");
    sendJson(res, 200, { wuensche: await listWuensche() });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/wuensche") {
    sendJson(res, 200, await neuerWunsch(JSON.parse((await readBody(req)).toString("utf8"))));
    return;
  }

  if (req.method === "PUT" && url.pathname === "/api/wuensche") {
    sendJson(res, 200, await aendereWunsch(JSON.parse((await readBody(req)).toString("utf8"))));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/preview") {
    const doc = await readDoc(safeRel(url.searchParams.get("rel") ?? ""));
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(await previewPage(doc));
    return;
  }

  if (req.method === "PUT" && url.pathname === "/api/pages") {
    const payload = JSON.parse((await readBody(req)).toString("utf8")) as ContentDocument;
    const rel = safeRel(payload.rel);
    if (!ARTS.includes(payload.art)) throw new Error("Unbekannte Art");
    // Veröffentlichen und Zurückziehen haben eigene Wege. Ein spätes Speichern ändert den Stand nie.
    const before = await readDoc(rel).catch(() => null);
    const doc: ContentDocument = {
      rel,
      art: payload.art,
      titel: String(payload.titel ?? "").trim() || "Ohne Titel",
      datum: String(payload.datum ?? ""),
      nummer: payload.nummer == null || payload.nummer === ("" as unknown) ? null : Number(payload.nummer),
      entwurf: before?.entwurf ?? false,
      body: String(payload.body ?? ""),
    };
    if (doc.nummer != null && !Number.isFinite(doc.nummer)) doc.nummer = null;
    // Online hängt die Adresse an der Nummer. Ändern geht nur im Entwurf.
    if (before && !before.entwurf) doc.nummer = before.nummer;
    await writeDoc(doc);
    await updateSite([rel]);
    scheduleCommit(commitMessage(doc), rel);
    console.log(`schreibt ${rel}`);
    sendJson(res, 200, { ok: true, message: commitMessage(doc) });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/briefs") {
    const nummer = await nextNummer();
    // Der Dateiname bekommt das Thema erst beim Veröffentlichen.
    const doc: ContentDocument = {
      rel: await freeRel(briefRel(nummer)),
      art: "brief",
      titel: `Newsletter ${nummer}`,
      datum: new Date().toISOString().slice(0, 10),
      nummer,
      entwurf: true,
      body: "",
    };
    await writeDoc(doc);
    scheduleCommit(`Entwurf: Newsletter ${nummer}`, doc.rel);
    console.log(`neuer Entwurf ${doc.rel}`);
    sendJson(res, 200, { ...doc, href: publicPath(doc.rel) });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/copy") {
    const payload = JSON.parse((await readBody(req)).toString("utf8")) as { rel?: string };
    await flushPending();
    const source = await readDoc(safeRel(payload.rel ?? ""));
    let doc: ContentDocument;
    if (source.art === "brief") {
      const nummer = await nextNummer();
      const text = thema(source.titel);
      doc = {
        ...source,
        rel: await freeRel(briefRel(nummer)),
        nummer,
        titel: text ? `Newsletter ${nummer}: ${text}` : `Newsletter ${nummer}`,
        datum: new Date().toISOString().slice(0, 10),
        entwurf: true,
      };
    } else {
      // Die Kopie einer Kopie heisst nicht „-kopie-kopie“, sondern „-kopie-2“.
      const stem = path.posix.basename(source.rel, ".md").replace(/-kopie(-\d+)?$/, "");
      doc = {
        ...source,
        rel: await freeRel(`${path.posix.dirname(source.rel)}/${stem}-kopie.md`),
        titel: `${source.titel.replace(/\s*\(Kopie\)$/, "")} (Kopie)`,
        entwurf: true,
      };
    }
    await writeDoc(doc);
    await commitIfChanged(`Kopie: ${doc.titel}`, [doc.rel]);
    console.log(`kopiert ${source.rel} nach ${doc.rel}`);
    sendJson(res, 200, { ...doc, href: publicPath(doc.rel) });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/publish") {
    const payload = JSON.parse((await readBody(req)).toString("utf8")) as { rel?: string };
    const oldRel = safeRel(payload.rel ?? "");
    await flushPending();
    const doc = await readDoc(oldRel);
    if (doc.art === "brief" && !thema(doc.titel)) throw new Error("Bitte zuerst ein Thema eingeben.");
    if (doc.art === "brief") {
      const doppelt = (await loadDocuments()).find(
        (other) => other.art === "brief" && !other.entwurf && other.rel !== oldRel && other.nummer === doc.nummer,
      );
      if (doppelt) throw new Error(`Nr. ${doc.nummer} ist schon online: ${doppelt.titel}. Bitte eine andere Nummer wählen.`);
    }
    let rel = oldRel;
    const stem = `${String(doc.nummer ?? 0).padStart(4, "0")}-newsletter-${doc.nummer}`;
    const slug = slugify(thema(doc.titel));
    // Ein Entwurf heisst noch „0039-newsletter-39“. Wurde die Nummer geändert, stimmt die alte Zahl im Namen nicht mehr.
    if (doc.art === "brief" && /^\d{4}-newsletter-\d+$/.test(path.posix.basename(oldRel, ".md")) && slug) {
      const next = `briefe/${stem}-${slug}.md`;
      const taken = await fs.stat(path.join(contentDir(), next)).then(() => true, () => false);
      if (!taken) rel = next;
    }
    const published: ContentDocument = { ...doc, rel, entwurf: false };
    await writeDoc(published);
    if (rel !== oldRel) await fs.rm(path.join(contentDir(), oldRel), { force: true });
    await updateSite([oldRel, rel]);
    await commitIfChanged(`Veröffentlicht: ${published.titel}`, [oldRel, rel]);
    console.log(`veröffentlicht ${rel}`);
    sendJson(res, 200, { ...published, href: publicPath(rel) });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/unpublish") {
    const payload = JSON.parse((await readBody(req)).toString("utf8")) as { rel?: string };
    const rel = safeRel(payload.rel ?? "");
    if (rel === STARTSEITE) throw new Error("Die Startseite bleibt online.");
    await flushPending();
    const doc: ContentDocument = { ...(await readDoc(rel)), entwurf: true };
    await writeDoc(doc);
    await updateSite([rel]);
    await commitIfChanged(`Zurückgezogen: ${doc.titel}`, [rel]);
    console.log(`zurückgezogen ${rel}`);
    sendJson(res, 200, { ...doc, href: publicPath(rel) });
    return;
  }

  if (req.method === "DELETE" && url.pathname === "/api/pages") {
    const rel = safeRel(url.searchParams.get("rel") ?? "");
    const doc = await readDoc(rel);
    if (!doc.entwurf) throw new Error("Nur Entwürfe lassen sich löschen. Bitte zuerst zurückziehen.");
    // Nicht endgültig: die Datei wandert in den Papierkorb und lässt sich zurückholen.
    await flushPending();
    const ziel = await freeRel(`${PAPIERKORB}/${rel}`);
    await fs.mkdir(path.dirname(path.join(contentDir(), ziel)), { recursive: true });
    await fs.rename(path.join(contentDir(), rel), path.join(contentDir(), ziel));
    await commitIfChanged(`In den Papierkorb: ${doc.titel}`, [rel, ziel]);
    console.log(`Papierkorb ${rel}`);
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/zurueckholen") {
    const payload = JSON.parse((await readBody(req)).toString("utf8")) as { rel?: string };
    const from = trashRel(payload.rel ?? "");
    const original = from.slice(PAPIERKORB.length + 1);
    const raw = await fs.readFile(path.join(contentDir(), from), "utf8");
    // Zurück kommt sie als Entwurf. Veröffentlichen ist ein eigener Schritt.
    const doc: ContentDocument = { ...parseDocument(raw, original), rel: await freeRel(original), entwurf: true };
    await writeDoc(doc);
    await fs.rm(path.join(contentDir(), from), { force: true });
    await commitIfChanged(`Zurückgeholt: ${doc.titel}`, [from, doc.rel]);
    console.log(`zurückgeholt ${doc.rel}`);
    sendJson(res, 200, { ...doc, href: publicPath(doc.rel) });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/media") {
    const nameHeader = req.headers["x-filename"];
    const original = (Array.isArray(nameHeader) ? nameHeader[0] : nameHeader) ?? "bild.bin";
    const ext = path.extname(original).toLowerCase().replace(/[^.a-z0-9]/g, "");
    if (![".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"].includes(ext)) {
      throw new Error("Nur Bilder");
    }
    const stem = path
      .basename(original, path.extname(original))
      .replace(/[^A-Za-z0-9._-]+/g, "-")
      .slice(0, 40) || "bild";
    const name = `${stem}-${Date.now().toString(36)}${ext}`;
    const bytes = await readBody(req);
    if (bytes.length > 20 * 1024 * 1024) throw new Error("Bild ist zu gross");
    const media = path.join(contentDir(), "media", name);
    await fs.mkdir(path.dirname(media), { recursive: true });
    await fs.writeFile(media, bytes);
    if (setztSeite) await copyMediaFile(media);
    pendingFiles.add(`media/${name}`);
    sendJson(res, 200, { url: `../media/${name}` });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/import") {
    const rel = safeRel(url.searchParams.get("rel") ?? "");
    if (!(await readDoc(rel)).entwurf) throw new Error("Word-Dateien lassen sich nur in einen Entwurf importieren.");
    const bytes = await readBody(req);
    if (bytes.length > 30 * 1024 * 1024) throw new Error("Die Word-Datei ist zu gross (höchstens 30 MB).");
    // .docx ist ein Zip. Alte .doc-Dateien beginnen anders und kann mammoth nicht lesen.
    if (bytes.subarray(0, 2).toString("latin1") !== "PK") {
      throw new Error("Das ist keine .docx-Datei. Bitte in Word als «Word-Dokument (.docx)» speichern.");
    }
    const ergebnis = await importWord(bytes);
    for (const bild of ergebnis.bilder) {
      if (setztSeite) await copyMediaFile(path.join(contentDir(), bild));
      pendingFiles.add(bild);
    }
    console.log(`Word-Import in ${rel}: ${ergebnis.bilder.length} Bilder`);
    sendJson(res, 200, ergebnis);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/history") {
    const rel = safeRel(url.searchParams.get("rel") ?? "");
    const rev = url.searchParams.get("rev");
    if (!rev) {
      sendJson(res, 200, { revisions: await logFile(rel) });
      return;
    }
    const from = safeRel(url.searchParams.get("path") ?? rel);
    const raw = await showFile(from, rev);
    const doc = parseDocument(raw, from);
    const { markdownToHtml } = await import("../render/crepe.ts");
    const { publishHtml } = await import("../render/build.ts");
    sendJson(res, 200, { body: doc.body, html: publishHtml(await markdownToHtml(doc.body)), titel: doc.titel });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/restore") {
    const payload = JSON.parse((await readBody(req)).toString("utf8")) as { rel?: string; rev?: string; path?: string };
    const rel = safeRel(payload.rel ?? "");
    const from = safeRel(payload.path ?? rel);
    const rev = payload.rev ?? "";
    await flushPending();
    const before = await readDoc(rel);
    await restoreFile(rel, rev, from);
    // Nur der Text kommt zurück. Ob die Seite online ist, bleibt, wie es war.
    const doc: ContentDocument = { ...(await readDoc(rel)), rel, entwurf: before.entwurf };
    await writeDoc(doc);
    await updateSite([rel]);
    const message = `Wiederhergestellt: ${doc.titel}`;
    await commitIfChanged(message, [rel]);
    console.log(`wiederhergestellt ${rel} aus ${rev.slice(0, 7)}`);
    sendJson(res, 200, { ok: true, doc });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/commit") {
    const sha = await flushPending();
    sendJson(res, 200, { sha });
    return;
  }

  sendJson(res, 404, { error: "Nicht gefunden" });
}

function vitePath(urlPath: string): boolean {
  return (
    urlPath.startsWith("/src/") ||
    urlPath.startsWith("/@") ||
    urlPath.startsWith("/node_modules/") ||
    urlPath.startsWith("/__vite")
  );
}

const editorDist = path.join(repoRoot, "dist/redaktion");
const productionEditor = process.env.NODE_ENV === "production";

function inside(root: string, file: string): boolean {
  const rel = path.relative(root, file);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

/** `index.html` für den Einstieg, sonst ein Pfad unter `assets/`. */
async function serveEditor(rel: string, res: http.ServerResponse): Promise<boolean> {
  if (!productionEditor) return false;
  if (rel !== "index.html" && !rel.startsWith("assets/")) return false;
  const file = path.join(editorDist, rel);
  if (!inside(editorDist, file)) return false;
  try {
    const data = await fs.readFile(file);
    res.writeHead(200, { "content-type": MIME[path.extname(file)] ?? "application/octet-stream" });
    res.end(data);
    return true;
  } catch {
    return false;
  }
}

async function copyMediaFile(file: string): Promise<void> {
  const rel = path.relative(contentDir(), file).replaceAll("\\", "/");
  if (!rel.startsWith("media/") || rel.includes("..")) return;
  await publishMedia(file, path.join(siteDir(), rel));
}

function watchContent(): void {
  watch(contentDir(), {
    ignoreInitial: true,
    // Bind-Mounts auf dem Neo-Volume melden inotify oft nicht. Polling sieht die Datei trotzdem.
    usePolling: true,
    interval: 300,
    ignored: /(^|[/\\])\.git([/\\]|$)/,
    awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 100 },
  }).on("error", (error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
  }).on("all", (event, file) => {
    const rel = path.relative(contentDir(), file).replaceAll("\\", "/");
    if (rel.startsWith("media/") && (event === "add" || event === "change")) {
      void copyMediaFile(file).catch((error: unknown) => {
        console.error(error instanceof Error ? error.message : error);
      });
      return;
    }
    if (!rel.endsWith(".md") || rel.includes("..")) return;
    if (!rel.startsWith("briefe/") && !rel.startsWith("kapitel/") && !rel.startsWith("recht/")) return;
    console.log(`setzt ${rel}`);
    void rebuildDocuments([rel]).catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
    });
  });
}

async function main(): Promise<void> {
  console.log(`Rolle: ${ROLLE}`);
  if (hatRedaktion) await ensureContentGit();
  if (setztSeite) {
    // Immer neu setzen: nach einem Code-Update passt altes HTML nicht zum neuen heft.css.
    console.log("Setze die Seiten …");
    const built = await buildSite();
    console.log(`${built.pages} Seiten gesetzt.`);
  }

  const vite: ViteDevServer | null = productionEditor
    ? null
    : await createVite({
        root: repoRoot,
        appType: "custom",
        server: {
          middlewareMode: true,
          watch: { ignored: ["**/site/**", "**/dev-content/**", "**/dist/**"] },
        },
      });
  const server = http.createServer((req, res) => {
    const host = req.headers.host ?? "";
    const url = new URL(req.url ?? "/", `http://${host || "localhost"}`);
    // Der Container `redaktion` hat nur den einen Namen, dort ist die Redaktion immer die Wurzel.
    const aufRedaktion = ROLLE === "redaktion" || host.startsWith("redaktion.");
    const unterRedaktion = url.pathname === "/redaktion" || url.pathname === "/redaktion/";
    // Die Redaktion, ihre Vorschau und die API gehören nicht in den Suchindex.
    if (aufRedaktion || unterRedaktion || url.pathname.startsWith("/api/") || url.pathname.startsWith("/assets/")) {
      res.setHeader("x-robots-tag", "noindex, nofollow");
    }
    // Auf redaktion.<domain> ist die Redaktion die Wurzel. Lokal gibt es nur einen Namen, dort bleibt /redaktion.
    if (aufRedaktion && unterRedaktion) {
      res.writeHead(301, { location: "/" + url.search });
      res.end();
      return;
    }
    if (vite && vitePath(url.pathname)) {
      vite.middlewares(req, res, () => {
        res.statusCode = 404;
        res.end();
      });
      return;
    }
    const einstieg = aufRedaktion ? url.pathname === "/" : unterRedaktion;
    if (!hatRedaktion && (einstieg || url.pathname.startsWith("/assets/") || url.pathname.startsWith("/api/"))) {
      res.writeHead(404, { "content-type": "text/html; charset=utf-8" });
      res.end(notFoundPage());
      return;
    }
    if (einstieg || url.pathname.startsWith("/assets/")) {
      if (productionEditor) {
        void serveEditor(einstieg ? "index.html" : url.pathname.slice(1), res).then((ok) => {
          if (!ok && !res.headersSent) {
            res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
            res.end("Redaktion ist nicht gebaut.");
          }
        });
        return;
      }
      if (einstieg) {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(editorHtml());
        return;
      }
    }
    if (url.pathname.startsWith("/api/")) {
      void handleApi(req, res, url).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "Fehler";
        console.error(`${req.method} ${url.pathname}: ${message}`);
        if (!res.headersSent) sendJson(res, 400, { error: message });
      });
      return;
    }
    if (setztSeite && req.method === "POST" && (url.pathname === "/kontakt" || url.pathname === "/kontakt/")) {
      void handleAnfrage(req, res).catch((error: unknown) => {
        console.error("Anfrage:", error instanceof Error ? error.message : error);
        if (!res.headersSent) sendJson(res, 500, { error: "Fehler" });
      });
      return;
    }
    const target = redirectTarget(url.pathname);
    if (target) {
      res.writeHead(301, { location: target + url.search });
      res.end();
      return;
    }
    // Eine Adresse pro Seite: /angebot/ (so hiess es unter WordPress) springt auf /angebot.
    if ((req.method === "GET" || req.method === "HEAD") && /.\/+$/.test(url.pathname)) {
      res.writeHead(301, { location: url.pathname.replace(/\/+$/, "") + url.search });
      res.end();
      return;
    }
    if (url.pathname.startsWith("/wp-content/")) {
      void wordpressMedia(url.pathname).then((media) => {
        if (media) {
          res.writeHead(301, { location: media });
        } else {
          res.writeHead(404, { "content-type": "text/html; charset=utf-8" });
        }
        res.end(media ? undefined : notFoundPage());
      });
      return;
    }
    void serveStatic(req, url.pathname, res).then((ok) => {
      if (!ok && !res.headersSent) {
        res.writeHead(404, { "content-type": "text/html; charset=utf-8" });
        res.end(notFoundPage());
      }
    });
  });

  if (setztSeite) watchContent();

  server.listen(PORT, () => {
    if (setztSeite) console.log(`Heft auf http://127.0.0.1:${PORT}`);
    if (hatRedaktion) console.log(`Redaktion auf http://127.0.0.1:${PORT}${ROLLE === "redaktion" ? "/" : "/redaktion"}`);
    if (hatRedaktion && !assistentBereit()) console.log("Assistent aus: XAI_API_KEY fehlt.");
    if (!setztSeite) return;
    console.log(`Anfragen nach ${anfragenDir()}`);
    if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) {
      console.log("Telegram aus: TELEGRAM_BOT_TOKEN und TELEGRAM_CHAT_ID fehlen.");
    }
  });
}

await main();
