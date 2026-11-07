import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import zlib from "node:zlib";
import { watch } from "chokidar";
import { createServer as createVite, type ViteDevServer } from "vite";
import {
  adresseBelegt,
  adresseReserviert,
  parseDocument,
  publicPath,
  redirectTarget,
  seiteMitNeuerAdresse,
  serializeDocument,
  standardPfad,
  textVon,
  type Art,
  type ContentDocument,
} from "../content/document.ts";
import { schreibeAtomar } from "../content/atomar.ts";
import { editorOrder, leseMenueReihe, loadDocuments, loadPapierkorb, PAPIERKORB, schreibeMenueReihe } from "../content/load.ts";
import { notFoundPage } from "../design/page.ts";
import { siteUrl } from "../design/seo.ts";
import { stelleSeitenUm } from "../content/migration.ts";
import { istFesteMenueSeite, MENUE_DATEI, MENUE_NAME_MAX, menueOrt, menueReihe } from "../content/menue.ts";
import { EINMALIG, neueSeite, pruefeFelder, VORLAGE_VON, type Felder } from "../content/seiten.ts";
import { commitIfChanged, ensureContentGit, gibtEsInFassung, holeDateiZurueck, logAlles, logFile, restoreFile, showFile } from "../git/history.ts";
import { anfragenDir, contentDir, repoRoot, siteDir } from "../paths.ts";
import { buildSite, previewPage, rebuildDocuments, textHtml } from "../render/build.ts";
import { publishMedia, pruneVariants } from "../render/media.ts";
import { AUFBEWAHRUNG_MONATE, handleAnfrage, listAnfragen, loescheAlteAnfragen, setAnfrageStatus } from "./anfrage.ts";
import { verarbeiteBild } from "./bilder.ts";
import { bilderIn, listeMedien, medienName, pruefeLoeschbar, sendeVorschau } from "./medien.ts";
import { leseStatus, schreibeStatus } from "./status.ts";
import { importWord } from "./word.ts";
import { seitenCheck, websiteCheck } from "./pruefung.ts";
import { assistentBereit, clearVerlauf, handleChat, readVerlauf } from "./chat.ts";
import { aendereWunsch, listWuensche, neuerWunsch } from "./wuensche.ts";
import { fremdeHerkunft, kanonischerHost, ohneEndSchraegstrich, schluesselPasst } from "./zugang.ts";

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

/**
 * Nur im Container `redaktion`: Jede Anfrage muss diesen Schlüssel tragen, den nginx nach tinyauth
 * mitschickt. Fehlt er hier, bleibt die Redaktion zu (503), statt ohne Anmeldung offen zu sein.
 */
const SCHLUESSEL = process.env.REDAKTION_SCHLUESSEL ?? "";

/** Die öffentliche Adresse, für „Auf der Website ansehen“. Leer: derselbe Server. */
const PUBLIC_URL = (process.env.PUBLIC_URL ?? "").replace(/\/+$/, "");

/** Wohin /eingang springt. Auf Neo redaktion.<domain>, lokal /redaktion auf demselben Server. */
const REDAKTION_URL = (process.env.REDAKTION_URL ?? "/redaktion").trim();

/** Setzt geänderte Seiten neu, wenn dieser Prozess die Seite setzt. Sonst tut es der Container `seite`. */
async function updateSite(rels: string[]): Promise<void> {
  if (setztSeite) setzeNeu(rels);
}

/** Warten, bis das Setzen fertig ist; schnelle Änderungen nacheinander werden ein Durchgang. */
let setztGerade = false;
const wartend = new Set<string>();

