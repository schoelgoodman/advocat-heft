import assert from "node:assert/strict";
import { test } from "node:test";
import { mitFeldern, parseDocument, seiteMitNeuerAdresse, serializeDocument, textVon } from "./document.ts";
import { alsText, ausText, klartextBloecke, neueSeite, pruefeFelder, type AbschnitteFelder, type KontaktFelder, type Vorlage } from "./seiten.ts";

const BAND = `## Kontaktieren Sie uns.

Gerne.

[Kontaktieren sie uns](/kontakt)`;

const SEITEN: Record<Vorlage, [string, string]> = {
  abschnitte: ["Für Beispiele", `![](../media/bild.jpg)

## Für Beispiele

## Ein Einstieg

Erster Absatz mit **fett**.

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

${BAND}`],
  uebersicht: ["Übersicht", `![](../media/a.jpg)

## Übersicht

Ein Text.

![](../media/b.jpg)

### Für Privatpersonen

![](../media/c.jpg)

### Für Stiftungen

${BAND}`],
  start: ["Willkommen", `![](../media/a.jpg)

![Advocat Finanz Webclip](../media/z.png)

## Marke

## Claim

## Einstieg

Text.

![](../media/b.jpg)

### Für Unternehmen

[Zu unserem Angebot](/angebot)

## Unsere Neuigkeiten

[Mehr Neuigkeiten](/neuigkeiten)

${BAND}`],
  "ueber-uns": ["Über uns", `![](../media/a.jpg)

## Über uns

## Anknüpfung

Text.

[Kontaktieren sie uns](/kontakt)

## Ihr Sparringpartner

![Porträt](../media/p.jpg)

## Eine Person

**Jahrgang**: 1972

## Station eins

Text eins.

## Station zwei

Text zwei.

## Partner

## Firma

## Unterzeile

Über die Firma.

[![Logo](../media/l.png)](https://firma.example/)

${BAND}`],
  kontakt: ["Kontakt", `![](../media/a.jpg)

## Kontakt

## Aufnehmen

Wir sind da.

Schreiben Sie an [a@b.ch](mailto:a@b.ch).

## Standort

In der Stadt.

## Adresse

Firma
Strasse 1

## E-Mail

a@b.ch

## Telefon

+41 71 000 00 00

[Karte](https://www.google.com/maps/embed?pb=x)`],
  neuigkeiten: ["Neuigkeiten", `![](../media/a.jpg)

## Neuigkeiten

Unser Newsletter.

${BAND}`],
};

for (const [vorlage, [titel, text]] of Object.entries(SEITEN) as [Vorlage, [string, string]][]) {
  test(`Vorlage ${vorlage}: Text und Felder ergeben einander, die Felder sind gültig`, () => {
    const felder = ausText(vorlage, titel, text);
    assert.ok(felder, "Text passt nicht in die Felder");
    assert.equal(alsText(vorlage, titel, felder), text.replace("[Kontaktieren sie uns]", "[Kontaktieren Sie uns]").replace("[Kontaktieren sie uns]", "[Kontaktieren Sie uns]"));
    assert.deepEqual(pruefeFelder(vorlage, titel, felder), {});
  });
}

test("Was nicht in die Vorlage passt, bleibt Text", () => {
  const [titel, text] = SEITEN.abschnitte;
  assert.equal(ausText("abschnitte", "Anderer Titel", text), null);
  assert.equal(ausText("abschnitte", titel, `${text}\n\nNach dem Band.`), null);
  assert.equal(ausText("abschnitte", titel, text.replace("Nur Text.", "### Kleiner Titel")), null);
  assert.equal(ausText("abschnitte", titel, ""), null);
});

test("Datei: Felder kommen unverändert zurück, der Kopf bleibt lesbar", () => {
  const felder = ausText("abschnitte", "Für Beispiele", SEITEN.abschnitte[1])!;
  const doc = { rel: "kapitel/x.md", art: "kapitel" as const, titel: "Für Beispiele", datum: "2026-01-01", nummer: null, entwurf: true, adresse: "/neu", frueher: ["/alt"], menue: true, vorlage: "abschnitte" as const, felder, body: "" };
  const datei = serializeDocument(doc);
  assert.match(datei, /^vorlage: abschnitte$/m);
  const zurueck = parseDocument(datei, "kapitel/x.md");
  assert.deepEqual(zurueck.felder, felder);
  assert.equal(zurueck.titel, "Für Beispiele");
  assert.equal(zurueck.entwurf, true);
  assert.equal(zurueck.adresse, "/neu");
  assert.deepEqual(zurueck.frueher, ["/alt"]);
  assert.equal(zurueck.menue, true);
  assert.equal(zurueck.body, "");
});

