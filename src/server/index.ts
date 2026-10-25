import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { watch } from "chokidar";
import { createServer as createVite, type ViteDevServer } from "vite";
import { parseDocument, serializeDocument, type Art, type ContentDocument } from "../content/document.ts";
import { loadDocuments } from "../content/load.ts";
import { commitIfChanged, ensureContentGit, logFile, restoreFile, showFile } from "../git/history.ts";
import { contentDir, repoRoot, siteDir } from "../paths.ts";
import { buildSite, rebuildDocuments } from "../render/build.ts";

const PORT = Number(process.env.PORT ?? 4321);
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
  if (doc.art === "brief" && doc.nummer != null) return `Ausgabe ${doc.nummer}: ${titel}`;
  if (doc.art === "recht") return `Recht: ${titel}`;
  return `Kapitel: ${titel}`;
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
};

async function serveStatic(urlPath: string, res: http.ServerResponse): Promise<boolean> {
  const decoded = decodeURIComponent(urlPath.split("?")[0] ?? "/");
  if (decoded.includes("\0") || decoded.split("/").includes("..")) return false;
  let file = path.join(siteDir(), decoded);
  const stat = await fs.stat(file).catch(() => null);
  if (stat?.isDirectory() || !path.extname(decoded)) {
    file = path.join(file, "index.html");
  }
  try {
    const data = await fs.readFile(file);
    res.writeHead(200, { "content-type": MIME[path.extname(file)] ?? "application/octet-stream" });
    res.end(data);
    return true;
  } catch {
    return false;
  }
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
      sendJson(res, 200, {
        pages: docs
          .map((doc) => ({ rel: doc.rel, titel: doc.titel, art: doc.art, datum: doc.datum, nummer: doc.nummer }))
          .sort((a, b) => a.rel.localeCompare(b.rel, "de")),
      });
      return;
    }
    const file = path.join(contentDir(), safeRel(rel));
    const doc = parseDocument(await fs.readFile(file, "utf8"), safeRel(rel));
    sendJson(res, 200, doc);
    return;
  }

  if (req.method === "PUT" && url.pathname === "/api/pages") {
    const payload = JSON.parse((await readBody(req)).toString("utf8")) as ContentDocument;
    const rel = safeRel(payload.rel);
    if (!ARTS.includes(payload.art)) throw new Error("Unbekannte Art");
    const doc: ContentDocument = {
      rel,
      art: payload.art,
      titel: String(payload.titel ?? "").trim() || "Ohne Titel",
      datum: String(payload.datum ?? ""),
      nummer: payload.nummer == null || payload.nummer === ("" as unknown) ? null : Number(payload.nummer),
      body: String(payload.body ?? ""),
    };
    if (doc.nummer != null && !Number.isFinite(doc.nummer)) doc.nummer = null;
    const file = path.join(contentDir(), rel);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, serializeDocument(doc), "utf8");
    await rebuildDocuments([rel]);
    scheduleCommit(commitMessage(doc), rel);
    console.log(`schreibt ${rel}`);
    sendJson(res, 200, { ok: true, message: commitMessage(doc) });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/briefs") {
    const payload = JSON.parse((await readBody(req)).toString("utf8")) as { titel?: string };
    const docs = await loadDocuments();
    const nummer = Math.max(0, ...docs.map((doc) => doc.nummer ?? 0)) + 1;
    const titel = (payload.titel ?? "").trim() || `Ausgabe ${nummer}`;
    const slug = titel
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60) || "ausgabe";
    const rel = `briefe/${String(nummer).padStart(4, "0")}-${slug}.md`;
    const doc: ContentDocument = {
      rel,
      art: "brief",
      titel,
      datum: new Date().toISOString().slice(0, 10),
      nummer,
      body: "Schreiben Sie hier.\n",
    };
    await fs.writeFile(path.join(contentDir(), rel), serializeDocument(doc), "utf8");
    await rebuildDocuments([rel]);
    scheduleCommit(commitMessage(doc), rel);
    sendJson(res, 200, doc);
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
    await fs.mkdir(path.join(siteDir(), "media"), { recursive: true });
    await fs.copyFile(media, path.join(siteDir(), "media", name));
    pendingFiles.add(`media/${name}`);
    sendJson(res, 200, { url: `../media/${name}` });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/history") {
    const rel = safeRel(url.searchParams.get("rel") ?? "");
    const rev = url.searchParams.get("rev");
    if (!rev) {
      sendJson(res, 200, { revisions: await logFile(rel) });
      return;
    }
    const raw = await showFile(rel, rev);
    const doc = parseDocument(raw, rel);
    const { markdownToHtml } = await import("../render/crepe.ts");
    const { publishHtml } = await import("../render/build.ts");
    sendJson(res, 200, { body: doc.body, html: publishHtml(await markdownToHtml(doc.body)), titel: doc.titel });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/restore") {
    const payload = JSON.parse((await readBody(req)).toString("utf8")) as { rel?: string; rev?: string };
    const rel = safeRel(payload.rel ?? "");
    const rev = payload.rev ?? "";
    await restoreFile(rel, rev);
    await rebuildDocuments([rel]);
    const raw = await fs.readFile(path.join(contentDir(), rel), "utf8");
    const doc = parseDocument(raw, rel);
    const message = `Wiederhergestellt: ${doc.titel}`;
    pendingFiles.delete(rel);
    await commitIfChanged(message, [rel]);
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

async function serveEditor(urlPath: string, res: http.ServerResponse): Promise<boolean> {
  if (!productionEditor) return false;
  const rel = urlPath === "/redaktion" || urlPath === "/redaktion/" ? "index.html" : urlPath.replace(/^\//, "");
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
  const dest = path.join(siteDir(), rel);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.copyFile(file, dest);
}

async function main(): Promise<void> {
  await ensureContentGit();
  try {
    await fs.access(path.join(siteDir(), "index.html"));
  } catch {
    console.log("Setze das Heft zum ersten Mal …");
    await buildSite();
  }

  const vite: ViteDevServer | null = productionEditor
    ? null
    : await createVite({
        root: repoRoot,
        appType: "custom",
        server: { middlewareMode: true },
      });
  const server = http.createServer((req, res) => {
    const host = req.headers.host ?? "";
    const url = new URL(req.url ?? "/", `http://${host || "localhost"}`);
    if (host.startsWith("redaktion.") && (url.pathname === "/" || url.pathname === "")) {
      res.writeHead(302, { location: "/redaktion" });
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
    if (url.pathname === "/redaktion" || url.pathname === "/redaktion/" || url.pathname.startsWith("/assets/")) {
      if (productionEditor) {
        void serveEditor(url.pathname, res).then((ok) => {
          if (!ok && !res.headersSent) {
            res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
            res.end("Redaktion ist nicht gebaut.");
          }
        });
        return;
      }
      if (url.pathname === "/redaktion" || url.pathname === "/redaktion/") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(editorHtml());
        return;
      }
    }
    if (url.pathname.startsWith("/api/")) {
      void handleApi(req, res, url).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "Fehler";
        if (!res.headersSent) sendJson(res, 400, { error: message });
      });
      return;
    }
    void serveStatic(url.pathname, res).then((ok) => {
      if (!ok && !res.headersSent) {
        res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
        res.end("Nicht gefunden");
      }
    });
  });

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
    void rebuildDocuments([rel]).catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
    });
  });

  server.listen(PORT, () => {
    console.log(`Heft auf http://127.0.0.1:${PORT}`);
    console.log(`Redaktion auf http://127.0.0.1:${PORT}/redaktion`);
  });
}

await main();