function setzeNeu(rels: string[]): void {
  for (const rel of rels) wartend.add(rel);
  if (setztGerade) return;
  setztGerade = true;
  void (async () => {
    while (wartend.size) {
      const dran = [...wartend];
      wartend.clear();
      try {
        await rebuildDocuments(dran);
        await schreibeStatus();
      } catch (error) {
        console.error("Setzen fehlgeschlagen, der letzte Stand bleibt online:", error instanceof Error ? error.message : error);
        await schreibeStatus(error);
      }
    }
    setztGerade = false;
  })();
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
  try {
    return await commitIfChanged(pendingMessage, files);
  } catch (error) {
    // Nicht verlieren: die Dateien kommen in die nächste Fassung.
    for (const file of files) pendingFiles.add(file);
    throw error;
  }
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

const pruefsumme = (daten: string | Buffer) => createHash("sha1").update(daten).digest("hex").slice(0, 16);

/** Der Stand einer Datei. Wer speichert, nennt den Stand, von dem er ausging. */
async function stand(rel: string): Promise<string> {
  return fs.readFile(path.join(contentDir(), rel)).then(pruefsumme, () => "");
}

/** Eine Seite für den Browser: mit Adresse und Stand. */
async function fuerBrowser(doc: ContentDocument, href = publicPath(doc.rel)) {
  return { ...doc, href, version: await stand(doc.rel) };
}

/** Fehler, die zu einem Feld gehören. Der Browser zeigt sie dort an. */
class FeldFehler extends Error {
  felder: Record<string, string>;
  constructor(felder: Record<string, string>) {
    super(felder._ ?? felder.neu ?? "Bitte die markierten Felder prüfen.");
    this.felder = felder;
  }
}

/** Jede Datei in den Feldern muss es geben, sonst fehlt das Bild auf der Website. */
async function pruefeBilderDa(felder: Felder): Promise<void> {
  const fehler: Record<string, string> = {};
  const gehe = async (wert: unknown, pfad: string): Promise<void> => {
    if (Array.isArray(wert)) for (const [i, x] of wert.entries()) await gehe(x, pfad ? `${pfad}.${i}` : String(i));
    else if (wert && typeof wert === "object") for (const [name, x] of Object.entries(wert)) await gehe(x, pfad ? `${pfad}.${name}` : name);
    else if (typeof wert === "string" && wert.startsWith("../media/") && !(await exists(wert.slice(3)))) fehler[pfad] = "Dieses Bild gibt es nicht mehr. Bitte ein anderes wählen.";
  };
  await gehe(felder, "");
  if (Object.keys(fehler).length) throw new FeldFehler(fehler);
}

function pruefeSeite(doc: ContentDocument): void {
  if (!doc.vorlage || !doc.felder) return;
  const fehler = pruefeFelder(doc.vorlage, doc.titel, doc.felder);
  if (Object.keys(fehler).length) throw new FeldFehler(fehler);
}

async function writeDoc(doc: ContentDocument): Promise<void> {
  await schreibeAtomar(path.join(contentDir(), doc.rel), serializeDocument(doc));
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
    vorlage: doc.vorlage ?? null,
    menue: doc.menue ?? false,
    menueName: doc.menueName ?? null,
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

/**
 * Neue Dateien und Nummern der Reihe nach vergeben. Sonst bekommen zwei schnelle Klicks auf
 * «Neuen Newsletter schreiben» dieselbe Nummer, oder zwei Kopien denselben Dateinamen.
 */
let vergabe: Promise<unknown> = Promise.resolve();

function einzeln<T>(arbeit: () => Promise<T>): Promise<T> {
  const lauf = vergabe.then(arbeit, arbeit);
  vergabe = lauf.catch(() => undefined);
  return lauf;
}

/** Der Browser schickt den Namen kodiert: Ein Header kann weder «–» noch ein zerlegtes «ü» tragen. */
function dateiname(kodiert: string): string {
  try {
    return decodeURIComponent(kodiert);
  } catch {
    return kodiert;
  }
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

/**
 * Die Nummer nach dem letzten veröffentlichten Newsletter. Trägt ein Entwurf sie schon, die nächste
 * freie. Der Papierkorb zählt nicht: Wer einen von dort zurückholt, sieht einen Hinweis, wenn seine
 * Nummer doppelt ist, und veröffentlichen lässt sich eine doppelte Nummer ohnehin nicht.
 */
async function nextNummer(): Promise<number> {
  const briefe = (await loadDocuments()).filter((doc) => doc.art === "brief");
  const online = Math.max(0, ...briefe.filter((doc) => !doc.entwurf).map((doc) => doc.nummer ?? 0));
  const vergeben = new Set(briefe.filter((doc) => doc.entwurf).map((doc) => doc.nummer));
  let nummer = online + 1;
  while (vergeben.has(nummer)) nummer += 1;
  return nummer;
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

/** Wie nginx davor (client_max_body_size 32m): Grösseres wird nicht erst ganz in den Speicher gelesen. */
const MAX_BODY = 32 * 1024 * 1024;

async function readBody(req: http.IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) {
      req.destroy();
      throw new Error("Die Datei ist zu gross (höchstens 32 MB).");
    }
    chunks.push(Buffer.from(chunk));
  }
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

/** Gepackte Fassungen im Speicher. Der Schlüssel enthält die Prüfsumme, und nach rund 40 MB fängt es neu an. */
const gepackt = new Map<string, Buffer>();
let gepacktBytes = 0;

function packe(data: Buffer, art: "br" | "gzip", etag: string): Buffer {
  const schluessel = `${art}|${etag}`;
  const da = gepackt.get(schluessel);
  if (da) return da;
  const out = art === "br"
    ? zlib.brotliCompressSync(data, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 9, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: data.length } })
    : zlib.gzipSync(data, { level: 9 });
  if (gepacktBytes + out.length > 40 * 1024 * 1024) {
    gepackt.clear();
    gepacktBytes = 0;
  }
  gepackt.set(schluessel, out);
  gepacktBytes += out.length;
  return out;
}

function send(req: http.IncomingMessage, res: http.ServerResponse, file: string, data: Buffer, urlPath: string): void {
  const ext = path.extname(file).toLowerCase();
  const etag = `"${pruefsumme(data)}"`;
  const headers: http.OutgoingHttpHeaders = {
    "content-type": MIME[ext] ?? "application/octet-stream",
    "cache-control": cacheControl(urlPath),
    etag,
  };
  // Ein SVG kann Skript enthalten (etwa aus einer Word-Datei). Direkt geöffnet läuft es sonst mit dem Login der Redaktion.
  if (ext === ".svg") headers["content-security-policy"] = "sandbox; default-src 'none'; img-src data:; style-src 'unsafe-inline'; frame-ancestors 'self'";
  if (PACKBAR.has(ext)) headers.vary = "Accept-Encoding";
  if (req.headers["if-none-match"] === etag) {
    res.writeHead(304, headers);
    res.end();
    return;
  }
  if (PACKBAR.has(ext) && data.length > 1024) {
    const annahme = String(req.headers["accept-encoding"] ?? "");
    const art = /\bbr\b/.test(annahme) ? "br" : /\bgzip\b/.test(annahme) ? "gzip" : null;
    if (art) {
      headers["content-encoding"] = art;
      data = packe(data, art, etag);
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
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath.split("?")[0] ?? "/");
  } catch {
    // Kaputtes %-Zeichen in der Adresse: 404, nicht Absturz.
    return false;
  }
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
  <link rel="icon" href="/brand/favicon.png" type="image/png" sizes="32x32">
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
      sendJson(res, 200, { pages: editorOrder(docs).map(summary), menueReihe: await leseMenueReihe() });
      return;
    }
    sendJson(res, 200, await fuerBrowser(await readDoc(safeRel(rel))));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/papierkorb") {
    const docs = await loadPapierkorb();
    const seiten = await Promise.all(docs.map(async (doc) => ({
      ...summary(doc),
      geloeschtAm: await fs.stat(path.join(contentDir(), doc.rel)).then((stat) => stat.mtime.toISOString(), () => ""),
    })));
    seiten.sort((a, b) => b.geloeschtAm.localeCompare(a.geloeschtAm));
    sendJson(res, 200, { pages: seiten });
    return;
  }

  // Endgültig löschen: ein Eintrag (?rel=papierkorb/…) oder ohne rel der ganze Papierkorb.
  // In der Redaktion lässt sich das nicht zurückholen; im Inhalts-Git bleibt die frühere Fassung.
  if (req.method === "DELETE" && url.pathname === "/api/papierkorb") {
    const rel = url.searchParams.get("rel");
    const docs = rel ? [parseDocument(await fs.readFile(path.join(contentDir(), trashRel(rel)), "utf8"), trashRel(rel))] : await loadPapierkorb();
    await flushPending();
    for (const doc of docs) await fs.rm(path.join(contentDir(), doc.rel), { force: true });
    const message = docs.length === 1 ? `Endgültig gelöscht: ${docs[0].titel}` : `Papierkorb geleert (${docs.length})`;
    await commitIfChanged(message, docs.map((doc) => doc.rel));
    console.log(message);
    sendJson(res, 200, { geloescht: docs.length });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/anfragen") {
    // Personendaten: nie zwischenspeichern.
    res.setHeader("cache-control", "no-store");
    sendJson(res, 200, { anfragen: await listAnfragen(), aufbewahrungMonate: AUFBEWAHRUNG_MONATE });
    return;
  }

  if (req.method === "PUT" && url.pathname === "/api/anfragen") {
    const payload = JSON.parse((await readBody(req)).toString("utf8")) as { id?: string; status?: string };
    await setAnfrageStatus(String(payload.id ?? ""), String(payload.status ?? ""));
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/check") {
    const rel = url.searchParams.get("rel");
    if (rel) {
      sendJson(res, 200, { probleme: await seitenCheck(safeRel(rel)) });
      return;
    }
    sendJson(res, 200, { befunde: await websiteCheck() });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/info") {
    sendJson(res, 200, { publicUrl: PUBLIC_URL, assistent: assistentBereit() });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/status") {
    res.setHeader("cache-control", "no-store");
    sendJson(res, 200, { status: await leseStatus() });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/medien") {
    res.setHeader("cache-control", "no-store");
    sendJson(res, 200, { medien: await listeMedien() });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/medien/vorschau") {
    await sendeVorschau(url.searchParams.get("name"), Number(url.searchParams.get("w")) || 240, res);
    return;
  }

  // Nur was nichts mehr braucht. Die Fassung bleibt im Inhalts-Git, «Rückgängig» holt sie von dort.
  if (req.method === "DELETE" && url.pathname === "/api/medien") {
    const name = medienName(url.searchParams.get("name"));
    await flushPending();
    await pruefeLoeschbar(name);
    await commitIfChanged(`Bild hochgeladen: ${name}`, [`media/${name}`]);
    await fs.rm(path.join(contentDir(), "media", name), { force: true });
    const rev = await commitIfChanged(`Bild gelöscht: ${name}`, [`media/${name}`]);
    sendJson(res, 200, { rev });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/medien/zurueck") {
    const payload = JSON.parse((await readBody(req)).toString("utf8")) as { name?: string; rev?: string };
    const name = medienName(payload.name);
    await holeDateiZurueck(`media/${name}`, `${String(payload.rev ?? "")}^`);
    await commitIfChanged(`Bild zurückgeholt: ${name}`, [`media/${name}`]);
    sendJson(res, 200, { ok: true });
    return;
  }

  // Der ganze Verlauf des Inhalts, nicht nur der einer Seite.
  if (req.method === "GET" && url.pathname === "/api/verlauf") {
    res.setHeader("cache-control", "no-store");
    const seite = 50;
    const eintraege = await logAlles(seite + 1, Number(url.searchParams.get("skip")) || 0);
    sendJson(res, 200, { eintraege: eintraege.slice(0, seite), mehr: eintraege.length > seite });
    return;
  }

  // Eine neue feste Seite. Sie beginnt als Entwurf und hat von Anfang an Felder.
  if (req.method === "POST" && url.pathname === "/api/seiten") {
    const payload = JSON.parse((await readBody(req)).toString("utf8")) as { titel?: string; menue?: unknown };
    const titel = String(payload.titel ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
    const fehlt = (text: string) => new FeldFehler({ neu: text });
    if (!titel) throw fehlt("Bitte einen Titel eingeben.");
    const slug = slugify(titel);
    if (!slug || adresseReserviert(`/${slug}`)) throw fehlt(`Die Adresse «/${slug}» braucht die Website selbst. Bitte einen anderen Titel wählen.`);
    await flushPending();
    await einzeln(async () => {
      const docs = await loadDocuments();
      const rel = await freeRel(`kapitel/${slug}.md`);
      if (docs.some((doc) => publicPath(doc.rel) === publicPath(rel))) throw fehlt(`Die Adresse «${publicPath(rel)}» ist schon vergeben. Bitte einen anderen Titel wählen.`);
      const start = docs.find((doc) => doc.vorlage === "start")?.felder as { bild?: { src?: string } } | null | undefined;
      const namen = await fs.readdir(path.join(contentDir(), "media")).catch(() => [] as string[]);
      const bild = start?.bild?.src ?? (namen.find((name) => /\.(jpe?g|png|webp)$/i.test(name)) ? `../media/${namen.find((name) => /\.(jpe?g|png|webp)$/i.test(name))}` : "");
      if (!bild) throw fehlt("Es gibt noch kein Bild für den Kopf der Seite. Bitte zuerst eines hochladen.");
      const doc: ContentDocument = {
        rel,
        art: "kapitel",
        titel,
        datum: new Date().toISOString().slice(0, 10),
        nummer: null,
        entwurf: true,
        menue: menueOrt(payload.menue),
        vorlage: "abschnitte",
        felder: neueSeite(bild),
        body: "",
      };
      await writeDoc(doc);
      await commitIfChanged(`Neue Seite: ${titel}`, [rel]);
      sendJson(res, 200, await fuerBrowser(doc));
    });
    return;
  }

  // Die Reihenfolge des Menüs. Patrick drückt «Speichern», darum gilt sie sofort auf der Website.
  if (req.method === "POST" && url.pathname === "/api/menue") {
    const payload = JSON.parse((await readBody(req)).toString("utf8")) as { reihenfolge?: unknown };
    if (!Array.isArray(payload.reihenfolge)) throw new Error("Die Reihenfolge fehlt.");
    const gewuenscht = payload.reihenfolge.filter((rel): rel is string => typeof rel === "string");
    await flushPending();
    await einzeln(async () => {
      const docs = await loadDocuments();
      const eigene = docs.filter((doc) => doc.art === "kapitel" && doc.menue === true && !istFesteMenueSeite(doc.rel)).map((doc) => doc.rel);
      const reihenfolge = menueReihe(eigene, gewuenscht);
      await schreibeMenueReihe(reihenfolge);
      await loadDocuments();
      // Die Reihenfolge steht im Stempel der Adressen: Das Setzen merkt es und setzt alle Seiten neu.
      await updateSite([STARTSEITE]);
      await commitIfChanged("Menü neu geordnet", [MENUE_DATEI]);
      sendJson(res, 200, { reihenfolge });
    });
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

  // Neue Adresse für eine feste Seite. Die alte leitet weiter, Links in allen Seiten zeigen danach auf die neue.
  if (req.method === "POST" && url.pathname === "/api/adresse") {
    const payload = JSON.parse((await readBody(req)).toString("utf8")) as { rel?: string; adresse?: string };
    const rel = safeRel(payload.rel ?? "");
    await flushPending();
    const docs = await loadDocuments();
    const doc = docs.find((item) => item.rel === rel);
    if (!doc) throw new Error("Seite nicht gefunden.");
    if (doc.art === "brief") throw new Error("Newsletter haben immer die Adresse /newsletter-<Nummer>.");
    if (rel === STARTSEITE) throw new Error("Die Startseite hat immer die Adresse «/».");
    const slug = slugify(String(payload.adresse ?? "").replace(/^\s*(https?:\/\/)?[^/]*advocat-finanz\.ch/i, ""));
    if (!slug) throw new Error("Bitte eine Adresse eingeben, zum Beispiel «firmenkunden».");
    const neu = `/${slug}`;
    const alt = publicPath(rel);
    if (neu === alt) {
      sendJson(res, 200, await fuerBrowser(doc, alt));
      return;
    }
    if (adresseReserviert(neu)) throw new Error(`«${neu}» braucht die Website selbst. Bitte eine andere Adresse wählen.`);
    if (adresseBelegt(neu, rel)) {
      const andere = docs.find((item) => publicPath(item.rel) === neu);
      throw new Error(`«${neu}» hat schon die Seite «${andere?.titel ?? neu}». Bitte eine andere Adresse wählen.`);
    }
    const frueher = [...new Set([...(doc.frueher ?? []), alt])].filter((href) => href !== neu && href !== standardPfad(rel));
    const geaendert: ContentDocument = seiteMitNeuerAdresse({ ...doc, adresse: neu === standardPfad(rel) ? null : neu, frueher }, alt, neu);
    // Links auf die alte Adresse in allen Seiten, auch in dieser und in Entwürfen.
    const touched: string[] = [rel];
    for (const other of docs) {
      if (other.rel === rel) continue;
      const neuGesetzt = seiteMitNeuerAdresse(other, alt, neu);
      if (neuGesetzt !== other) {
        await writeDoc(neuGesetzt);
        touched.push(other.rel);
      }
    }
    await writeDoc(geaendert);
    await loadDocuments();
    await updateSite(touched);
    await commitIfChanged(`Neue Adresse: ${doc.titel} ${alt} → ${neu}`, touched);
    console.log(`Adresse ${rel}: ${alt} → ${neu} (${touched.length - 1} Seiten mit Links angepasst)`);
    sendJson(res, 200, { ...(await fuerBrowser(geaendert, neu)), angepasst: touched.length - 1 });
    return;
  }

  if (req.method === "PUT" && url.pathname === "/api/pages") {
    const payload = JSON.parse((await readBody(req)).toString("utf8")) as ContentDocument & { version?: string };
    const rel = safeRel(payload.rel);
    await einzeln(async () => {
      // Veröffentlichen und Zurückziehen haben eigene Wege. Ein spätes Speichern ändert den Stand nie.
      const before = await readDoc(rel).catch(() => null);
      // Neue Seiten entstehen nur über ihre eigenen Wege. Ein spätes Speichern auf eine Datei, die
      // inzwischen veröffentlicht (umbenannt) oder im Papierkorb ist, würde sie sonst als Seite zurückholen.
      if (!before) {
        sendJson(res, 409, { error: "Diese Seite gibt es unter diesem Namen nicht mehr. Bitte im Verzeichnis neu öffnen." });
        return;
      }
      // Anderes Fenster, oder eine neue Adresse hat Links in dieser Seite geändert: nichts still überschreiben.
      if (payload.version !== (await stand(rel))) {
        sendJson(res, 409, { error: "Diese Seite wurde inzwischen anderswo geändert. Bitte neu öffnen, dann erst weiterarbeiten." });
        return;
      }
      const titel = String(payload.titel ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
      const datum = String(payload.datum ?? "");
      if (datum && !/^\d{4}-\d{2}-\d{2}$/.test(datum)) throw new FeldFehler({ datum: "Kein gültiges Datum." });
      const nummer = payload.nummer == null || payload.nummer === ("" as unknown) ? null : Number(payload.nummer);
      if (typeof payload.body !== "string" || payload.body.length > 1_000_000) throw new Error("Text fehlt oder ist zu lang.");
      const doc: ContentDocument = {
        rel,
        // Was eine Seite ist, ändert sich beim Speichern nie.
        art: before.art,
        titel: titel || "Ohne Titel",
        datum,
        nummer: nummer != null && Number.isInteger(nummer) && nummer > 0 && nummer < 10_000 ? nummer : null,
        entwurf: before.entwurf ?? false,
        // Die Adresse hat einen eigenen Weg (/api/adresse): Speichern beim Tippen ändert sie nie.
        adresse: before.adresse ?? null,
        frueher: before.frueher ?? [],
        // Eigene Seiten dürfen ins Menü. Die festen stehen dort schon oder gehören in den Fuss.
        menue: before.art === "kapitel" && !VORLAGE_VON[rel] ? menueOrt(payload.menue) : false,
        menueName: String(payload.menueName ?? "").replace(/\s+/g, " ").trim().slice(0, MENUE_NAME_MAX) || null,
        vorlage: before.vorlage ?? null,
        felder: before.vorlage ? payload.felder ?? null : null,
        body: before.vorlage ? "" : payload.body,
      };
      // Online hängt die Adresse an der Nummer. Ändern geht nur im Entwurf.
      if (!before.entwurf) doc.nummer = before.nummer;
      pruefeSeite(doc);
      if (doc.felder) await pruefeBilderDa(doc.felder);
      await writeDoc(doc);
      await updateSite([rel]);
      scheduleCommit(commitMessage(doc), rel);
      console.log(`schreibt ${rel}`);
      sendJson(res, 200, { ok: true, message: commitMessage(doc), version: await stand(rel) });
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/briefs") {
    await einzeln(async () => {
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
      sendJson(res, 200, await fuerBrowser(doc));
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/copy") {
    const payload = JSON.parse((await readBody(req)).toString("utf8")) as { rel?: string };
    await flushPending();
    await einzeln(async () => {
      const source = await readDoc(safeRel(payload.rel ?? ""));
      if (source.vorlage && EINMALIG.includes(source.vorlage)) throw new Error("Diese Seite gibt es nur einmal. Für eine neue Seite «Neue Seite» wählen.");
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
          // Die Adresse gehört dem Original. Die Kopie bekommt ihre aus dem Dateinamen.
          adresse: null,
          frueher: [],
          menue: false,
          menueName: null,
        };
      }
      await writeDoc(doc);
      await commitIfChanged(`Kopie: ${doc.titel}`, [doc.rel]);
      console.log(`kopiert ${source.rel} nach ${doc.rel}`);
      sendJson(res, 200, await fuerBrowser(doc));
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/publish") {
    const payload = JSON.parse((await readBody(req)).toString("utf8")) as { rel?: string };
    const oldRel = safeRel(payload.rel ?? "");
    await flushPending();
    const doc = await readDoc(oldRel);
    if (doc.art === "brief" && !thema(doc.titel)) throw new Error("Bitte zuerst ein Thema eingeben.");
    pruefeSeite(doc);
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
    // Ebenso ein früher veröffentlichter, der eine neue Nummer bekam: die Adresse kommt aus dem Dateinamen.
    const base = path.posix.basename(oldRel, ".md");
    if (doc.art === "brief" && slug && (/^\d{4}-newsletter-\d+$/.test(base) || Number(base.slice(0, 4)) !== doc.nummer)) {
      const next = `briefe/${stem}-${slug}.md`;
      const taken = await fs.stat(path.join(contentDir(), next)).then(() => true, () => false);
      if (!taken) rel = next;
    }
    const besetzt = (await loadDocuments()).find(
      (other) => !other.entwurf && other.rel !== oldRel && publicPath(other.rel) === publicPath(rel),
    );
    if (besetzt) throw new Error(`Die Adresse ${publicPath(rel)} hat schon «${besetzt.titel}». Bitte eine andere Nummer wählen.`);
    const published: ContentDocument = { ...doc, rel, entwurf: false };
    await writeDoc(published);
    if (rel !== oldRel) await fs.rm(path.join(contentDir(), oldRel), { force: true });
    await updateSite([oldRel, rel]);
    await commitIfChanged(`Veröffentlicht: ${published.titel}`, [oldRel, rel]);
    console.log(`veröffentlicht ${rel}`);
    await loadDocuments();
    sendJson(res, 200, await fuerBrowser(published));
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
    await loadDocuments();
    sendJson(res, 200, await fuerBrowser(doc));
    return;
  }

  if (req.method === "DELETE" && url.pathname === "/api/pages") {
    const rel = safeRel(url.searchParams.get("rel") ?? "");
    const doc = await readDoc(rel);
    if (!doc.entwurf) throw new Error("Nur Entwürfe lassen sich löschen. Bitte zuerst zurückziehen.");
    // Nicht endgültig: die Datei wandert in den Papierkorb und lässt sich zurückholen.
    await flushPending();
    const ziel = await einzeln(async () => {
      const frei = await freeRel(`${PAPIERKORB}/${rel}`);
      await fs.mkdir(path.dirname(path.join(contentDir(), frei)), { recursive: true });
      await fs.rename(path.join(contentDir(), rel), path.join(contentDir(), frei));
      // Das Datum der Datei zeigt der Papierkorb als «gelöscht am».
      const jetzt = new Date();
      await fs.utimes(path.join(contentDir(), frei), jetzt, jetzt);
      return frei;
    });
    await commitIfChanged(`In den Papierkorb: ${doc.titel}`, [rel, ziel]);
    console.log(`Papierkorb ${rel}`);
    sendJson(res, 200, { ok: true, papierkorb: ziel });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/zurueckholen") {
    const payload = JSON.parse((await readBody(req)).toString("utf8")) as { rel?: string };
    const from = trashRel(payload.rel ?? "");
    const original = from.slice(PAPIERKORB.length + 1);
    await einzeln(async () => {
      const raw = await fs.readFile(path.join(contentDir(), from), "utf8");
      // Zurück kommt sie als Entwurf. Veröffentlichen ist ein eigener Schritt.
      const doc: ContentDocument = { ...parseDocument(raw, original), rel: await freeRel(original), entwurf: true };
      // Hat inzwischen eine andere Seite die gewählte Adresse, kommt sie mit der Standardadresse zurück.
      await loadDocuments();
      if (doc.adresse && adresseBelegt(doc.adresse)) doc.adresse = null;
      await writeDoc(doc);
      await fs.rm(path.join(contentDir(), from), { force: true });
      await commitIfChanged(`Zurückgeholt: ${doc.titel}`, [from, doc.rel]);
      console.log(`zurückgeholt ${doc.rel}`);
      sendJson(res, 200, await fuerBrowser(doc));
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/media") {
    const nameHeader = req.headers["x-filename"];
    const original = dateiname((Array.isArray(nameHeader) ? nameHeader[0] : nameHeader) ?? "bild.bin");
    const stem = path
      .basename(original, path.extname(original))
      .replace(/[^A-Za-z0-9._-]+/g, "-")
      .replace(/^[-.]+/, "")
      .slice(0, 40) || "bild";
    // Eines nach dem anderen: Ein grosses Foto belegt beim Entpacken einige hundert MB.
    const bild = await einzeln(async () => verarbeiteBild(await readBody(req)));
    const name = `${stem}-${Date.now().toString(36)}${bild.endung}`;
    const media = path.join(contentDir(), "media", name);
    await fs.mkdir(path.dirname(media), { recursive: true });
    await fs.writeFile(media, bild.daten);
    if (setztSeite) await copyMediaFile(media);
    pendingFiles.add(`media/${name}`);
    sendJson(res, 200, { url: `../media/${name}` });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/import") {
    const rel = safeRel(url.searchParams.get("rel") ?? "");
    const ziel = await readDoc(rel);
    if (!ziel.entwurf) throw new Error("Word-Dateien lassen sich nur in einen Entwurf importieren.");
    if (ziel.felder) throw new Error("Diese Seite hat Felder. Word-Dateien gehen nur in Newsletter.");
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
    const text = textVon(doc);
    sendJson(res, 200, { body: text, html: await textHtml(text), titel: doc.titel });
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
    // Auch die Adresse bleibt: andere Seiten verlinken schon auf die heutige.
    const doc: ContentDocument = { ...(await readDoc(rel)), rel, entwurf: before.entwurf, adresse: before.adresse ?? null, frueher: before.frueher ?? [], menue: before.menue, menueName: before.menueName ?? null };
    // Bilder dieser Fassung, die inzwischen gelöscht sind, kommen mit. Sonst fehlten sie auf der Website.
    const bilder: string[] = [];
    for (const name of bilderIn(`${textVon(doc)}\n${JSON.stringify(doc.felder ?? null)}`)) {
      const datei = `media/${name}`;
      if ((await exists(datei)) || !(await gibtEsInFassung(datei, rev))) continue;
      await holeDateiZurueck(datei, rev);
      if (setztSeite) await copyMediaFile(path.join(contentDir(), datei));
      bilder.push(datei);
    }
    await writeDoc(doc);
    await updateSite([rel]);
    const message = `Wiederhergestellt: ${doc.titel}`;
    await commitIfChanged(message, [rel, ...bilder]);
    console.log(`wiederhergestellt ${rel} aus ${rev.slice(0, 7)}`);
    sendJson(res, 200, { ok: true, doc: await fuerBrowser(doc) });
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

async function entferneMedium(rel: string): Promise<void> {
  const ordner = path.join(siteDir(), "media");
  const name = path.basename(rel);
  await fs.rm(path.join(ordner, name), { force: true });
  await pruneVariants(ordner, new Set(await fs.readdir(path.join(contentDir(), "media")).catch(() => [] as string[])));
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
    if (rel.startsWith("media/")) {
      if (event === "add" || event === "change") {
        void copyMediaFile(file).catch((error: unknown) => {
          console.error(error instanceof Error ? error.message : error);
        });
      } else if (event === "unlink") {
        // In den Medien gelöscht: auch von der Website, samt ihren kleineren Fassungen.
        void entferneMedium(rel).catch((error: unknown) => {
          console.error(error instanceof Error ? error.message : error);
        });
      }
      return;
    }
    // Die Reihenfolge des Menüs steht im Stempel der Adressen: Das Setzen merkt es und setzt alle Seiten neu.
    if (rel === MENUE_DATEI) {
      console.log(`setzt ${rel}`);
      setzeNeu([STARTSEITE]);
      return;
    }
    if (!rel.endsWith(".md") || rel.includes("..")) return;
    if (!rel.startsWith("briefe/") && !rel.startsWith("kapitel/") && !rel.startsWith("recht/")) return;
    console.log(`setzt ${rel}`);
    setzeNeu([rel]);
  });
}

async function main(): Promise<void> {
  console.log(`Rolle: ${ROLLE}`);
  if (hatRedaktion) {
    await ensureContentGit();
    await stelleSeitenUm().catch((error: unknown) => {
      console.error("Umstellung auf Felder fehlgeschlagen:", error instanceof Error ? error.message : error);
    });
  }
  // Die Adressen der Seiten kennen, bevor die erste Anfrage kommt.
  await loadDocuments().catch(() => []);
  if (setztSeite) {
    // Immer neu setzen: nach einem Code-Update passt altes HTML nicht zum neuen heft.css.
    // Eine kaputte Datei darf die Seite nicht vom Netz nehmen: Was schon gesetzt ist, bleibt online.
    console.log("Setze die Seiten …");
    const setzen = buildSite().then(
      async (built) => {
        console.log(`${built.pages} Seiten gesetzt.`);
        await schreibeStatus();
      },
      async (error: unknown) => {
        console.error("Setzen fehlgeschlagen, der letzte Stand bleibt online:", error instanceof Error ? error.message : error);
        await schreibeStatus(error);
      },
    );
    // Liegt schon eine Website da, antwortet der Server gleich und setzt im Hintergrund.
    if (!(await fs.stat(path.join(siteDir(), "index.html")).then(() => true, () => false))) await setzen;
    // Anfragen nach Ablauf der Frist löschen: beim Start und danach einmal am Tag.
    const aufraeumen = () => void loescheAlteAnfragen().catch((error) => console.error("Anfragen löschen:", error instanceof Error ? error.message : error));
    aufraeumen();
    setInterval(aufraeumen, 24 * 60 * 60 * 1000).unref();
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
    let url: URL;
    try {
      url = new URL(req.url ?? "/", `http://${host || "localhost"}`);
    } catch {
      res.writeHead(400);
      res.end();
      return;
    }
    // Der Container `redaktion` hat nur den einen Namen, dort ist die Redaktion immer die Wurzel.
    // Für alle Antworten: keine geratenen Dateitypen, nicht in fremden Rahmen (Klick-Fallen auf «Veröffentlichen»).
    res.setHeader("x-content-type-options", "nosniff");
    res.setHeader("x-frame-options", "SAMEORIGIN");
    // Dasselbe in neu. SWAG entfernt X-Frame-Options auf dem Weg nach draussen, diesen Header nicht.
    res.setHeader("content-security-policy", "frame-ancestors 'self'");
    res.setHeader("referrer-policy", "strict-origin-when-cross-origin");
    if (ROLLE === "redaktion" && !schluesselPasst(req, SCHLUESSEL)) {
      res.writeHead(SCHLUESSEL ? 403 : 503, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
      res.end(SCHLUESSEL ? "Nur über redaktion.<domain> mit Anmeldung." : "Redaktion gesperrt: REDAKTION_SCHLUESSEL fehlt.");
      return;
    }
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
        }).catch((error: unknown) => fehlerAntwort(res, error));
        return;
      }
      if (einstieg) {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(editorHtml());
        return;
      }
    }
    if (url.pathname.startsWith("/api/")) {
      if (fremdeHerkunft(req)) {
        sendJson(res, 403, { error: "Fremde Herkunft" });
        return;
      }
      void handleApi(req, res, url).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "Fehler";
        console.error(`${req.method} ${url.pathname}: ${message}`);
        if (res.headersSent) return;
        if (error instanceof FeldFehler) sendJson(res, 422, { error: message, felder: error.felder });
        else sendJson(res, 400, { error: message });
      });
      return;
    }
    // Unter advocat.<domain> läuft dieselbe Seite. Google soll nur die eine Adresse führen.
    if (setztSeite && !kanonischerHost(req, siteUrl())) {
      res.setHeader("x-robots-tag", "noindex");
      if (url.pathname === "/robots.txt") {
        res.writeHead(200, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-cache" });
        res.end("User-agent: *\nDisallow: /\n");
        return;
      }
    }
    const kontakt = publicPath("kapitel/kontakt.md");
    if (setztSeite && req.method === "POST" && [kontakt, `${kontakt}/`, "/kontakt", "/kontakt/"].includes(url.pathname)) {
      void handleAnfrage(req, res).catch((error: unknown) => {
        console.error("Anfrage:", error instanceof Error ? error.message : error);
        if (!res.headersSent) sendJson(res, 500, { error: "Fehler" });
      });
      return;
    }
    // Versteckter Weg in die Redaktion (Logo halten oder das Wort tippen, siehe site.js). Die Adresse
    // steht nur hier, nicht in der Seite. Leer gesetzt: 404 wie jede unbekannte Seite.
    if (setztSeite && url.pathname === "/eingang" && REDAKTION_URL) {
      res.writeHead(302, { location: REDAKTION_URL, "cache-control": "no-store", "x-robots-tag": "noindex, nofollow" });
      res.end();
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
      res.writeHead(301, { location: ohneEndSchraegstrich(url.pathname) + url.search });
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
      }).catch((error: unknown) => fehlerAntwort(res, error));
      return;
    }
    void serveStatic(req, url.pathname, res).then((ok) => {
      if (!ok && !res.headersSent) {
        res.writeHead(404, { "content-type": "text/html; charset=utf-8" });
        res.end(notFoundPage());
      }
    }).catch((error: unknown) => fehlerAntwort(res, error));
  });

  if (setztSeite) watchContent();
  // Der Website-Check setzt jede Seite einmal. Schon beim Start, damit die Startseite der Redaktion nicht wartet.
  if (hatRedaktion) {
    void websiteCheck().catch((error: unknown) => {
      console.error("Website-Check:", error instanceof Error ? error.message : error);
    });
  }

  server.listen(PORT, () => {
    if (setztSeite) console.log(`Heft auf http://127.0.0.1:${PORT}`);
    if (hatRedaktion) console.log(`Redaktion auf http://127.0.0.1:${PORT}${ROLLE === "redaktion" ? "/" : "/redaktion"}`);
    if (hatRedaktion && !assistentBereit()) console.log("Assistent aus: XAI_API_KEY fehlt.");
    if (ROLLE === "redaktion" && !SCHLUESSEL) console.error("Redaktion gesperrt: REDAKTION_SCHLUESSEL fehlt (Neo: Advocat Redaktion → schluessel).");
    if (!setztSeite) return;
    console.log(`Anfragen nach ${anfragenDir()}`);
    if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) {
      console.log("Telegram aus: TELEGRAM_BOT_TOKEN und TELEGRAM_CHAT_ID fehlen.");
    }
  });
}

/** Letzte Stufe: ein Fehler in einer Anfrage beantwortet diese mit 500, der Prozess bleibt stehen. */
function fehlerAntwort(res: http.ServerResponse, error: unknown): void {
  console.error("Anfrage:", error instanceof Error ? error.message : error);
  if (!res.headersSent) res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
  if (!res.writableEnded) res.end();
}

process.on("unhandledRejection", (error) => {
  console.error("Unbehandelt:", error instanceof Error ? error.stack ?? error.message : error);
});

await main();
