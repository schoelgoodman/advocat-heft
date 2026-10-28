import fs from "node:fs/promises";
import path from "node:path";

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
}
