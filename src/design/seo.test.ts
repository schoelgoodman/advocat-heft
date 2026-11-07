import assert from "node:assert/strict";
import { test } from "node:test";
import { letzteTage } from "../git/history.ts";
import { sitemapDatum } from "./seo.ts";

test("Sitemap: Newsletter nennt das spätere von Erscheinen und letzter Änderung", () => {
  const brief = { rel: "briefe/0035-newsletter-35.md", art: "brief", datum: "2026-10-01" };
  assert.equal(sitemapDatum(brief, "", "2026-10-01"), "2026-10-01");
  assert.equal(sitemapDatum(brief, "2026-11-03", "2026-10-01"), "2026-11-03");
});

test("Sitemap: feste Seite ohne belegte Änderung hat kein Datum", () => {
  const seite = { rel: "kapitel/kontakt.md", art: "kapitel", datum: "2025-10-02" };
  assert.equal(sitemapDatum(seite, "", "2026-10-01"), "");
  assert.equal(sitemapDatum(seite, "2026-11-03", "2026-10-01"), "2026-11-03");
});

test("Sitemap: Startseite und Neuigkeiten ändern sich mit dem neuesten Newsletter", () => {
  const start = { rel: "kapitel/willkommen.md", art: "kapitel", datum: "2025-10-02" };
  assert.equal(sitemapDatum(start, "", "2026-10-01"), "2026-10-01");
  assert.equal(sitemapDatum(start, "2026-11-03", "2026-10-01"), "2026-11-03");
});

test("Fassungen: der neueste Tag je Seite, Umstellungen über viele Seiten zählen nicht", () => {
  const umstellung = Array.from({ length: 6 }, (_, i) => `briefe/000${i}.md`).join("\n");
  const log = `\x1e2026-11-06\n\n${umstellung}\nkapitel/kontakt.md\n\x1e2026-11-03\n\nkapitel/kontakt.md\nmedia/a.jpg\n\x1e2026-11-01\n\nkapitel/kontakt.md\nbriefe/0001.md\n`;
  const tage = letzteTage(log);
  assert.equal(tage.get("kapitel/kontakt.md"), "2026-11-03");
  assert.equal(tage.get("briefe/0001.md"), "2026-11-01");
  assert.equal(tage.get("briefe/0002.md"), undefined);
  assert.equal(tage.has("media/a.jpg"), false);
});
