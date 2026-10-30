import fs from "node:fs/promises";
import path from "node:path";
import { publicPath, type ContentDocument } from "../content/document.ts";
import { briefsNewestFirst, loadDocuments } from "../content/load.ts";
import { excerptFromMarkdown, renderDocument, type PageView, type Teaser } from "../design/layout.ts";
import { pageShell } from "../design/page.ts";
import { robotsTxt, sitemapXml, type SitemapEntry } from "../design/seo.ts";
import { repoRoot, siteDir, contentDir } from "../paths.ts";
import { markdownToHtml } from "./crepe.ts";
import { publishMedia, pruneVariants, VARIANT_DIR } from "./media.ts";

const FONTS: Record<string, string> = {
  "manrope-400.woff2": "@fontsource/manrope/files/manrope-latin-400-normal.woff2",
  "manrope-500.woff2": "@fontsource/manrope/files/manrope-latin-500-normal.woff2",
  "manrope-600.woff2": "@fontsource/manrope/files/manrope-latin-600-normal.woff2",
  "manrope-700.woff2": "@fontsource/manrope/files/manrope-latin-700-normal.woff2",
  "manrope-800.woff2": "@fontsource/manrope/files/manrope-latin-800-normal.woff2",
  "marcellus-400.woff2": "@fontsource/marcellus/files/marcellus-latin-400-normal.woff2",
};

function pageFile(site: string, href: string): string {
  if (href === "/") return path.join(site, "index.html");
  return path.join(site, href.replace(/^\//, ""), "index.html");
}

export function publishHtml(html: string): string {
  return html.replace(/(src|href)="(?:\.\.\/)+media\//g, '$1="/media/');
}

/**
 * Kopiert als neue, beschreibbare Datei. `fs.copyFile` übernimmt die Rechte, und aus dem
 * Nix-Store ist alles 0444: dann scheitert das nächste Überschreiben mit EACCES.
 */
async function copyWritable(from: string, to: string): Promise<void> {
  const data = await fs.readFile(from);
  await fs.rm(to, { force: true });
  await fs.writeFile(to, data);
}

/** Die Bilder aus dem Inhalt, verkleinert für die Seite. */
async function copyMediaDir(from: string, to: string): Promise<void> {
  await fs.mkdir(to, { recursive: true });
  const entries = await fs.readdir(from, { withFileTypes: true });
  for (const entry of entries) {
    const src = path.join(from, entry.name);
    const dest = path.join(to, entry.name);
    if (entry.isDirectory()) await copyMediaDir(src, dest);
    else if (entry.isFile()) await publishMedia(src, dest);
  }
}

/** Leert den Ordner, lässt ihn aber stehen. Auf Neo ist SITE_DIR ein Bind-Mount, rmdir gibt dort EBUSY. */
async function emptyDir(dir: string, keep = new Set<string>()): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  for (const name of await fs.readdir(dir)) {
    if (keep.has(name)) continue;
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
  await copyWritable(path.join(repoRoot, "src/design/heft.css"), path.join(site, "heft.css"));
  await copyWritable(path.join(repoRoot, "src/design/site.js"), path.join(site, "site.js"));
  for (const [name, rel] of Object.entries(FONTS)) {
    await copyWritable(path.join(repoRoot, "node_modules", rel), path.join(site, "fonts", name));
  }
  const brand = path.join(repoRoot, "src/design/brand");
  const names = await fs.readdir(brand);
  for (const name of names) {
    const src = path.join(brand, name);
    if ((await fs.stat(src)).isFile()) await copyWritable(src, path.join(site, "brand", name));
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
      await writePage(site, view.here, pageShell(view));
    }
    return;
  }
  const view = renderDocument({ ...doc, html, teasers });
  await writePage(site, view.here, pageShell(view));
}

/** Sitemap und robots.txt. Billig genug, um sie bei jeder Änderung ganz neu zu schreiben. */
async function writeIndexFiles(site: string, docs: ContentDocument[]): Promise<void> {
  const briefs = briefsNewestFirst(docs);
  const newest = briefs[0]?.datum ?? "";
  const entries: SitemapEntry[] = [];
  for (const doc of docs) {
    const href = publicPath(doc.rel);
    // Start und Archiv ändern sich mit jedem neuen Newsletter.
    const lastmod = doc.rel === "kapitel/willkommen.md" || doc.rel === "kapitel/neuigkeiten.md" ? newest : doc.datum;
    entries.push({ href, lastmod });
    if (doc.rel === "kapitel/neuigkeiten.md") {
      const pages = Math.ceil(briefs.length / 10);
      for (let page = 2; page <= pages; page += 1) entries.push({ href: `/neuigkeiten/page/${page}`, lastmod: "" });
    }
  }
  entries.sort((a, b) => (a.href === "/" ? -1 : b.href === "/" ? 1 : a.href.localeCompare(b.href, "de")));
  await fs.writeFile(path.join(site, "sitemap.xml"), sitemapXml(entries), "utf8");
  await fs.writeFile(path.join(site, "robots.txt"), robotsTxt(), "utf8");
}

/** Was auf der Seite steht. Entwürfe bleiben in der Redaktion. */
async function publishedDocuments(): Promise<ContentDocument[]> {
  return (await loadDocuments()).filter((doc) => !doc.entwurf);
}

/** Eine Seite so, wie sie veröffentlicht aussähe. Für die Vorschau eines Entwurfs. */
export async function previewPage(doc: ContentDocument): Promise<string> {
  return pageShell(await pageView(doc));
}

/** Titel, Beschreibung und Vorschaubild, wie Google sie von dieser Seite liest. Für den Assistenten. */
export async function pageView(doc: ContentDocument): Promise<PageView> {
  const teasers = teasersFor(briefsNewestFirst(await publishedDocuments()));
  const html = publishHtml(await markdownToHtml(doc.body));
  return renderDocument({ ...doc, html, teasers });
}

export async function buildSite(): Promise<{ pages: number; index: string }> {
  const docs = await publishedDocuments();
  const briefs = briefsNewestFirst(docs);
  const teasers = teasersFor(briefs);
  const site = siteDir();
  // Die Bildfassungen bleiben stehen: sie neu zu rechnen kostet beim Start eine halbe Minute.
  await emptyDir(site, new Set(["media"]));
  await emptyDir(path.join(site, "media"), new Set([VARIANT_DIR]));

  const media = path.join(contentDir(), "media");
  try {
    await copyMediaDir(media, path.join(site, "media"));
  } catch {
    // Noch keine Bilder.
  }
  await pruneVariants(path.join(site, "media"), new Set(await fs.readdir(media).catch(() => [] as string[])));
  await copyAssets();

  let index = "Willkommen";
  for (const doc of docs) {
    await writeDocument(site, doc, teasers);
    if (doc.rel === "kapitel/willkommen.md") index = doc.titel;
  }
  await writeIndexFiles(site, docs);
  return { pages: docs.length, index };
}

/** Baut nur die geänderten Seiten neu. Ein Brief erneuert auch Startseite und Archiv. */
export async function rebuildDocuments(rels: string[]): Promise<void> {
  const docs = await publishedDocuments();
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
  await writeIndexFiles(site, docs);
}
