import { readdirSync, statSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { siteDir } from "../paths.ts";

/**
 * Bilder aus dem Inhalt kommen oft in Kameragrösse (1–2 MB). Die Seite liefert sie kleiner aus,
 * unter demselben Namen: Links im Markdown bleiben gleich, das Original im Inhalt auch.
 */

/** Breiter zeigt die Seite kein Bild, auch nicht als Titelbild auf einem grossen Bildschirm. */
const MAX_WIDTH = 2000;
/** Kleinere Dateien lohnen den Aufwand nicht. */
const MIN_BYTES = 150 * 1024;
const SHRINKABLE = new Set([".jpg", ".jpeg", ".png", ".webp"]);

type Sharp = typeof import("sharp");
let sharpLoad: Promise<Sharp | null> | null = null;

/** Fehlt sharp (z.B. kein passendes Binary), gehen die Originale raus. Die Seite läuft trotzdem. */
function loadSharp(): Promise<Sharp | null> {
  sharpLoad ??= import("sharp").then(
    (mod) => mod.default as Sharp,
    (error: unknown) => {
      console.error("Bilder bleiben in Originalgrösse, sharp fehlt:", error instanceof Error ? error.message : error);
      return null;
    },
  );
  return sharpLoad;
}

async function shrink(data: Buffer, ext: string): Promise<Buffer | null> {
  if (!SHRINKABLE.has(ext) || data.length < MIN_BYTES) return null;
  const sharp = await loadSharp();
  if (!sharp) return null;
  // .rotate() ohne Winkel dreht nach EXIF; die Metadaten fallen danach weg.
  let image = sharp(data, { failOn: "none" }).rotate().resize({ width: MAX_WIDTH, withoutEnlargement: true });
  if (ext === ".png") image = image.png({ compressionLevel: 9, effort: 7 });
  else if (ext === ".webp") image = image.webp({ quality: 80 });
  else image = image.jpeg({ quality: 72, progressive: true, mozjpeg: true });
  const out = await image.toBuffer();
  return out.length < data.length ? out : null;
}

/**
 * Fotos bekommen Fassungen in mehreren Breiten; der Browser nimmt die passende. Je Breite
 * WebP oder JPEG, was kleiner ist: bei feiner Rinde gewinnt oft JPEG.
 */
const VARIANT_WIDTHS = [480, 800, 1200, 1600, 2000];
const VARIANT_SOURCES = new Set([".jpg", ".jpeg", ".webp"]);
/** Unter `media/`, getrennt vom Inhalt: `<Name>@<Breite>.webp` bzw. `.jpg`. */
export const VARIANT_DIR = "_klein";

/** Die Fassungen bleiben zwischen den Starts liegen; neu nur, wenn das Bild neuer ist. */
async function variantsCurrent(from: string, to: string): Promise<boolean> {
  const dir = path.join(path.dirname(to), VARIANT_DIR);
  const prefix = `${path.basename(to)}@`;
  const names = (await fs.readdir(dir).catch(() => [] as string[])).filter((name) => name.startsWith(prefix));
  if (!names.length) return false;
  const source = (await fs.stat(from)).mtimeMs;
  for (const name of names) {
    if ((await fs.stat(path.join(dir, name))).mtimeMs < source) return false;
  }
  return true;
}

async function writeVariants(data: Buffer, ext: string, to: string): Promise<void> {
  if (!VARIANT_SOURCES.has(ext)) return;
  const sharp = await loadSharp();
  if (!sharp) return;
  const meta = await sharp(data, { failOn: "none" }).metadata();
  // EXIF 5–8 heisst hochkant gedreht; .rotate() tauscht dann Breite und Höhe.
  const width = (meta.orientation ?? 1) >= 5 ? meta.height ?? 0 : meta.width ?? 0;
  if (!width) return;
  const widths = VARIANT_WIDTHS.filter((w) => w < width);
  if (width <= MAX_WIDTH) widths.push(width);
  const dir = path.join(path.dirname(to), VARIANT_DIR);
  await fs.mkdir(dir, { recursive: true });
  // Alte Breiten weg, falls das Bild jetzt schmaler ist.
  for (const name of await fs.readdir(dir)) {
    if (name.startsWith(`${path.basename(to)}@`)) await fs.rm(path.join(dir, name), { force: true });
  }
  for (const w of widths) {
    const resized = sharp(data, { failOn: "none" }).rotate().resize({ width: w });
    const [webp, jpeg] = await Promise.all([
      resized.clone().webp({ quality: 66, effort: 4 }).toBuffer(),
      resized.clone().jpeg({ quality: 70, progressive: true, mozjpeg: true }).toBuffer(),
    ]);
    const [out, ext] = webp.length <= jpeg.length ? [webp, "webp"] : [jpeg, "jpg"];
    await fs.writeFile(path.join(dir, `${path.basename(to)}@${w}.${ext}`), out);
  }
}

/** Fassungen, deren Bild es im Inhalt nicht mehr gibt. */
export async function pruneVariants(mediaDir: string, sources: Set<string>): Promise<void> {
  const dir = path.join(mediaDir, VARIANT_DIR);
  for (const name of await fs.readdir(dir).catch(() => [] as string[])) {
    const at = name.lastIndexOf("@");
    if (at < 1 || !sources.has(name.slice(0, at))) await fs.rm(path.join(dir, name), { force: true });
  }
}

export interface Variant {
  url: string;
  width: number;
}

let manifest: { stamp: number; byName: Map<string, Variant[]> } | null = null;

/**
 * Die Fassungen zu einem Bild unter /media/, schmalste zuerst. Leer, wenn es keine gibt
 * (kein Foto, sharp fehlt, oder noch nicht geschrieben); dann bleibt das Original allein.
 */
export function mediaVariants(src: string): Variant[] {
  const match = /^\/media\/([^/?#]+)$/.exec(src);
  if (!match) return [];
  const dir = path.join(siteDir(), "media", VARIANT_DIR);
  let stamp = 0;
  try {
    stamp = statSync(dir).mtimeMs;
  } catch {
    return [];
  }
  if (!manifest || manifest.stamp !== stamp) {
    const byName = new Map<string, Variant[]>();
    for (const file of readdirSync(dir)) {
      const at = file.lastIndexOf("@");
      const width = Number(file.slice(at + 1).replace(/\.(webp|jpg)$/, ""));
      if (at < 1 || !width) continue;
      const name = file.slice(0, at);
      const list = byName.get(name) ?? [];
      list.push({ url: `/media/${VARIANT_DIR}/${encodeURIComponent(file).replaceAll("%40", "@")}`, width });
      byName.set(name, list);
    }
    for (const list of byName.values()) list.sort((a, b) => a.width - b.width);
    manifest = { stamp, byName };
  }
  return manifest.byName.get(decodeURIComponent(match[1])) ?? [];
}

/** Schreibt das Bild verkleinert nach `to`, oder unverändert, wenn das nichts bringt. */
export async function publishMedia(from: string, to: string): Promise<void> {
  const data = await fs.readFile(from);
  let out: Buffer = data;
  try {
    out = (await shrink(data, path.extname(from).toLowerCase())) ?? data;
  } catch (error) {
    console.error(`Bild ${path.basename(from)} bleibt, wie es ist:`, error instanceof Error ? error.message : error);
  }
  await fs.mkdir(path.dirname(to), { recursive: true });
  // Neu anlegen statt überschreiben: eine Datei aus dem Nix-Store wäre 0444.
  await fs.rm(to, { force: true });
  await fs.writeFile(to, out);
  try {
    if (!(await variantsCurrent(from, to))) await writeVariants(data, path.extname(from).toLowerCase(), to);
  } catch (error) {
    console.error(`Bild ${path.basename(from)} ohne kleinere Fassungen:`, error instanceof Error ? error.message : error);
  }
}
