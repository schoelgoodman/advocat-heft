import fs from "node:fs/promises";
import path from "node:path";
import { publicPath } from "../content/document.ts";
import { briefsNewestFirst, loadDocuments, registerLinks } from "../content/load.ts";
import { heftPage } from "../design/page.ts";
import { repoRoot, siteDir, contentDir } from "../paths.ts";
import { markdownToHtml } from "./crepe.ts";

const FONTS: Record<string, string> = {
  "newsreader-400.woff2": "@fontsource/newsreader/files/newsreader-latin-400-normal.woff2",
  "newsreader-400-italic.woff2": "@fontsource/newsreader/files/newsreader-latin-400-italic.woff2",
  "newsreader-600.woff2": "@fontsource/newsreader/files/newsreader-latin-600-normal.woff2",
  "inter-400.woff2": "@fontsource/inter/files/inter-latin-400-normal.woff2",
  "inter-500.woff2": "@fontsource/inter/files/inter-latin-500-normal.woff2",
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

async function writePage(site: string, href: string, html: string): Promise<void> {
  const file = pageFile(site, href);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, html, "utf8");
}

export async function buildSite(): Promise<{ pages: number; index: string }> {
  const docs = await loadDocuments();
  const briefs = briefsNewestFirst(docs);
  const register = registerLinks(docs);
  const site = siteDir();
  await fs.rm(site, { recursive: true, force: true });
  await fs.mkdir(site, { recursive: true });

  const media = path.join(contentDir(), "media");
  try {
    await copyDir(media, path.join(site, "media"));
  } catch {
    // Noch keine Bilder.
  }
  await fs.copyFile(path.join(repoRoot, "src/design/heft.css"), path.join(site, "heft.css"));
  await fs.mkdir(path.join(site, "fonts"), { recursive: true });
  for (const [name, rel] of Object.entries(FONTS)) {
    await fs.copyFile(path.join(repoRoot, "node_modules", rel), path.join(site, "fonts", name));
  }

  for (const doc of docs) {
    const body = publishHtml(await markdownToHtml(doc.body));
    const html = heftPage({
      doc,
      bodyHtml: body,
      register,
      briefs,
      currentHref: publicPath(doc.rel),
    });
    await writePage(site, publicPath(doc.rel), html);
  }

  const latest = briefs[0];
  if (latest) {
    const body = publishHtml(await markdownToHtml(latest.body));
    const html = heftPage({
      doc: latest,
      bodyHtml: body,
      register,
      briefs,
      currentHref: "/",
    });
    await writePage(site, "/", html);
  }

  return { pages: docs.length, index: latest?.titel ?? "" };
}

/** Baut nur die geänderten Seiten neu. Ein Brief erneuert auch Startseite und Archiv. */
export async function rebuildDocuments(rels: string[]): Promise<void> {
  const docs = await loadDocuments();
  const briefs = briefsNewestFirst(docs);
  const register = registerLinks(docs);
  const site = siteDir();
  await fs.mkdir(site, { recursive: true });
  const wanted = new Set(rels);
  if ([...wanted].some((rel) => rel.startsWith("briefe/"))) wanted.add("kapitel/neuigkeiten.md");

  const render = async (doc: (typeof docs)[number], href: string): Promise<void> => {
    const body = publishHtml(await markdownToHtml(doc.body));
    const html = heftPage({ doc, bodyHtml: body, register, briefs, currentHref: href });
    await writePage(site, href, html);
  };

  for (const rel of wanted) {
    const doc = docs.find((item) => item.rel === rel);
    if (doc) await render(doc, publicPath(doc.rel));
  }
  const latest = briefs[0];
  if (latest && [...rels].some((rel) => rel.startsWith("briefe/"))) {
    await render(latest, "/");
  }
}
