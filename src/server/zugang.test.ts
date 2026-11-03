import assert from "node:assert/strict";
import type http from "node:http";
import { test } from "node:test";
import { bildEndung, fremdeHerkunft, schluesselPasst } from "./zugang.ts";

function anfrage(method: string, headers: Record<string, string>): http.IncomingMessage {
  return { method, headers } as unknown as http.IncomingMessage;
}

test("Schlüssel: nur der richtige passt", () => {
  const richtig = "a1b2c3d4e5f6";
  assert.equal(schluesselPasst(anfrage("GET", { "x-redaktion-schluessel": richtig }), richtig), true);
  assert.equal(schluesselPasst(anfrage("GET", { "x-redaktion-schluessel": "a1b2c3d4e5f7" }), richtig), false);
  assert.equal(schluesselPasst(anfrage("GET", { "x-redaktion-schluessel": "a1b2" }), richtig), false);
  assert.equal(schluesselPasst(anfrage("GET", {}), richtig), false);
});

test("Schlüssel: ohne eingestellten Schlüssel kommt niemand durch", () => {
  assert.equal(schluesselPasst(anfrage("GET", { "x-redaktion-schluessel": "" }), ""), false);
  assert.equal(schluesselPasst(anfrage("GET", {}), ""), false);
});

test("Herkunft: Lesen ist immer erlaubt", () => {
  assert.equal(fremdeHerkunft(anfrage("GET", { origin: "https://boese.example", host: "redaktion.x.ch" })), false);
});

test("Herkunft: Ändern nur von der eigenen Adresse", () => {
  const host = "redaktion.x.ch";
  assert.equal(fremdeHerkunft(anfrage("POST", { origin: `https://${host}`, host })), false);
  assert.equal(fremdeHerkunft(anfrage("POST", { origin: "https://dufs.x.ch", host })), true);
  assert.equal(fremdeHerkunft(anfrage("POST", { origin: "kaputt", host })), true);
  // Hinter SWAG zählt auch X-Forwarded-Host.
  assert.equal(fremdeHerkunft(anfrage("POST", { origin: `https://${host}`, host: "advocat-redaktion:4321", "x-forwarded-host": host })), false);
});

test("Herkunft: ohne Origin entscheidet Sec-Fetch-Site", () => {
  assert.equal(fremdeHerkunft(anfrage("POST", { "sec-fetch-site": "cross-site" })), true);
  assert.equal(fremdeHerkunft(anfrage("POST", { "sec-fetch-site": "same-origin" })), false);
});

test("Bilder: SVG und andere Dateien gehen nicht", () => {
  assert.equal(bildEndung("foto.JPG"), ".jpg");
  assert.equal(bildEndung("grafik.webp"), ".webp");
  assert.equal(bildEndung("logo.svg"), null);
  assert.equal(bildEndung("logo.SVG"), null);
  assert.equal(bildEndung("seite.html"), null);
  assert.equal(bildEndung("ohne-endung"), null);
  assert.equal(bildEndung(".png"), null);
});
