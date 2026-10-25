import fs from "node:fs/promises";
import path from "node:path";
import { parseDocument } from "../content/document.ts";
import { contentDir } from "../paths.ts";
import { markdownToHtml } from "./crepe.ts";

export interface RenderedBody {
  html: string;
  rel: string;
}

/** Liest eine Datei nur aus CONTENT_DIR und lässt Milkdown das HTML schreiben. */
export async function renderFile(rel: string): Promise<RenderedBody> {
  const safe = path.normalize(rel).replaceAll("\\", "/");
  if (safe.startsWith("..") || path.isAbsolute(safe)) {
    throw new Error(`Pfad liegt ausserhalb des Inhalts: ${rel}`);
  }
  const file = path.join(contentDir(), safe);
  const raw = await fs.readFile(file, "utf8");
  const doc = parseDocument(raw, safe);
  const html = await markdownToHtml(doc.body);
  return { html, rel: safe };
}
