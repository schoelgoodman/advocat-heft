import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import sharp from "sharp";
import { leseAnhang, listWuensche, neuerWunsch, raeumeAnhaenge, speichereAnhang } from "./wuensche.ts";

let ordner = "";
const vorher = { chat: process.env.CHAT_DIR, token: process.env.TELEGRAM_BOT_TOKEN };

before(async () => {
  ordner = await fs.mkdtemp(path.join(os.tmpdir(), "advocat-wuensche-"));
  process.env.CHAT_DIR = ordner;
  // Kein Test schreibt an Telegram.
  process.env.TELEGRAM_BOT_TOKEN = "";
});

after(async () => {
  if (vorher.chat === undefined) delete process.env.CHAT_DIR;
  else process.env.CHAT_DIR = vorher.chat;
  if (vorher.token === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
  else process.env.TELEGRAM_BOT_TOKEN = vorher.token;
  await fs.rm(ordner, { recursive: true, force: true });
});

const PDF = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n");

test("Anhang: Ein Foto verliert seine Metadaten, ein PDF bleibt, wie es ist", async () => {
  const foto = await sharp({ create: { width: 20, height: 20, channels: 3, background: "#884422" } }).withExif({ IFD0: { Copyright: "Geheimer Ort" } }).jpeg().toBuffer();
  const bild = await speichereAnhang(foto, "IMG_0001.JPEG");
  assert.match(bild.id, /^[a-f0-9]{16}\.jpg$/);
  assert.equal(bild.typ, "image/jpeg");
  assert.equal(bild.name, "IMG_0001.JPEG");
  assert.ok(!(await leseAnhang(bild.id)).daten.includes("Geheimer Ort"));

  const pdf = await speichereAnhang(PDF, "../../etc/Vertrag.pdf");
  assert.equal(pdf.typ, "application/pdf");
  assert.equal(pdf.name, "Vertrag.pdf");
  assert.deepEqual((await leseAnhang(pdf.id)).daten, PDF);
});

test("Anhang: Was es ist, entscheiden die Bytes, nicht der Name", async () => {
  await assert.rejects(speichereAnhang(Buffer.from("<html><script>alert(1)</script></html>"), "bild.png"), /Nur Bilder/);
  await assert.rejects(speichereAnhang(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), "bild.svg"), /Nur Bilder/);
  await assert.rejects(speichereAnhang(Buffer.alloc(10 * 1024 * 1024 + 1), "gross.pdf"), /zu gross/);
  await assert.rejects(leseAnhang("../wuensche.json"), /Unbekannter Anhang/);
  // Ein PNG, das sich .pdf nennt, bleibt ein PNG.
  const png = await sharp({ create: { width: 4, height: 4, channels: 3, background: "#fff" } }).png().toBuffer();
  assert.equal((await speichereAnhang(png, "bildschirmfoto.pdf")).name, "bildschirmfoto.png");
});

test("Wunsch: Anhänge bleiben am Eintrag, erfundene nicht", async () => {
  const pdf = await speichereAnhang(PDF, "Beleg.pdf");
  const wunsch = await neuerWunsch({ art: "fehler", text: "Der Knopf fehlt.", anhaenge: [{ id: pdf.id, name: "Beleg.pdf" }, { id: pdf.id }, { id: "../wuensche.json" }] });
  assert.equal(wunsch.telegram, "aus");
  assert.deepEqual(wunsch.anhaenge, [{ id: pdf.id, name: "Beleg.pdf", typ: "application/pdf", groesse: PDF.length }]);
  assert.deepEqual((await listWuensche())[0]?.anhaenge, wunsch.anhaenge);
  await assert.rejects(neuerWunsch({ text: "x", anhaenge: [{ id: "0123456789abcdef.pdf" }] }), /nicht mehr da/);
  await assert.rejects(neuerWunsch({ text: "x", anhaenge: Array.from({ length: 6 }, () => ({ id: pdf.id })) }), /Höchstens 5/);
});

test("Anhang: Nie Gesendetes verschwindet nach einem Tag, Gesendetes bleibt", async () => {
  const gesendet = await speichereAnhang(PDF, "bleibt.pdf");
  await neuerWunsch({ text: "Mit Anhang.", anhaenge: [gesendet] });
  const verwaist = await speichereAnhang(PDF, "verwaist.pdf");
  assert.equal(await raeumeAnhaenge(), 0);
  const weg = await raeumeAnhaenge(Date.now() + 25 * 60 * 60 * 1000);
  assert.ok(weg >= 1);
  await assert.rejects(leseAnhang(verwaist.id), /Unbekannter Anhang/);
  assert.equal((await leseAnhang(gesendet.id)).name, "bleibt.pdf");
});

test("Telegram: erst der Text, dann ein Foto als Foto und ein PDF als Dokument", async () => {
  const echt = globalThis.fetch;
  const rufe: { weg: string; feld: string; name: string; text: string }[] = [];
  process.env.TELEGRAM_BOT_TOKEN = "123:test";
  process.env.TELEGRAM_CHAT_ID = "42";
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const weg = String(url).split("/").pop()!;
    if (init?.body instanceof FormData) {
      const feld = init.body.has("photo") ? "photo" : "document";
      rufe.push({ weg, feld, name: (init.body.get(feld) as File).name, text: String(init.body.get("caption")) });
    } else rufe.push({ weg, feld: "", name: "", text: (JSON.parse(String(init?.body)) as { text: string }).text });
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  try {
    const foto = await speichereAnhang(await sharp({ create: { width: 8, height: 8, channels: 3, background: "#123" } }).jpeg().toBuffer(), "foto.jpg");
    const pdf = await speichereAnhang(PDF, "Beleg.pdf");
    const wunsch = await neuerWunsch({ art: "fehler", text: "Siehe Anhang.", anhaenge: [foto, pdf] });
    assert.equal(wunsch.telegram, "gesendet");
    assert.deepEqual(rufe.map((r) => [r.weg, r.feld, r.name]), [["sendMessage", "", ""], ["sendPhoto", "photo", "foto.jpg"], ["sendDocument", "document", "Beleg.pdf"]]);
    assert.match(rufe[0]!.text, /2 Anhänge folgen\./);
    assert.match(rufe[2]!.text, new RegExp(`^${wunsch.id} · Anhang 2 von 2: Beleg\\.pdf$`));
  } finally {
    globalThis.fetch = echt;
    process.env.TELEGRAM_BOT_TOKEN = "";
    delete process.env.TELEGRAM_CHAT_ID;
  }
});