test("Datei: Newsletter bleiben, wie sie sind", () => {
  const raw = `---\ndatum: 2026-01-01\nart: brief\ntitel: "Newsletter 1: Thema"\nnummer: 1\n---\n\nText.\n`;
  const doc = parseDocument(raw, "briefe/0001-newsletter-1-thema.md");
  assert.equal(doc.felder, null);
  assert.equal(doc.body, "Text.");
  assert.equal(serializeDocument(doc), raw);
});

test("Alte Fassung einer festen Seite bekommt beim Lesen ihre Felder", () => {
  const [titel, text] = SEITEN.kontakt;
  const doc = parseDocument(`---\ndatum: 2025-10-02\nart: kapitel\ntitel: "${titel}"\n---\n\n${text}\n`, "kapitel/kontakt.md");
  assert.equal(doc.vorlage, "kontakt");
  assert.equal((doc.felder as KontaktFelder).adresse.zeilen, "Firma\nStrasse 1");
  assert.match(textVon(doc), /## Standort/);
  // Nicht passender Text bleibt Text.
  const frei = mitFeldern({ ...doc, vorlage: null, felder: null, body: "Nur ein Satz." });
  assert.equal(frei.felder, null);
  assert.equal(frei.body, "Nur ein Satz.");
});

test("Neue Adresse: Ziele und Links in den Feldern ziehen mit", () => {
  const felder = ausText("uebersicht", "Übersicht", SEITEN.uebersicht[1])!;
  const doc = { rel: "kapitel/angebot.md", art: "kapitel" as const, titel: "Übersicht", datum: "", nummer: null, entwurf: false, vorlage: "uebersicht" as const, felder, body: "" };
  const neu = seiteMitNeuerAdresse(doc, "/kontakt", "/schreiben");
  assert.match(JSON.stringify(neu.felder), /"ziel":"\/schreiben"/);
  assert.equal(seiteMitNeuerAdresse(doc, "/gibtsnicht", "/x"), doc);
});

test("Prüfen: Pflichtfelder, reservierte Titel, gefährliche Wege", () => {
  const a = ausText("abschnitte", "Für Beispiele", SEITEN.abschnitte[1]) as AbschnitteFelder;
  a.abschnitte[0].titel = "";
  a.abschnitte[1].titel = "Leistungen:";
  a.einstieg.text = "## Titel im Text";
  a.band.knopf.ziel = "javascript:alert(1)";
  a.bild.src = "../../geheim.jpg";
  const fehler = pruefeFelder("abschnitte", "Für Beispiele", a);
  assert.ok(fehler["abschnitte.0.titel"]);
  assert.ok(fehler["abschnitte.1.titel"]);
  assert.ok(fehler["einstieg.text"]);
  assert.ok(fehler["band.knopf.ziel"]);
  assert.ok(fehler["bild.src"]);
  assert.ok(pruefeFelder("abschnitte", "Für Beispiele", { kaputt: true } as never)._);
});

test("Eine neue Seite ist sofort gültig, wenn sie Text bekommt", () => {
  const seite = neueSeite("../media/a.jpg");
  seite.einstieg.text = "Worum es geht.";
  assert.deepEqual(pruefeFelder("abschnitte", "Neue Seite", seite), {});
  seite.abschnitte.push({ titel: "Ohne Leistungen", untertitel: "", text: "", leistungen: [] });
  assert.deepEqual(pruefeFelder("abschnitte", "Neue Seite", seite), {});
});

test("Klartext: Absätze, Titel und Punkte ohne Markdown", () => {
  const stuecke = klartextBloecke(SEITEN.abschnitte[1]);
  assert.ok(stuecke.includes("Erster Absatz mit fett."));
  assert.ok(stuecke.includes("Punkt zwei (mit Folgezeile)"));
  assert.ok(!stuecke.some((s) => s.includes("bild.jpg")));
});
