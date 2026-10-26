import fs from "node:fs/promises";
import path from "node:path";
import { parseDocument, publicPath, type ContentDocument } from "./document.ts";
import { contentDir } from "../paths.ts";

const FOLDERS = ["briefe", "kapitel", "recht"] as const;

const REGISTER_ORDER = [
  "kapitel/willkommen.md",
  "kapitel/ueber-uns.md",
  "kapitel/angebot.md",
  "kapitel/privatpersonen.md",
  "kapitel/unternehmen.md",
  "kapitel/stiftungen.md",
  "kapitel/neuigkeiten.md",
  "kapitel/faq.md",
  "kapitel/kontakt.md",
] as const;

const REGISTER_LABELS: Record<(typeof REGISTER_ORDER)[number], string> = {
  "kapitel/willkommen.md": "Willkommen",
  "kapitel/ueber-uns.md": "Über uns",
  "kapitel/angebot.md": "Angebot",
  "kapitel/privatpersonen.md": "Privatpersonen",
  "kapitel/unternehmen.md": "Unternehmen",
  "kapitel/stiftungen.md": "Stiftungen",
  "kapitel/neuigkeiten.md": "Neuigkeiten",
  "kapitel/faq.md": "FAQ",
  "kapitel/kontakt.md": "Kontakt",
};

/** Gelöschte Seiten liegen hier, mit ihrem alten Pfad darunter. Der Setzer sieht sie nicht. */
export const PAPIERKORB = "papierkorb";

async function loadFrom(prefix: string): Promise<ContentDocument[]> {
  const root = contentDir();
  const docs: ContentDocument[] = [];
  for (const folder of FOLDERS) {
    const dir = path.join(root, prefix, folder);
    let names: string[] = [];
    try {
      names = await fs.readdir(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      if (!name.endsWith(".md") || name === "README.md") continue;
      const rel = path.posix.join(prefix, folder, name);
      const raw = await fs.readFile(path.join(dir, name), "utf8");
      docs.push(parseDocument(raw, rel));
    }
  }
  return docs;
}

export async function loadDocuments(): Promise<ContentDocument[]> {
  return loadFrom("");
}

export async function loadPapierkorb(): Promise<ContentDocument[]> {
  return loadFrom(PAPIERKORB);
}

export function briefsNewestFirst(docs: ContentDocument[]): ContentDocument[] {
  return docs
    .filter((doc) => doc.art === "brief")
    .sort((a, b) => {
      const byDate = b.datum.localeCompare(a.datum);
      if (byDate !== 0) return byDate;
      return (b.nummer ?? 0) - (a.nummer ?? 0);
    });
}

export interface RegisterLink {
  href: string;
  label: string;
  rel: string;
}

export function registerLinks(docs: ContentDocument[]): RegisterLink[] {
  const byRel = new Map(docs.map((doc) => [doc.rel, doc]));
  const links: RegisterLink[] = [];
  for (const rel of REGISTER_ORDER) {
    const doc = byRel.get(rel);
    if (!doc) continue;
    links.push({ href: publicPath(rel), label: REGISTER_LABELS[rel], rel });
  }
  const known = new Set<string>(REGISTER_ORDER);
  const extra = docs
    .filter((doc) => doc.art === "kapitel" && !known.has(doc.rel))
    .sort((a, b) => a.titel.localeCompare(b.titel, "de"));
  for (const doc of extra) {
    links.push({ href: publicPath(doc.rel), label: doc.titel, rel: doc.rel });
  }
  return links;
}

/** Reihenfolge in der Redaktion: Newsletter, Entwürfe zuoberst, dann die Seiten wie im Register, zuletzt Recht. */
export function editorOrder(docs: ContentDocument[]): ContentDocument[] {
  const briefs = docs
    .filter((doc) => doc.art === "brief")
    .sort((a, b) => Number(b.entwurf) - Number(a.entwurf) || (b.nummer ?? 0) - (a.nummer ?? 0));
  const byRel = new Map(docs.map((doc) => [doc.rel, doc]));
  const kapitel = registerLinks(docs).flatMap((link) => byRel.get(link.rel) ?? []);
  const recht = docs
    .filter((doc) => doc.art === "recht")
    .sort((a, b) => a.titel.localeCompare(b.titel, "de"));
  return [...briefs, ...kapitel, ...recht];
}
