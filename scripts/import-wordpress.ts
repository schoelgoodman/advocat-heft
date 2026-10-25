/**
 * Einmalige Übernahme von advocat-finanz.ch nach CONTENT_DIR.
 * Schreibt nur in den Inhaltsordner, nie ins Code-Repo.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { Window } from "happy-dom";
import { contentDir } from "../src/paths.ts";
import { serializeDocument, type Art, type ContentDocument } from "../src/content/document.ts";

const ORIGIN = "https://advocat-finanz.ch";
const API = `${ORIGIN}/wp-json/wp/v2`;

const PAGE_TARGETS: Record<string, { art: Art; file: string; titel?: string }> = {
  home: { art: "kapitel", file: "kapitel/willkommen.md", titel: "Willkommen" },
  "ueber-uns": { art: "kapitel", file: "kapitel/ueber-uns.md" },
  angebot: { art: "kapitel", file: "kapitel/angebot.md" },
  privatpersonen: { art: "kapitel", file: "kapitel/privatpersonen.md" },
  "unternehmen-2": { art: "kapitel", file: "kapitel/unternehmen.md" },
  "stiftungen-2": { art: "kapitel", file: "kapitel/stiftungen.md" },
  neuigkeiten: { art: "kapitel", file: "kapitel/neuigkeiten.md" },
  kontakt: { art: "kapitel", file: "kapitel/kontakt.md" },
  faq: { art: "kapitel", file: "kapitel/faq.md" },
  impressum: { art: "recht", file: "recht/impressum.md" },
  disclaimer: { art: "recht", file: "recht/disclaimer.md" },
  datenschutz: { art: "recht", file: "recht/datenschutz.md" },
};

const SLUG_TO_PATH: Record<string, string> = {
  "": "/",
  home: "/",
  "ueber-uns": "/ueber-uns",
  angebot: "/angebot",
  privatpersonen: "/privatpersonen",
  "unternehmen-2": "/unternehmen",
  unternehmen: "/unternehmen",
  "stiftungen-2": "/stiftungen",
  stiftungen: "/stiftungen",
  neuigkeiten: "/neuigkeiten",
  kontakt: "/kontakt",
  faq: "/faq",
  impressum: "/impressum",
  disclaimer: "/disclaimer",
  datenschutz: "/datenschutz",
  willkommen: "/willkommen",
};

const CONTAINERS = new Set([
  "et_pb_section",
  "et_pb_row",
  "et_pb_column",
  "et_pb_accordion",
  "et_pb_blog",
  "et_pb_contact_form",
  "et_pb_contact_field",
]);

interface WpItem {
  id: number;
  slug: string;
  date: string;
  link: string;
  title: { rendered: string };
  content: { rendered: string };
}

const mediaNames = new Map<string, string>();

async function wpGet<T>(pathname: string): Promise<T> {
  const response = await fetch(`${API}${pathname}`, {
    headers: { "user-agent": "advocat-heft-import" },
  });
  if (!response.ok) {
    throw new Error(`${pathname} → ${response.status}`);
  }
  return (await response.json()) as T;
}

async function allPosts(): Promise<WpItem[]> {
  const posts: WpItem[] = [];
  for (let page = 1; page < 20; page += 1) {
    const batch = await wpGet<WpItem[]>(`/posts?per_page=100&page=${page}&_fields=id,slug,date,link,title,content`);
    posts.push(...batch);
    if (batch.length < 100) break;
  }
  return posts;
}

function decodeText(value: string): string {
  const window = new Window();
  const node = window.document.createElement("textarea");
  node.innerHTML = value;
  const text = node.value.replace(/<[^>]+>/g, "");
  window.happyDOM.abort();
  return text.replace(/\s+/g, " ").trim();
}

function decodeEntities(raw: string): string {
  const named: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
    hellip: "…",
    mdash: "—",
    ndash: "–",
    laquo: "«",
    raquo: "»",
  };
  return raw.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (entity, body: string) => {
    if (body.startsWith("#")) {
      const code = body[1] === "x" || body[1] === "X" ? Number.parseInt(body.slice(2), 16) : Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : entity;
    }
    return named[body] ?? entity;
  });
}

function normalizeShortcodes(raw: string): string {
  return decodeEntities(raw)
    .replaceAll("\u201c", '"')
    .replaceAll("\u201d", '"')
    .replaceAll("\u201e", '"')
    .replaceAll("\u2033", '"');
}

function parseAttrs(source: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const match of source.matchAll(/([A-Za-z0-9_]+)="([^"]*)"/g)) {
    attrs[match[1]] = match[2];
  }
  return attrs;
}

function htmlToMarkdown(html: string): string {
  const window = new Window();
  const root = window.document.createElement("div");
  root.innerHTML = html;
  const parts: string[] = [];

  const inline = (node: ReturnType<Window["document"]["createTextNode"]> | ElementLike): string => {
    if (node.nodeType === 3) {
      return (node.textContent ?? "").replaceAll("\u00a0", " ").replaceAll("\u200d", "").replaceAll("\u200b", "");
    }
    if (node.nodeType !== 1) return "";
    const el = node as ElementLike;
    const tag = el.tagName.toLowerCase();
    const inner = () => [...el.childNodes].map((child) => inline(child as ElementLike)).join("");
    if (tag === "br") return "\n";
    if (tag === "strong" || tag === "b") {
      const text = inner().trim();
      return text ? `**${text}**` : "";
    }
    if (tag === "em" || tag === "i") {
      const text = inner().trim();
      return text ? `*${text}*` : "";
    }
    if (tag === "a") {
      const href = el.getAttribute("href") ?? "";
      const text = collapse(inner()) || href;
      return href ? `[${text}](${href})` : text;
    }
    if (tag === "img") return "";
    return inner();
  };

  const block = (node: ElementLike): string => {
    if (node.nodeType === 3) {
      const text = collapse(node.textContent ?? "");
      return text ? `${text}\n\n` : "";
    }
    if (node.nodeType !== 1) return "";
    const tag = node.tagName.toLowerCase();
    const children = () => [...node.childNodes].map((child) => block(child as ElementLike)).join("");
    if (tag === "script" || tag === "style") return "";
    if (tag === "p") {
      const text = collapse(inline(node));
      return text ? `${text}\n\n` : "";
    }
    if (/^h[1-6]$/.test(tag)) {
      const level = Number(tag[1]);
      const text = collapse(inline(node)).replace(/^\*\*(.+)\*\*$/u, "$1");
      return text ? `${"#".repeat(level)} ${text}\n\n` : "";
    }
    if (tag === "figure" || tag === "img") {
      const img = tag === "img" ? node : node.querySelector("img");
      if (!img) return children();
      const src = img.getAttribute("src") ?? "";
      const caption = node.querySelector("figcaption");
      const alt = collapse(caption?.textContent || img.getAttribute("alt") || "");
      return src ? `![${alt}](${src})\n\n` : "";
    }
    if (tag === "ul" || tag === "ol") {
      const items = [...node.children].filter((child) => child.tagName.toLowerCase() === "li");
      return `${items
        .map((item, index) => {
          const marker = tag === "ol" ? `${index + 1}.` : "-";
          return `${marker} ${collapse(inline(item))}`;
        })
        .join("\n")}\n\n`;
    }
    if (tag === "blockquote") {
      const text = collapse(inline(node));
      return text
        ? `${text
            .split("\n")
            .map((line) => `> ${line}`)
            .join("\n")}\n\n`
        : "";
    }
    if (tag === "iframe") {
      const src = node.getAttribute("src") ?? "";
      return src ? `[Karte](${src})\n\n` : "";
    }
    return children();
  };

  for (const child of root.childNodes) parts.push(block(child as unknown as ElementLike));
  window.happyDOM.abort();
  return parts
    .join("")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

interface ElementLike {
  nodeType: number;
  tagName: string;
  textContent: string | null;
  childNodes: Iterable<ElementLike>;
  children: Iterable<ElementLike>;
  getAttribute(name: string): string | null;
  querySelector(selector: string): ElementLike | null;
}

function collapse(value: string): string {
  return value.replace(/[ \t]+\n/g, "\n").replace(/[ \t]{2,}/g, " ").replace(/\n{2,}/g, "\n").trim();
}

function diviToMarkdown(rawHtml: string): string {
  const raw = normalizeShortcodes(rawHtml);
  const parts: string[] = [];
  let index = 0;
  while (index < raw.length) {
    const open = raw.indexOf("[et_pb_", index);
    if (open === -1) break;
    const bracket = raw.indexOf("]", open);
    if (bracket === -1) break;
    const head = raw.slice(open + 1, bracket);
    const name = head.split(/\s/)[0] ?? "";
    const attrs = parseAttrs(head);
    if (CONTAINERS.has(name)) {
      if ((name === "et_pb_section" || name === "et_pb_column" || name === "et_pb_row") && attrs.background_image) {
        parts.push(`![](${attrs.background_image})`);
      }
      if (name === "et_pb_contact_form" && attrs.email) {
        parts.push(`Schreiben Sie an [${attrs.email}](mailto:${attrs.email}).`);
      }
      index = bracket + 1;
      continue;
    }
    const closeMark = `[/${name}]`;
    const close = raw.indexOf(closeMark, bracket);
    const inner = close === -1 ? "" : raw.slice(bracket + 1, close);
    index = close === -1 ? bracket + 1 : close + closeMark.length;
    if (name === "et_pb_heading" && attrs.title) {
      parts.push(`## ${decodeText(attrs.title)}`);
    } else if (name === "et_pb_accordion_item") {
      if (attrs.title) parts.push(`### ${decodeText(attrs.title)}`);
      const body = htmlToMarkdown(inner);
      if (body) parts.push(body);
    } else if (name === "et_pb_text" || name === "et_pb_code") {
      const body = htmlToMarkdown(inner);
      if (body) parts.push(body);
    } else if (name === "et_pb_image" && attrs.src) {
      const alt = decodeText(attrs.alt || attrs.title_text || "");
      parts.push(`![${alt}](${attrs.src})`);
    } else if (name === "et_pb_button" && attrs.button_text) {
      const label = decodeText(attrs.button_text);
      parts.push(attrs.button_url ? `[${label}](${attrs.button_url})` : label);
    }
  }
  return parts.join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
}

function rewriteDynamic(markdown: string, idToPath: Map<string, string>): string {
  return markdown.replace(/@ET-DC@([A-Za-z0-9+/=]+)@/g, (full, encoded: string) => {
    try {
      const payload = JSON.parse(Buffer.from(encoded, "base64").toString("utf8")) as {
        settings?: { post_id?: string };
      };
      const id = payload.settings?.post_id;
      return (id && idToPath.get(String(id))) || full;
    } catch {
      return full;
    }
  });
}

function rewriteLinks(markdown: string, postPaths: Map<string, string>): string {
  return markdown.replace(/\]\(([^)\s]+)\)/g, (_full, href: string) => {
    let url: URL | null = null;
    if (href.startsWith("/")) url = new URL(href, ORIGIN);
    else if (href.startsWith(ORIGIN)) url = new URL(href);
    if (!url) return `](${href})`;
    const slug = url.pathname.replace(/^\/|\/$/g, "");
    const mapped = SLUG_TO_PATH[slug] ?? postPaths.get(slug);
    if (!mapped) return `](${href})`;
    return `](${mapped}${url.hash})`;
  });
}

async function localizeAssets(markdown: string, mediaDir: string): Promise<string> {
  const urls = [...markdown.matchAll(/https?:\/\/advocat-finanz\.ch\/wp-content\/uploads\/[^\s)"']+/g)].map((match) =>
    match[0],
  );
  let result = markdown;
  for (const url of [...new Set(urls)]) {
    const local = await downloadMedia(url, mediaDir);
    result = result.replaceAll(url, local);
  }
  return result;
}

async function downloadMedia(url: string, mediaDir: string): Promise<string> {
  const known = mediaNames.get(url);
  if (known) return known;
  const clean = url.split("?")[0] ?? url;
  const base = decodeURIComponent(path.posix.basename(new URL(clean).pathname)).replace(/[^A-Za-z0-9._-]+/g, "-");
  let name = base || "bild";
  const taken = new Set(mediaNames.values());
  if (taken.has(`../media/${name}`)) {
    const ext = path.posix.extname(name);
    const stem = ext ? name.slice(0, -ext.length) : name;
    name = `${stem}-${mediaNames.size}${ext}`;
  }
  const target = path.join(mediaDir, name);
  if (!(await exists(target))) {
    const response = await fetch(url, { headers: { "user-agent": "advocat-heft-import" } });
    if (!response.ok) throw new Error(`Bild ${url} → ${response.status}`);
    await fs.writeFile(target, Buffer.from(await response.arrayBuffer()));
  }
  const rel = `../media/${name}`;
  mediaNames.set(url, rel);
  return rel;
}

async function exists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

function briefFile(nummer: number, slug: string): string {
  const safe = slug.replace(/[^a-z0-9-]+/gi, "-").replace(/^-|-$/g, "").slice(0, 80);
  return `briefe/${String(nummer).padStart(4, "0")}-${safe}.md`;
}

async function writeDoc(dir: string, doc: ContentDocument): Promise<void> {
  const file = path.join(dir, doc.rel);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, serializeDocument(doc), "utf8");
}

async function main(): Promise<void> {
  const dir = contentDir();
  const mediaDir = path.join(dir, "media");
  await fs.mkdir(mediaDir, { recursive: true });
  await fs.mkdir(path.join(dir, "briefe"), { recursive: true });
  await fs.mkdir(path.join(dir, "kapitel"), { recursive: true });
  await fs.mkdir(path.join(dir, "recht"), { recursive: true });

  const posts = await allPosts();
  const pages = await wpGet<WpItem[]>("/pages?per_page=100&_fields=id,slug,date,link,title,content");
  const postPaths = new Map<string, string>();
  const idToPath = new Map<string, string>();
  for (const page of pages) {
    const target = PAGE_TARGETS[page.slug];
    if (!target) continue;
    const base = target.file.split("/").at(-1)?.replace(/\.md$/, "") ?? "";
    idToPath.set(String(page.id), base === "willkommen" ? "/" : `/${base}`);
  }
  for (const post of posts) {
    const title = decodeText(post.title.rendered);
    const nummerMatch = title.match(/Newsletter\s+(\d+)/i);
    const nummer = nummerMatch ? Number(nummerMatch[1]) : null;
    const rel = briefFile(nummer ?? 0, post.slug);
    postPaths.set(post.slug, `/${rel.slice(0, -3)}`);
    idToPath.set(String(post.id), `/${rel.slice(0, -3)}`);
  }

  const finish = (markdown: string): string => rewriteLinks(rewriteDynamic(markdown, idToPath), postPaths);

  const briefDocs: ContentDocument[] = [];
  for (const post of posts) {
    const title = decodeText(post.title.rendered);
    const nummerMatch = title.match(/Newsletter\s+(\d+)/i);
    const nummer = nummerMatch ? Number(nummerMatch[1]) : null;
    const rel = briefFile(nummer ?? 0, post.slug);
    let body = finish(htmlToMarkdown(post.content.rendered));
    body = await localizeAssets(body, mediaDir);
    briefDocs.push({
      rel,
      datum: post.date.slice(0, 10),
      art: "brief",
      titel: title,
      nummer,
      entwurf: false,
      body,
    });
  }
  for (const doc of briefDocs) {
    doc.body = finish(doc.body);
    await writeDoc(dir, doc);
  }

  for (const page of pages) {
    const target = PAGE_TARGETS[page.slug];
    if (!target) {
      console.warn(`Überspringe unbekannte Seite ${page.slug}`);
      continue;
    }
    let body = finish(diviToMarkdown(page.content.rendered));
    body = await localizeAssets(body, mediaDir);
    const doc: ContentDocument = {
      rel: target.file,
      datum: page.date.slice(0, 10),
      art: target.art,
      titel: target.titel ?? decodeText(page.title.rendered),
      nummer: null,
      entwurf: false,
      body,
    };
    await writeDoc(dir, doc);
    console.log(`${page.slug} → ${target.file} (${doc.body.length} Zeichen)`);
  }

  const shortcodes = await findShortcodes(dir);
  console.log(`Briefe: ${briefDocs.length}`);
  console.log(`Bilder: ${mediaNames.size}`);
  if (shortcodes.length) {
    console.error("Shortcode-Reste:");
    for (const hit of shortcodes) console.error(`  ${hit}`);
    process.exitCode = 1;
  }
}

async function findShortcodes(dir: string): Promise<string[]> {
  const hits: string[] = [];
  for (const folder of ["briefe", "kapitel", "recht"]) {
    for (const name of await fs.readdir(path.join(dir, folder))) {
      if (!name.endsWith(".md")) continue;
      const text = await fs.readFile(path.join(dir, folder, name), "utf8");
      if (text.includes("[et_pb_") || text.includes("@ET-DC@")) hits.push(`${folder}/${name}`);
    }
  }
  return hits;
}

await main();
