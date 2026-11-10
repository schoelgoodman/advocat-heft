import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { renderDocument } from "../design/layout.ts";
import { pageShell } from "../design/page.ts";
import { repoRoot } from "../paths.ts";
import { textHtml } from "./build.ts";

/**
 * Der Satz als Vergleich mit einer abgelegten Fassung. Das HTML der Website schreibt Milkdown in
 * einer Browser-Attrappe (happy-dom): Ein Update von einem der beiden kann jede Seite still ändern.
 * Dieser Test zeigt es. Ist die Änderung gewollt: `AKTUALISIEREN=1 npm test`, dann den Unterschied
 * in tests/fixtures/satz/ ansehen und mit einchecken.
 */

const ordner = path.join(repoRoot, "tests/fixtures/satz");

async function vergleiche(name: string, ist: string): Promise<void> {
  const datei = path.join(ordner, name);
  if (process.env.AKTUALISIEREN) {
    await fs.writeFile(datei, ist, "utf8");
    return;
  }
  const soll = await fs.readFile(datei, "utf8").catch(() => null);
  assert.notEqual(soll, null, `${name} fehlt. Einmal mit AKTUALISIEREN=1 npm test anlegen.`);
  assert.equal(ist, soll, `${name} weicht ab. Gewollt? Dann AKTUALISIEREN=1 npm test und den Unterschied prüfen.`);
}

test("Satz: Markdown wird zum abgelegten HTML", async () => {
  const markdown = await fs.readFile(path.join(ordner, "newsletter.md"), "utf8");
  const html = await textHtml(markdown);
  // Unabhängig von der abgelegten Fassung: Das darf nie durchgehen.
  assert.ok(!/<b>HTML<\/b>/.test(html), "rohes HTML kommt als HTML heraus");
  assert.ok(!/href="javascript:/i.test(html), "javascript:-Link kommt durch");
  await vergleiche("newsletter.html", `${html}\n`);
});

test("Satz: Ein Newsletter wird zur abgelegten Seite", async () => {
  // Ein leerer Ordner als Website: keine Bildfassungen, keine Masse. Der Vergleich hängt so nicht an Bildern.
  process.env.SITE_DIR = await fs.mkdtemp(path.join(os.tmpdir(), "advocat-satz-"));
  process.env.CONTENT_DIR = process.env.SITE_DIR;
  process.env.SITE_URL = "https://beispiel.test";
  const markdown = await fs.readFile(path.join(ordner, "newsletter.md"), "utf8");
  const view = renderDocument({
    rel: "briefe/0007-newsletter-7-beispiel.md",
    art: "brief",
    titel: "Newsletter 7: Ein Beispiel für den Satz",
    datum: "2026-03-14",
    html: await textHtml(markdown),
    teasers: [
      { href: "/newsletter-8", titel: "Newsletter 8: Der nächste", datum: "2026-04-11", excerpt: "Auszug acht.", nummer: 8, minuten: 3 },
      { href: "/newsletter-7", titel: "Newsletter 7: Ein Beispiel für den Satz", datum: "2026-03-14", excerpt: "Auszug sieben.", nummer: 7, minuten: 2 },
      { href: "/newsletter-6", titel: "Newsletter 6: Der vorherige", datum: "2026-02-07", excerpt: "Auszug sechs.", nummer: 6, minuten: 4 },
    ],
  });
  // Das Jahr im Fuss ist das heutige.
  const seite = pageShell(view).replace(/©\d{4}/, "©JAHR");
  await vergleiche("newsletter-seite.html", seite);
});
