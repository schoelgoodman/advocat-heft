import assert from "node:assert/strict";
import { test } from "node:test";
import { freiGeworden, type Medium } from "./medien.ts";

const bild = (name: string, verwendet: Medium["verwendet"], fest = false): Medium => ({ name, groesse: 1, fest, verwendet });
const imKorb = { titel: "Test", rel: "papierkorb/kapitel/test.md", papierkorb: true };
const online = { titel: "Willkommen", rel: "kapitel/willkommen.md", papierkorb: false };

test("Frei geworden: nur was der gelöschte Eintrag als Letzter brauchte", () => {
  const vorher = [bild("nur-korb.png", [imKorb]), bild("beides.jpg", [online, imKorb]), bild("schon-frei.png", []), bild("fest.jpg", [imKorb], true)];
  const nachher = [bild("nur-korb.png", []), bild("beides.jpg", [online]), bild("schon-frei.png", []), bild("fest.jpg", [], true)];
  assert.deepEqual(freiGeworden(vorher, nachher), ["nur-korb.png"]);
});

test("Frei geworden: nichts, wenn kein Bild betroffen ist", () => {
  const liste = [bild("a.png", [online]), bild("b.png", [])];
  assert.deepEqual(freiGeworden(liste, liste), []);
});
