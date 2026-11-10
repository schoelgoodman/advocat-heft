import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import sharp from "sharp";
import { mediaVariants, mediaVariantsAvif, publishMedia, VARIANT_DIR } from "./media.ts";

async function foto(breite: number): Promise<Buffer> {
  return sharp({ create: { width: breite, height: 300, channels: 3, background: "#864" } }).jpeg().toBuffer();
}

test("Foto: Jede Breite gibt es als AVIF und als Ersatz, getrennt aufgelistet", async (t) => {
  const ordner = await fs.mkdtemp(path.join(os.tmpdir(), "advocat-media-"));
  t.after(() => fs.rm(ordner, { recursive: true, force: true }));
  process.env.SITE_DIR = ordner;
  const quelle = path.join(ordner, "quelle.jpg");
  await fs.writeFile(quelle, await foto(1000));
  await publishMedia(quelle, path.join(ordner, "media", "bild.jpg"));
  const breiten = (liste: { width: number }[]) => liste.map((fassung) => fassung.width);
  assert.deepEqual(breiten(mediaVariants("/media/bild.jpg")), [480, 800, 1000]);
  assert.deepEqual(breiten(mediaVariantsAvif("/media/bild.jpg")), [480, 800, 1000]);
  assert.ok(mediaVariantsAvif("/media/bild.jpg").every((fassung) => fassung.url.endsWith(".avif")));
  assert.ok(mediaVariants("/media/bild.jpg").every((fassung) => !fassung.url.endsWith(".avif")));
});

test("Foto: Fassungen von vor AVIF werden einmal neu gerechnet, die alten fehlen nie", async (t) => {
  const ordner = await fs.mkdtemp(path.join(os.tmpdir(), "advocat-media-"));
  t.after(() => fs.rm(ordner, { recursive: true, force: true }));
  const klein = path.join(ordner, "media", VARIANT_DIR);
  await fs.mkdir(klein, { recursive: true });
  const quelle = path.join(ordner, "quelle.jpg");
  await fs.writeFile(quelle, await foto(600));
  await fs.writeFile(path.join(klein, "bild.jpg@480.jpg"), "alt");
  await fs.writeFile(path.join(klein, "bild.jpg@999.jpg"), "alte Breite");
  await publishMedia(quelle, path.join(ordner, "media", "bild.jpg"));
  const namen = await fs.readdir(klein);
  assert.ok(namen.includes("bild.jpg@480.avif"));
  assert.ok(!namen.includes("bild.jpg@999.jpg"));
  const nachher = (await fs.stat(path.join(klein, "bild.jpg@480.avif"))).mtimeMs;
  await publishMedia(quelle, path.join(ordner, "media", "bild.jpg"));
  assert.equal((await fs.stat(path.join(klein, "bild.jpg@480.avif"))).mtimeMs, nachher);
});
