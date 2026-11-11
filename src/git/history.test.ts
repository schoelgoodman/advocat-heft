import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { AENDERUNGEN_DATEI, commitIfChanged, leereVerlauf, letzteAenderungen, logAlles, zaehleFassungen } from "./history.ts";

let ordner = "";
const vorher = process.env.CONTENT_DIR;

before(async () => {
  ordner = await fs.mkdtemp(path.join(os.tmpdir(), "advocat-verlauf-"));
  process.env.CONTENT_DIR = ordner;
});

after(async () => {
  if (vorher === undefined) delete process.env.CONTENT_DIR;
  else process.env.CONTENT_DIR = vorher;
  await fs.rm(ordner, { recursive: true, force: true });
});

async function schreibe(rel: string, text: string): Promise<void> {
  await fs.mkdir(path.dirname(path.join(ordner, rel)), { recursive: true });
  await fs.writeFile(path.join(ordner, rel), text, "utf8");
}

function git(...args: string[]): string {
  return execFileSync("git", args, { cwd: ordner, encoding: "utf8" });
}

test("Verlauf leeren: eine Fassung bleibt, die Dateien bleiben, die Tage für die Sitemap bleiben", async () => {
  assert.equal(await zaehleFassungen(), 0);
  assert.equal(await leereVerlauf(), 0);

  await schreibe("kapitel/kontakt.md", "alt\n");
  await commitIfChanged("Kontakt", ["kapitel/kontakt.md"]);
  await schreibe("kapitel/kontakt.md", "geheim, später gestrichen\n");
  await commitIfChanged("Kontakt geändert", ["kapitel/kontakt.md"]);
  await schreibe("kapitel/kontakt.md", "neu\n");
  await schreibe("briefe/0001-newsletter-1.md", "Brief\n");
  await commitIfChanged("Kontakt und Brief", ["kapitel/kontakt.md", "briefe/0001-newsletter-1.md"]);
  // Von Hand geändert und nie gesichert: Das Leeren fasst es nicht an.
  await schreibe("recht/impressum.md", "von Hand\n");
  // Die Fassungen auf einen früheren Tag legen, damit «gemerkt» und «heute» sich unterscheiden lassen.
  git("-c", "user.name=t", "-c", "user.email=t@t", "rebase", "--root", "--quiet", "--committer-date-is-author-date", "--exec",
    "git -c user.name=t -c user.email=t@t commit --amend --no-edit --quiet --date=2026-03-04T10:00:00Z");
  assert.equal((await letzteAenderungen("2026-11-11")).get("kapitel/kontakt.md"), "2026-03-04");

  assert.equal(await leereVerlauf(), 3);
  assert.equal(await zaehleFassungen(), 1);
  assert.equal((await logAlles(10, 0))[0]?.message, "Verlauf geleert");
  assert.equal(await fs.readFile(path.join(ordner, "kapitel/kontakt.md"), "utf8"), "neu\n");
  assert.equal(await fs.readFile(path.join(ordner, "recht/impressum.md"), "utf8"), "von Hand\n");
  assert.equal(git("status", "--porcelain").trim(), "?? recht/");
  // Wirklich weg, nicht nur unsichtbar: Der gestrichene Text steht in keinem Objekt mehr.
  const objekte = git("cat-file", "--batch-all-objects", "--batch");
  assert.ok(!objekte.includes("geheim, später gestrichen"));

  const tage = await letzteAenderungen("2026-11-11");
  assert.equal(tage.get("kapitel/kontakt.md"), "2026-03-04");
  assert.equal(tage.get("briefe/0001-newsletter-1.md"), "2026-03-04");
  assert.ok(JSON.parse(await fs.readFile(path.join(ordner, AENDERUNGEN_DATEI), "utf8"))["kapitel/kontakt.md"]);

  // Danach geht es normal weiter: Eine neue Änderung zählt wieder mit ihrem eigenen Tag.
  await schreibe("kapitel/kontakt.md", "noch neuer\n");
  await commitIfChanged("Kontakt nochmals", ["kapitel/kontakt.md"]);
  assert.equal(await zaehleFassungen(), 2);
  const danach = await letzteAenderungen("2026-11-11");
  assert.notEqual(danach.get("kapitel/kontakt.md"), "2026-03-04");
  assert.equal(danach.get("briefe/0001-newsletter-1.md"), "2026-03-04");

  // Ein zweites Leeren behält die gemerkten Tage.
  assert.equal(await leereVerlauf(), 2);
  assert.equal((await letzteAenderungen("2026-11-11")).get("briefe/0001-newsletter-1.md"), "2026-03-04");
});
