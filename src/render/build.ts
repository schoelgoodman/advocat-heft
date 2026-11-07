import fs from "node:fs/promises";
import path from "node:path";
import { allgemein } from "../content/allgemein.ts";
import { adresseReserviert, adressStempel, alteAdressen, publicPath, type ContentDocument } from "../content/document.ts";
import { briefsNewestFirst, loadDocuments } from "../content/load.ts";
import { excerptFromMarkdown, minutesFromMarkdown, renderDocument, type PageView, type Teaser } from "../design/layout.ts";
import { pageShell } from "../design/page.ts";
import { renderSeite } from "../design/seiten.ts";
import { robotsTxt, sitemapDatum, sitemapXml, type SitemapEntry } from "../design/seo.ts";
import { letzteAenderungen } from "../git/history.ts";
import { schreibeAtomar } from "../content/atomar.ts";
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

/** Was beim ganzen Setzen entstanden ist. Alles andere im Ordner ist von früher und fällt danach weg. */
let gesetzt: Set<string> | null = null;

async function writePage(site: string, href: string, html: string): Promise<void> {
  gesetzt?.add(href === "/" ? "index.html" : href.replace(/^\//, "").split("/")[0]);
  // Besucher sehen eine Seite ganz oder gar nicht, nie halb.
  await schreibeAtomar(pageFile(site, href), html);
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
    excerpt: excerptFromMarkdown(brief.body, brief.titel),
    nummer: brief.nummer,
    minuten: minutesFromMarkdown(brief.body),
  }));
}

/** Text zu HTML, wie es auf die Seite kommt. */
export async function textHtml(markdown: string): Promise<string> {
  return publishHtml(await markdownToHtml(markdown));
}

/** Eine Seite, fertig gesetzt: aus den Feldern ihrer Vorlage, oder aus ihrem Text. */
async function ansicht(doc: ContentDocument, teasers: Teaser[], page?: number): Promise<PageView> {
  if (doc.vorlage && doc.felder) return renderSeite({ ...doc, vorlage: doc.vorlage, felder: doc.felder, teasers, page }, textHtml);
  return renderDocument({ ...doc, html: await textHtml(doc.body), teasers, page });
}

