import assert from "node:assert/strict";
import { test } from "node:test";
import { seitenBaum, seitenName, verschiebbar, type SeiteImBaum } from "./verzeichnis.ts";

const seite = (rel: string, titel: string, mehr: Partial<SeiteImBaum> = {}): SeiteImBaum => ({
  rel,
  titel,
  art: rel.startsWith("recht/") ? "recht" : rel.startsWith("briefe/") ? "brief" : "kapitel",
  entwurf: false,
  ...mehr,
});

const ALLE = [
  seite("briefe/0001-newsletter-1.md", "Newsletter 1"),
  seite("kapitel/kontakt.md", "Kontakt"),
  seite("kapitel/neuigkeiten.md", "Neuigkeiten"),
  seite("kapitel/stiftungen.md", "Für Stiftungen"),
  seite("kapitel/unternehmen.md", "Für Unternehmen"),
  seite("kapitel/privatpersonen.md", "Für Privatpersonen"),
  seite("kapitel/ueber-uns.md", "Über uns"),
  seite("kapitel/angebot.md", "Unser Angebot"),
  seite("kapitel/willkommen.md", "Willkommen"),
  seite("recht/datenschutz.md", "Datenschutz"),
  seite("recht/impressum.md", "Impressum"),
  seite("recht/disclaimer.md", "Disclaimer"),
];
const rels = (liste: { rel: string }[]) => liste.map((s) => s.rel);

test("Verzeichnis: Reihenfolge wie das Menü der Website, Angebote unter «Unser Angebot»", () => {
  const baum = seitenBaum(ALLE);
  assert.deepEqual(baum.menue.map((p) => p.seite.rel), ["kapitel/willkommen.md", "kapitel/angebot.md", "kapitel/ueber-uns.md", "kapitel/neuigkeiten.md", "kapitel/kontakt.md"]);
  assert.deepEqual(rels(baum.menue[1].unter), ["kapitel/privatpersonen.md", "kapitel/unternehmen.md", "kapitel/stiftungen.md"]);
  assert.deepEqual(baum.menue[0].unter, []);
});

test("Verzeichnis: Das Rechtliche wie im Fuss, Newsletter gehören nicht hierher", () => {
  const baum = seitenBaum(ALLE);
  assert.deepEqual(rels(baum.rechtliches), ["recht/impressum.md", "recht/disclaimer.md", "recht/datenschutz.md"]);
  assert.deepEqual(baum.weitere, []);
  assert.ok(!JSON.stringify(baum).includes("briefe/"));
});

test("Verzeichnis: Neue Seiten stehen dort, wo sie im Menü stehen werden, auch als Entwurf", () => {
  const baum = seitenBaum([
    ...ALLE,
    seite("kapitel/fuer-familien.md", "Für Familien", { menue: true }),
    seite("kapitel/entwurf.md", "Noch nicht online", { menue: true, entwurf: true }),
    seite("kapitel/ohne-menue.md", "Ohne Menü"),
    seite("kapitel/angebot-kopie.md", "Unser Angebot (Kopie)", { entwurf: true }),
  ]);
  assert.deepEqual(baum.menue.map((p) => p.seite.rel), ["kapitel/willkommen.md", "kapitel/angebot.md", "kapitel/ueber-uns.md", "kapitel/fuer-familien.md", "kapitel/entwurf.md", "kapitel/neuigkeiten.md", "kapitel/kontakt.md"]);
  assert.deepEqual(rels(baum.weitere), ["kapitel/ohne-menue.md", "kapitel/angebot-kopie.md"]);
});

test("Verzeichnis: Die gespeicherte Reihenfolge gilt, Home und Kontakt bleiben am Rand", () => {
  const familien = seite("kapitel/fuer-familien.md", "Für Familien", { menue: true });
  const baum = seitenBaum([...ALLE, familien], ["kapitel/neuigkeiten.md", "kapitel/fuer-familien.md", "kapitel/ueber-uns.md", "kapitel/angebot.md"]);
  assert.deepEqual(baum.menue.map((p) => p.seite.rel), ["kapitel/willkommen.md", "kapitel/neuigkeiten.md", "kapitel/fuer-familien.md", "kapitel/ueber-uns.md", "kapitel/angebot.md", "kapitel/kontakt.md"]);
  assert.deepEqual(verschiebbar(baum), ["kapitel/neuigkeiten.md", "kapitel/fuer-familien.md", "kapitel/ueber-uns.md", "kapitel/angebot.md"]);
  // Die Angebote wandern mit «Unser Angebot».
  assert.equal(baum.menue[4].unter.length, 3);
});

test("Verzeichnis: Eigene Seiten unter «Unser Angebot» stehen hinter den dreien", () => {
  const baum = seitenBaum([...ALLE, seite("kapitel/fuer-familien.md", "Für Familien", { menue: "angebot" })]);
  assert.deepEqual(rels(baum.menue[1].unter), ["kapitel/privatpersonen.md", "kapitel/unternehmen.md", "kapitel/stiftungen.md", "kapitel/fuer-familien.md"]);
  assert.ok(!baum.menue.some((p) => p.seite.rel === "kapitel/fuer-familien.md"));
  assert.deepEqual(baum.weitere, []);
});

test("Verzeichnis: Ohne «Unser Angebot» geht eine Seite darunter nicht verloren", () => {
  const baum = seitenBaum([...ALLE.filter((s) => s.rel !== "kapitel/angebot.md"), seite("kapitel/fuer-familien.md", "Für Familien", { menue: "angebot" })]);
  assert.ok(rels(baum.weitere).includes("kapitel/fuer-familien.md"));
});

test("Verzeichnis: Keine Seite fehlt und keine steht doppelt", () => {
  const baum = seitenBaum([...ALLE, seite("recht/agb.md", "AGB"), seite("kapitel/x.md", "X")]);
  const alle = [...baum.menue.flatMap((p) => [p.seite, ...p.unter]), ...baum.rechtliches, ...baum.weitere];
  assert.equal(alle.length, new Set(rels(alle)).size);
  assert.equal(alle.length, ALLE.length - 1 + 2);
});

test("Verzeichnis: Fehlt eine feste Seite, bleibt der Rest", () => {
  const baum = seitenBaum(ALLE.filter((s) => s.rel !== "kapitel/angebot.md" && s.rel !== "kapitel/privatpersonen.md"));
  assert.ok(!baum.menue.some((p) => p.seite.rel === "kapitel/angebot.md"));
  assert.deepEqual(rels(baum.weitere), ["kapitel/stiftungen.md", "kapitel/unternehmen.md"]);
});

test("Verzeichnis: Die Startseite heisst wie im Menü der Website", () => {
  assert.equal(seitenName(seite("kapitel/willkommen.md", "Willkommen")), "Home");
  assert.equal(seitenName(seite("kapitel/angebot.md", "Unser Angebot")), "Unser Angebot");
});

test("Verzeichnis: Eine Seite im Menü zeigt ihren Namen fürs Menü, sonst den Titel", () => {
  assert.equal(seitenName(seite("kapitel/x.md", "Langer Titel", { menue: true, menueName: "Kurz" })), "Kurz");
  assert.equal(seitenName(seite("kapitel/x.md", "Langer Titel", { menue: false, menueName: "Kurz" })), "Langer Titel");
});
