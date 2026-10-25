import fs from "node:fs/promises";
import path from "node:path";
import { publicPath, type ContentDocument } from "../content/document.ts";
import { briefsNewestFirst, loadDocuments } from "../content/load.ts";
import { excerptFromMarkdown, renderDocument, type Teaser } from "../design/layout.ts";
import { pageShell } from "../design/page.ts";
import { repoRoot, siteDir, contentDir } from "../paths.ts";
import { markdownToHtml } from "./crepe.ts";

const FONTS: Record<string, string> = {
  "inter-400.woff2": "@fontsource/inter/files/inter-latin-400-normal.woff2",
  "inter-500.woff2": "@fontsource/inter/files/inter-latin-500-normal.woff2",
  "inter-600.woff2": "@fontsource/inter/files/inter-latin-600-normal.woff2",
  "inter-700.woff2": "@fontsource/inter/files/inter-latin-700-normal.woff2",
  "inter-800.woff2": "@fontsource/inter/files/inter-latin-800-normal.woff2",
  "newsreader-400.woff2": "@fontsource/newsreader/files/newsreader-latin-400-normal.woff2",
  "newsreader-500.woff2": "@fontsource/newsreader/files/newsreader-latin-500-normal.woff2",
  "newsreader-400-italic.woff2": "@fontsource/newsreader/files/newsreader-latin-400-italic.woff2",
  "open-sans-400.woff2": "@fontsource/open-sans/files/open-sans-latin-400-normal.woff2",
  "open-sans-500.woff2": "@fontsource/open-sans/files/open-sans-latin-500-normal.woff2",
  "open-sans-600.woff2": "@fontsource/open-sans/files/open-sans-latin-600-normal.woff2",
  "open-sans-700.woff2": "@fontsource/open-sans/files/open-sans-latin-700-normal.woff2",
};

function pageFile(site: string, href: string): string {
  if (href === "/") return path.join(site, "index.html");
  return path.join(site, href.replace(/^\//, ""), "index.html");
}

export function publishHtml(html: string): string {
  return html.replace(/(src|href)="(?:\.\.\/)+media\//g, '$1="/media/');
}

async function copyDir(from: string, to: string): Promise<void> {
  await fs.mkdir(to, { recursive: true });
  const entries = await fs.readdir(from, { withFileTypes: true });
  for (const entry of entries) {
    const src = path.join(from, entry.name);
    const dest = path.join(to, entry.name);
    if (entry.isDirectory()) await copyDir(src, dest);
    else if (entry.isFile()) await fs.copyFile(src, dest);
  }
}

/** Leert den Ordner, lässt ihn aber stehen. Auf Neo ist SITE_DIR ein Bind-Mount, rmdir gibt dort EBUSY. */
async function emptyDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  for (const name of await fs.readdir(dir)) {
    await fs.rm(path.join(dir, name), { recursive: true, force: true });
  }
}

async function writePage(site: string, href: string, html: string): Promise<void> {
  const file = pageFile(site, href);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, html, "utf8");
}

export async function copyAssets(): Promise<void> {
  const site = siteDir();
  await fs.mkdir(path.join(site, "fonts"), { recursive: true });
  await fs.mkdir(path.join(site, "brand"), { recursive: true });
  await fs.copyFile(path.join(repoRoot, "src/design/heft.css"), path.join(site, "heft.css"));
  await fs.copyFile(path.join(repoRoot, "src/design/site.js"), path.join(site, "site.js"));
  for (const [name, rel] of Object.entries(FONTS)) {
    await fs.copyFile(path.join(repoRoot, "node_modules", rel), path.join(site, "fonts", name));
  }
  const brand = path.join(repoRoot, "src/design/brand");
  const names = await fs.readdir(brand);
  for (const name of names) {
    const src = path.join(brand, name);
    if ((await fs.stat(src)).isFile()) await fs.copyFile(src, path.join(site, "brand", name));
  }
}

function teasersFor(briefs: ContentDocument[]): Teaser[] {
  return briefs.map((brief) => ({
    href: publicPath(brief.rel),
    titel: brief.titel,
    datum: brief.datum,
    excerpt: excerptFromMarkdown(brief.body),
  }));
}

async function writeDocument(site: string, doc: ContentDocument, teasers: Teaser[]): Promise<void> {
  const html = publishHtml(await markdownToHtml(doc.body));
  if (doc.rel === "kapitel/neuigkeiten.md") {
    const pages = Math.max(1, Math.ceil(teasers.length / 10));
    await fs.rm(path.join(site, "neuigkeiten", "page"), { recursive: true, force: true });
    for (let page = 1; page <= pages; page += 1) {
      const view = renderDocument({ ...doc, html, teasers, page });
      await writePage(site, view.here, pageShell({ title: view.title, here: view.here, main: view.main }));
    }
    return;
  }
  const view = renderDocument({ ...doc, html, teasers });
  await writePage(site, view.here, pageShell({ title: view.title, here: view.here, main: view.main }));
}

export async function buildSite(): Promise<{ pages: number; index: string }> {
  const docs = await loadDocuments();
  const briefs = briefsNewestFirst(docs);
  const teasers = teasersFor(briefs);
  const site = siteDir();
  await emptyDir(site);

  const media = path.join(contentDir(), "media");
  try {
    await copyDir(media, path.join(site, "media"));
  } catch {
    // Noch keine Bilder.
  }
  await copyAssets();

  let index = "Willkommen";
  for (const doc of docs) {
    await writeDocument(site, doc, teasers);
    if (doc.rel === "kapitel/willkommen.md") index = doc.titel;
  }
  return { pages: docs.length, index };
}

/** Baut nur die geänderten Seiten neu. Ein Brief erneuert auch Startseite und Archiv. */
export async function rebuildDocuments(rels: string[]): Promise<void> {
  const docs = await loadDocuments();
  const teasers = teasersFor(briefsNewestFirst(docs));
  const site = siteDir();
  await fs.mkdir(site, { recursive: true });
  await copyAssets();
  const wanted = new Set(rels);
  if (rels.some((rel) => rel.startsWith("briefe/"))) {
    wanted.add("kapitel/willkommen.md");
    wanted.add("kapitel/neuigkeiten.md");
  }

  for (const rel of wanted) {
    const doc = docs.find((item) => item.rel === rel);
    if (!doc) {
      const href = publicPath(rel);
      if (href !== "/") await fs.rm(path.join(site, href.replace(/^\//, "")), { recursive: true, force: true });
      continue;
    }
    await writeDocument(site, doc, teasers);
  }
}
