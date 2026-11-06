import assert from "node:assert/strict";
import { test } from "node:test";
import { klartextBloecke, liesAngebot, pruefeAngebot, schreibeAngebot } from "./angebot.ts";

const SEITE = `![](../media/bild.jpg)

## Für Beispiele

## Ein Einstieg

Erster Absatz mit **fett**.

Eine Frage:

- Punkt eins
- Punkt zwei
(mit Folgezeile)

[Kontaktieren sie uns](/kontakt)

## Erster Abschnitt

## Mit Untertitel

Text.

## Leistungen:

- Eins
- Zwei
Unterpunkt

## Zweiter Abschnitt

Nur Text.

- Liste im Text

Noch ein Absatz.

## Kontaktieren Sie uns.

Gerne.

[Kontaktieren sie uns](/kontakt)`;

test("Felder: eine Seite kommt Zeichen für Zeichen zurück", () => {
  const a = liesAngebot("Für Beispiele", SEITE)!;
  assert.equal(schreibeAngebot("Für Beispiele", a), SEITE);
  assert.equal(a.abschnitte.length, 2);
  assert.equal(a.abschnitte[0].untertitel, "Mit Untertitel");
  assert.deepEqual(a.abschnitte[0].leistungen, ["Eins", "Zwei\nUnterpunkt"]);
  assert.equal(a.abschnitte[1].leistungen.length, 0);
});

test("Felder: was nicht passt, bleibt beim freien Editor", () => {
  assert.equal(liesAngebot("Anderer Titel", SEITE), null);
  assert.equal(liesAngebot("Für Beispiele", `${SEITE}\n\nNach dem Band.`), null);
  assert.equal(liesAngebot("Für Beispiele", SEITE.replace("Nur Text.", "### Kleiner Titel")), null);
  assert.equal(liesAngebot("Für Beispiele", SEITE.replace("Nur Text.", "![Bild](x.png)")), null);
  assert.equal(liesAngebot("Für Beispiele", ""), null);
});

test("Prüfen: leere und reservierte Titel, Fremdes im Text", () => {
  const a = liesAngebot("Für Beispiele", SEITE)!;
  assert.deepEqual(pruefeAngebot("Für Beispiele", a), {});
  a.abschnitte[0].titel = "";
  a.abschnitte[1].titel = "Leistungen:";
  a.einstieg.text = "## Titel im Text";
  const fehler = pruefeAngebot("Für Beispiele", a);
  assert.ok(fehler["abschnitte.0.titel"]);
  assert.ok(fehler["abschnitte.1.titel"]);
  assert.ok(fehler["einstieg.text"]);
});

test("Klartext: je Absatz, Titel und Listenpunkt ein Stück, ohne Markdown", () => {
  const stuecke = klartextBloecke(SEITE);
  assert.ok(stuecke.includes("Erster Absatz mit fett."));
  assert.ok(stuecke.includes("Punkt zwei (mit Folgezeile)"));
  assert.ok(stuecke.includes("Für Beispiele"));
  assert.ok(!stuecke.some((s) => s.includes("bild.jpg")));
});
