import sharp from "sharp";

/**
 * Hochgeladene Bilder. Was eine Datei ist, entscheiden ihre ersten Bytes, nie ihr Name. JPEG, PNG und
 * WebP gehen einmal durch sharp: Das wirft Metadaten (GPS!) und alles hinter den Bilddaten weg.
 * Ein SVG kann Skript enthalten und wird darum zu einem PNG.
 */

export const MAX_BILD = 20 * 1024 * 1024;
/** Ein Bild mit 50 Megapixeln belegt beim Entpacken schon gegen 200 MB. Mehr bringt auch die Website nicht. */
const MAX_PIXEL = 50_000_000;
const MAX_KANTE = 2560;

export type BildArt = "jpeg" | "png" | "gif" | "webp" | "svg" | "heic";

export function bildArt(b: Buffer): BildArt | null {
  if (b.length < 12) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (b.subarray(0, 4).toString("latin1") === "GIF8") return "gif";
  if (b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP") return "webp";
  if (b.subarray(4, 8).toString("latin1") === "ftyp" && ["heic", "heix", "mif1", "msf1", "hevc"].includes(b.subarray(8, 12).toString("latin1"))) return "heic";
  const kopf = b.subarray(0, 512).toString("utf8").replace(/^﻿/, "").trimStart();
  if (/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE svg[^>]*>\s*)?<svg[\s>]/i.test(kopf)) return "svg";
  return null;
}

export interface FertigesBild {
  endung: string;
  daten: Buffer;
}

/** Wirft mit einer Meldung für Patrick, wenn die Datei kein brauchbares Bild ist. */
export async function verarbeiteBild(daten: Buffer): Promise<FertigesBild> {
  if (daten.length > MAX_BILD) throw new Error("Das Bild ist zu gross (höchstens 20 MB).");
  const art = bildArt(daten);
  if (art === "heic") throw new Error("HEIC-Fotos (iPhone) bitte als JPG speichern.");
  if (!art) throw new Error("Nur Bilder (PNG, JPG, GIF, WebP, SVG).");
  // Ein animiertes GIF verlöre seine Bewegung. Metadaten trägt es kaum.
  if (art === "gif") return { endung: ".gif", daten };
  try {
    const optionen = { limitInputPixels: MAX_PIXEL, failOn: "error" as const };
    if (art === "svg") {
      const png = await sharp(daten, { ...optionen, density: 300 }).resize({ width: 1600, height: 1600, fit: "inside" }).png({ compressionLevel: 9 }).toBuffer();
      return { endung: ".png", daten: png };
    }
    const bild = sharp(daten, optionen).rotate().resize({ width: MAX_KANTE, height: MAX_KANTE, fit: "inside", withoutEnlargement: true });
    if (art === "png") return { endung: ".png", daten: await bild.png({ compressionLevel: 9 }).toBuffer() };
    if (art === "webp") return { endung: ".webp", daten: await bild.webp({ quality: 88 }).toBuffer() };
    return { endung: ".jpg", daten: await bild.jpeg({ quality: 88, mozjpeg: true }).toBuffer() };
  } catch {
    throw new Error("Das Bild liess sich nicht lesen. Ist die Datei beschädigt oder zu gross?");
  }
}
