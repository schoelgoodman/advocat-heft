import assert from "node:assert/strict";
import { test } from "node:test";
import { menueBezeichnung, menueOrt, menueReihe } from "./menue.ts";

const ANGEBOT = "kapitel/angebot.md";
const UEBER = "kapitel/ueber-uns.md";
const NEWS = "kapitel/neuigkeiten.md";
const A = "kapitel/a.md";
const B = "kapitel/b.md";

test("Menü: Ohne gespeicherte Reihenfolge die Grundordnung, eigene Seiten vor Neuigkeiten", () => {
  assert.deepEqual(menueReihe([]), [ANGEBOT, UEBER, NEWS]);
  assert.deepEqual(menueReihe([A, B]), [ANGEBOT, UEBER, A, B, NEWS]);
});

test("Menü: Die gespeicherte Reihenfolge gilt", () => {
  assert.deepEqual(menueReihe([A], [NEWS, A, UEBER, ANGEBOT]), [NEWS, A, UEBER, ANGEBOT]);
});

test("Menü: Eine neue Seite kommt vor Neuigkeiten, auch wenn schon geordnet ist", () => {
  assert.deepEqual(menueReihe([A, B], [A, UEBER, NEWS, ANGEBOT]), [A, UEBER, B, NEWS, ANGEBOT]);
});

test("Menü: Gelöschte Seiten fallen weg, Doppeltes zählt einmal, Home und Kontakt bleiben draussen", () => {
  assert.deepEqual(
    menueReihe([], [UEBER, "kapitel/weg.md", UEBER, "kapitel/willkommen.md", "kapitel/kontakt.md", ANGEBOT, NEWS]),
    [UEBER, ANGEBOT, NEWS],
  );
});

test("Menü: Fehlt eine feste Seite in der Datei, kommt sie zurück", () => {
  assert.deepEqual(menueReihe([A], [A]), [ANGEBOT, UEBER, A, NEWS]);
});

test("Menü: Nur bekannte Orte zählen", () => {
  assert.equal(menueOrt(true), true);
  assert.equal(menueOrt("true"), true);
  assert.equal(menueOrt("angebot"), "angebot");
  for (const wert of [false, "", "irgendwo", null, undefined, 1]) assert.equal(menueOrt(wert), false);
});

test("Menü: Der eigene Name geht vor dem Titel, leer zählt nicht", () => {
  assert.equal(menueBezeichnung({ titel: "Ein langer Titel", menueName: "Kurz" }), "Kurz");
  assert.equal(menueBezeichnung({ titel: "Ein langer Titel", menueName: "  " }), "Ein langer Titel");
  assert.equal(menueBezeichnung({ titel: "Ein langer Titel" }), "Ein langer Titel");
});