async function writeDocument(site: string, doc: ContentDocument, teasers: Teaser[]): Promise<void> {
  if (doc.vorlage === "neuigkeiten") {
    const pages = Math.max(1, Math.ceil(teasers.length / 10));
    await fs.rm(path.join(site, publicPath(doc.rel).replace(/^\//, ""), "page"), { recursive: true, force: true });
    for (let page = 1; page <= pages; page += 1) {
      const view = await ansicht(doc, teasers, page);
      await writePage(site, view.here, pageShell(view));
    }
    return;
  }
  const view = await ansicht(doc, teasers);
  await writePage(site, view.here, pageShell(view));
}

/** Sitemap und robots.txt. Billig genug, um sie bei jeder Änderung ganz neu zu schreiben. */
async function writeIndexFiles(site: string, docs: ContentDocument[]): Promise<void> {
  const briefs = briefsNewestFirst(docs);
  const newest = briefs[0]?.datum ?? "";
  // Ohne Inhalts-Git (Tests, ein frischer Ordner) bleibt das, was sich ohne Git sagen lässt.
  const geaendert = await letzteAenderungen().catch((error: unknown) => {
    console.error("Sitemap ohne Änderungsdaten:", error instanceof Error ? error.message : error);
    return new Map<string, string>();
  });
  const entries: SitemapEntry[] = [];
  for (const doc of docs) {
    const href = publicPath(doc.rel);
    entries.push({ href, lastmod: sitemapDatum(doc, geaendert.get(doc.rel) ?? "", newest) });
    if (doc.rel === "kapitel/neuigkeiten.md") {
      const pages = Math.ceil(briefs.length / 10);
      for (let page = 2; page <= pages; page += 1) entries.push({ href: `${href}/page/${page}`, lastmod: "" });
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
  return ansicht(doc, teasers);
}

export async function buildSite(): Promise<{ pages: number; index: string }> {
  const docs = await publishedDocuments();
  const briefs = briefsNewestFirst(docs);
  const teasers = teasersFor(briefs);
  const site = siteDir();
  await fs.mkdir(site, { recursive: true });
  // Der Ordner wird nicht vorher geleert: Die Website bleibt online, auch wenn das Setzen scheitert.
  // Die Bildfassungen bleiben stehen: sie neu zu rechnen kostet beim Start eine halbe Minute.
  const media = path.join(contentDir(), "media");
  try {
    await copyMediaDir(media, path.join(site, "media"));
  } catch {
    // Noch keine Bilder.
  }
  const bilder = new Set(await fs.readdir(media).catch(() => [] as string[]));
  await pruneVariants(path.join(site, "media"), bilder);
  for (const name of await fs.readdir(path.join(site, "media")).catch(() => [] as string[])) {
    if (name !== VARIANT_DIR && !bilder.has(name)) await fs.rm(path.join(site, "media", name), { recursive: true, force: true });
  }
  await copyAssets();

  gesetzteAdressen = adressStempel();
  gesetzteAngaben = JSON.stringify(allgemein());
  gesetzteReihe = briefReihe(teasers);
  let index = "Willkommen";
  gesetzt = new Set(["media", "fonts", "brand", "heft.css", "site.js", "sitemap.xml", "robots.txt", "status.json"]);
  try {
    for (const doc of docs) {
      await writeDocument(site, doc, teasers);
      if (doc.rel === "kapitel/willkommen.md") index = doc.titel;
    }
    await writeIndexFiles(site, docs);
    for (const name of await fs.readdir(site)) {
      if (!gesetzt.has(name)) await fs.rm(path.join(site, name), { recursive: true, force: true });
    }
  } finally {
    gesetzt = null;
  }
  return { pages: docs.length, index };
}

/** Reihenfolge, Adressen und Titel der Newsletter beim letzten Setzen (für «Vorheriger/Nächster»). */
let gesetzteReihe: string | null = null;

function briefReihe(teasers: Teaser[]): string {
  return JSON.stringify(teasers.map((teaser) => [teaser.href, teaser.titel]));
}

/** Die Adressen beim letzten Setzen. Ändert sich eine, stimmen Menü und Links auf allen Seiten nicht mehr. */
let gesetzteAdressen: string | null = null;

/** Die allgemeinen Angaben beim letzten Setzen. Sie stehen im Fuss jeder Seite: Ändern sie sich, alle neu. */
let gesetzteAngaben: string | null = null;

/** Eine Seite, die nicht mehr online ist, von der Website nehmen. Die Startseite bleibt immer. */
async function entferne(site: string, rel: string): Promise<void> {
  const href = publicPath(rel);
  if (href !== "/") await fs.rm(path.join(site, href.replace(/^\//, "")), { recursive: true, force: true });
}

/**
 * Baut nur die geänderten Seiten neu. Ein Brief erneuert auch Startseite und Archiv.
 * Hat eine Seite eine neue Adresse, werden alle neu gesetzt und die Ordner unter den alten Adressen gelöscht.
 * Neue allgemeine Angaben setzen ebenfalls alle Seiten neu.
 */
export async function rebuildDocuments(rels: string[]): Promise<void> {
  const docs = await publishedDocuments();
  const teasers = teasersFor(briefsNewestFirst(docs));
  const site = siteDir();
  await fs.mkdir(site, { recursive: true });
  await copyAssets();
  const stempel = adressStempel();
  const angaben = JSON.stringify(allgemein());
  const angabenNeu = gesetzteAngaben !== null && gesetzteAngaben !== angaben;
  gesetzteAngaben = angaben;
  if ((gesetzteAdressen !== null && gesetzteAdressen !== stempel) || angabenNeu) {
    gesetzteAdressen = stempel;
    for (const alt of alteAdressen()) {
      if (alt !== "/" && !adresseReserviert(alt)) await fs.rm(path.join(site, alt.replace(/^\//, "")), { recursive: true, force: true });
    }
    // Zieht Patrick eine Seite im Menü zurück, kommt sie nur hier vorbei: Sie muss trotzdem weg.
    for (const rel of rels) if (!docs.some((doc) => doc.rel === rel)) await entferne(site, rel);
    for (const doc of docs) await writeDocument(site, doc, teasers);
    await writeIndexFiles(site, docs);
    return;
  }
  gesetzteAdressen = stempel;
  const wanted = new Set(rels);
  if (rels.some((rel) => rel.startsWith("briefe/"))) {
    wanted.add("kapitel/willkommen.md");
    wanted.add("kapitel/neuigkeiten.md");
    // Jeder Newsletter verlinkt den vorherigen und den nächsten. Kommt einer dazu, fällt einer weg
    // oder ändert sich ein Titel, stimmen diese Links bei den Nachbarn nicht mehr: dann alle neu.
    const reihe = briefReihe(teasers);
    if (gesetzteReihe !== null && gesetzteReihe !== reihe) {
      for (const doc of docs) if (doc.rel.startsWith("briefe/")) wanted.add(doc.rel);
    }
    gesetzteReihe = reihe;
  }

  for (const rel of wanted) {
    const doc = docs.find((item) => item.rel === rel);
    if (!doc) {
      await entferne(site, rel);
      continue;
    }
    await writeDocument(site, doc, teasers);
  }
  await writeIndexFiles(site, docs);
}
