import assert from "node:assert/strict";
import { test } from "node:test";
import { ALLGEMEIN_GRUND, allgemeinAus, ersetzeAngaben, pruefeAllgemein, telefonLink, type Allgemein } from "./allgemein.ts";

const mit = (aenderung: Partial<Allgemein>): Allgemein => ({ ...structuredClone(ALLGEMEIN_GRUND), ...aenderung });

const IMPRESSUM = `## Impressum

## Herausgeberin, Inhalt und Redaktion

Advocat Finanz AG
Rosenbergstrasse 50
CH-9000 St.Gallen

Telefon +41 71 242 30 30

[office@advocat-finanz.ch](mailto:office@advocat-finanz.ch)

UID: CHE-357.969.124
Handelsregister-Nr: CH-320.3.081.815-5
MWST Nr: CHE-357.969.124 MWST
Gerichtsstand: CH-9000 St.Gallen

Vertreten durch:
Patrick Rütsche`;

test("Unverändert: der Text bleibt, wie er ist", () => {
  assert.equal(ersetzeAngaben(IMPRESSUM, ALLGEMEIN_GRUND, structuredClone(ALLGEMEIN_GRUND)), IMPRESSUM);
});

test("Umzug: die Adresse ändert sich, der Gerichtsstand nicht", () => {
  const neu = mit({ strasse: "Bahnhofstrasse 1", plz: "8001", ort: "Zürich" });
  const text = ersetzeAngaben(IMPRESSUM, ALLGEMEIN_GRUND, neu);
  assert.match(text, /Advocat Finanz AG\nBahnhofstrasse 1\nCH-8001 Zürich\n/);
  assert.match(text, /Gerichtsstand: CH-9000 St\.Gallen/);
  assert.doesNotMatch(text, /Rosenbergstrasse/);
});

test("Telefon, E-Mail und Vertretung: überall, auch im Link", () => {
  const neu = mit({ telefon: "+41 71 000 00 00", email: "info@beispiel.ch", vertreten: "Anna Muster" });
  const text = ersetzeAngaben(IMPRESSUM, ALLGEMEIN_GRUND, neu);
  assert.match(text, /Telefon \+41 71 000 00 00/);
  assert.match(text, /\[info@beispiel\.ch\]\(mailto:info@beispiel\.ch\)/);
  assert.match(text, /Vertreten durch:\nAnna Muster$/);
});

test("Nur die UID neu: die MWST-Nummer bleibt, wie sie eingetragen ist", () => {
  const text = ersetzeAngaben(IMPRESSUM, ALLGEMEIN_GRUND, mit({ uid: "CHE-111.222.333" }));
  assert.match(text, /UID: CHE-111\.222\.333\n/);
  assert.match(text, /MWST Nr: CHE-357\.969\.124 MWST/);
});

test("Neuer Name, der den alten enthält: nichts doppelt", () => {
  const text = ersetzeAngaben(IMPRESSUM, ALLGEMEIN_GRUND, mit({ firma: "Advocat Finanz AG Holding" }));
  assert.equal(text.match(/Advocat Finanz AG Holding/g)?.length, 1);
  assert.doesNotMatch(text, /Holding Holding/);
});

test("Adressblock mit harten Umbrüchen: die Umbrüche bleiben", () => {
  const text = "Advocat Finanz AG\\\nRosenbergstrasse 50  \nCH-9000 St.Gallen";
  assert.equal(ersetzeAngaben(text, ALLGEMEIN_GRUND, mit({ strasse: "Neugasse 2" })), "Advocat Finanz AG\\\nNeugasse 2  \nCH-9000 St.Gallen");
});

test("Nur ganze Angaben: eine längere Nummer bleibt", () => {
  const text = "Fax +41 71 242 30 300";
  assert.equal(ersetzeAngaben(text, ALLGEMEIN_GRUND, mit({ telefon: "+41 71 000 00 00" })), text);
});

test("Prüfen: Pflichtfelder, Postleitzahl, Telefon, E-Mail, Link", () => {
  assert.deepEqual(pruefeAllgemein(ALLGEMEIN_GRUND), {});
  const fehler = pruefeAllgemein(mit({ firma: " ", plz: "90", telefon: "abc", email: "keine", karte: "maps.google.com", band: { titel: "", text: "x" } }));
  assert.deepEqual(Object.keys(fehler).sort(), ["band.titel", "email", "firma", "karte", "plz", "telefon"]);
  assert.deepEqual(pruefeAllgemein(mit({ karte: "" })), {});
});

test("Aus der Datei: fehlende Angaben aus der Vorgabe, Leerraum weg", () => {
  const a = allgemeinAus({ telefon: "  +41 71 000 00 00 ", band: { titel: "Hallo" }, fremd: 1 });
  assert.equal(a.telefon, "+41 71 000 00 00");
  assert.equal(a.band.titel, "Hallo");
  assert.equal(a.band.text, ALLGEMEIN_GRUND.band.text);
  assert.equal(a.firma, ALLGEMEIN_GRUND.firma);
  assert.equal("fremd" in a, false);
  assert.deepEqual(allgemeinAus(null), ALLGEMEIN_GRUND);
});

test("Telefon als Link: immer mit Landesvorwahl", () => {
  assert.equal(telefonLink("+41 71 242 30 30"), "+41712423030");
  assert.equal(telefonLink("071 242 30 30"), "+41712423030");
  assert.equal(telefonLink("0041 71 242 30 30"), "+41712423030");
});
