/**
 * Die Redaktion im echten Browser, mit einer Kopie des Inhalts in einem Wegwerf-Ordner.
 * npm run test:browser. Braucht Brave oder Chrome (anderswo: CHROME_PATH setzen), git und Node 24.
 * Ohne weitere Angabe läuft es mit dem erfundenen Inhalt in tests/fixtures/content, also auch auf
 * einem Runner. Mit dem echten Inhalt: INHALT=dev-content npm run test:browser (oder ein anderer Pfad).
 * SHOTS=<Ordner> behält die Bildschirmfotos und den Wegwerf-Ordner.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import { legeInhaltAn } from "../fixtures/inhalt.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const arbeit = fs.mkdtempSync(path.join(os.tmpdir(), "advocat-browser-"));
const content = path.join(arbeit, "content");
const site = path.join(arbeit, "site");
const shots = process.env.SHOTS ?? path.join(arbeit, "shots");
fs.mkdirSync(shots, { recursive: true });
// Chrome: was CHROME_PATH sagt, sonst der übliche Ort auf dem Mac (Brave, dann Chrome) oder auf einem Linux-Runner.
const chrome = process.env.CHROME_PATH ?? ["/Applications/Brave Browser.app/Contents/MacOS/Brave Browser", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser"].find((ort) => fs.existsSync(ort));
// Was auch geschieht (ein Fehler mitten im Test, Ctrl-C): Der Server bleibt nicht zurück, der Wegwerf-Ordner auch nicht.
let server = null;
process.on("exit", () => {
  server?.kill();
  if (!process.env.SHOTS) fs.rmSync(arbeit, { recursive: true, force: true });
});
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => process.exit(130));
if (!chrome) throw new Error("Weder Chrome noch Brave gefunden. Bitte CHROME_PATH setzen.");
// Der echte Inhalt bringt sein Git mit. Der erfundene bekommt seine Fassungen beim Kopieren.
const echt = process.env.INHALT ? path.resolve(repo, process.env.INHALT) : "";
if (echt) {
  if (!fs.existsSync(path.join(echt, "kapitel"))) throw new Error(`INHALT=${process.env.INHALT}: In ${echt} liegt kein Inhalt.`);
  fs.cpSync(echt, content, { recursive: true });
} else legeInhaltAn(content);
console.log(`Inhalt: ${echt || "tests/fixtures/content (erfunden)"}`);
const port = 45890;
const base = `http://127.0.0.1:${port}`;
// Was der Server schreibt, landet in einer Datei: Kommt er nicht hoch, steht dort warum.
const protokoll = path.join(arbeit, "server.log");
const protokollDatei = fs.openSync(protokoll, "w");
const serverLog = () => fs.readFileSync(protokoll, "utf8").split("\n").slice(-40).join("\n");
server = spawn(process.execPath, ["src/server/index.ts"], {
  cwd: repo,
  stdio: ["ignore", protokollDatei, protokollDatei],
  env: { ...process.env, PORT: String(port), XAI_API_KEY: "", TELEGRAM_BOT_TOKEN: "", CONTENT_DIR: content, SITE_DIR: site, ANFRAGEN_DIR: path.join(arbeit, "anf"), CHAT_DIR: path.join(arbeit, "chat") },
});
for (let i = 0; ; i += 1) {
  if (server.exitCode !== null) throw new Error(`Der Server ist beim Start ausgestiegen (${server.exitCode}).\n${serverLog()}`);
  const fertig = fs.existsSync(path.join(site, "status.json")) && await fetch(`${base}/redaktion`).then((r) => r.ok, () => false);
  if (fertig) break;
  if (i > 180) throw new Error(`Der Server kam nicht hoch.\n${serverLog()}`);
  await new Promise((r) => setTimeout(r, 1000));
}
// Ein Runner hat keine Maus: Chrome meldet dort «hover: none», und das Menü «Unser Angebot» der Website
// (heft.css, @media (hover: hover)) ginge beim Darüberfahren nie auf. Darum überall eine Maus vorgeben, wie auf dem Mac.
const b = await puppeteer.launch({ executablePath: chrome, headless: "new", args: ["--no-sandbox", "--blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4"] });
const p = await b.newPage(); await p.setViewport({width:1600,height:1000});
const errs=[]; p.on("pageerror",e=>errs.push("pageerror "+e.message)); p.on("console",m=>{if(m.type()==="error")errs.push("console "+m.text())});
let fails=0; const ok=(n,c)=>{ if(!c) fails++; console.log((c?"PASS ":"FAIL ")+n)};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const read=f=>fs.readFileSync(`${content}/${f}`,"utf8");
const open=async rel=>{ await p.goto(`${base}/redaktion#${rel}`,{waitUntil:"networkidle2"}); await p.reload({waitUntil:"networkidle2"}); await sleep(900); };
const knopf=(t)=>p.evaluateHandle((t)=>[...document.querySelectorAll("button")].find(x=>x.textContent.trim().startsWith(t)&&x.offsetParent),t);
const klick=async t=>{ const h=await knopf(t); await h.click(); };
const speichern=async()=>{ await klick("Speichern & veröffentlichen"); await sleep(900); };
// Verzeichnis: die drei Bereiche, das Menü der Website
await p.goto(`${base}/redaktion`,{waitUntil:"networkidle2"}); await sleep(900);
ok("Verzeichnis: drei Bereiche", JSON.stringify(await p.$$eval("aside .kategorie",l=>l.map(x=>x.textContent)))===JSON.stringify(["Täglich","Seiten","Verwaltung"]));
ok("Verzeichnis: Zur Website neben Redaktion", await p.$eval(".verzeichnis-kopf",e=>!!e.querySelector("#heim")&&!!e.querySelector("#zur-website")&&e.querySelector("#heim").getBoundingClientRect().top<e.querySelector("#zur-website").getBoundingClientRect().bottom));
const reihe=await p.evaluate(()=>{let k="";const out={};for(const el of document.querySelectorAll("aside > *")){if(el.classList.contains("kategorie")){k=el.textContent;out[k]=[];continue;}if(!k)continue;const n=el.classList.contains("zeile-link")?(el.querySelector(":scope > span:not(.zahl)")??el).textContent:el.querySelector?.(":scope > summary .gruppe-titel")?.textContent;if(n)out[k].push(n);}return out;});
ok("Verzeichnis: Täglich", JSON.stringify(reihe["Täglich"])===JSON.stringify(["Newsletter","Kontaktaufnahme"]));
ok("Verzeichnis: Verwaltung", JSON.stringify(reihe["Verwaltung"])===JSON.stringify(["Allgemein","Support","Website-Check","Medien","Verlauf","Papierkorb"]));
// Startseite: der nächste Schritt, zwei Karten, zuletzt Bearbeitetes; der Website-Check wohnt unter Verwaltung
ok("Start: Als Nächstes mit einem Satz", await p.$eval("#start-naechstes",e=>!e.hidden&&e.querySelector(".gross").textContent.length>3));
ok("Start: Newsletter und Kontaktaufnahme", await p.$$eval("#start .aufgabe:not([hidden]) h2",l=>l.map(x=>x.firstChild.textContent).slice(0,2).join()==="Newsletter,Kontaktaufnahme"));
ok("Start: kein Website-Check mehr", await p.$eval("#start",e=>!e.textContent.includes("Website-Check")));
ok("Start: Zuletzt bearbeitet öffnet eine Seite", await p.$eval("#start-zuletzt",e=>!e.hidden&&e.querySelectorAll("li button").length>0));
await p.screenshot({path:`${shots}/start.png`});
await p.click("#check-link"); await sleep(900);
ok("Website-Check: eigene Ansicht unter Verwaltung", await p.$eval("#check-seite",e=>!e.hidden&&e.querySelector("#check-stand").textContent.length>3) && await p.$eval("#check-link",e=>e.hasAttribute("aria-current")) && (await p.evaluate(()=>location.hash))==="#check");
await p.click("#heim"); await sleep(600);
const haupt=await p.$$eval("#seiten > .eintrag .thema",l=>l.map(x=>x.textContent));
ok("Verzeichnis: wie das Menü der Website", JSON.stringify(haupt)===JSON.stringify(["Home","Unser Angebot","Über uns","Neuigkeiten","Kontakt"]));
ok("Verzeichnis: Angebote unter Unser Angebot", JSON.stringify(await p.$$eval("#seiten .unterseiten .thema",l=>l.map(x=>x.textContent)))===JSON.stringify(["Für Privatpersonen","Für Unternehmen","Für Stiftungen"]));
ok("Verzeichnis: Rechtliches", JSON.stringify(await p.$$eval("#rechtliches .thema",l=>l.map(x=>x.textContent)))===JSON.stringify(["Impressum","Disclaimer","Datenschutz"]));
const vorDemKlick=await p.$eval("#verlauf-link",e=>e.getBoundingClientRect().top);
await p.click("#medien-link"); await sleep(900);
ok("Verzeichnis: Medien öffnet ohne Sprung", await p.$eval("#medien-seite",e=>!e.hidden) && await p.$eval("#medien-link",e=>e.hasAttribute("aria-current")) && Math.abs(await p.$eval("#verlauf-link",e=>e.getBoundingClientRect().top)-vorDemKlick)<1);
ok("Verzeichnis: Medien und Verlauf ohne Pfeil", await p.evaluate(()=>!document.querySelector("#medien-link").closest("details")&&!document.querySelector("#verlauf-link").closest("details")));
ok("Verzeichnis: keine eigenen Übersicht-Links", await p.$$eval("aside button",l=>!l.some(x=>x.textContent.includes("Übersicht"))));
for (const [gruppe,seite] of [["#briefe-gruppe","#briefe-seite"],["#anfragen-gruppe","#anfragen"],["#wuensche-gruppe","#wuensche-seite"],["#papierkorb-gruppe","#papierkorb-seite"]]) {
  const zeigt=()=>p.$eval(seite,e=>!e.hidden); const auf=()=>p.$eval(gruppe,d=>d.open);
  await p.click(`${gruppe} > summary`); await sleep(500);
  ok(`Verzeichnis: ${gruppe} öffnet die Übersicht`, await zeigt() && await auf());
  await p.click("#medien-link"); await sleep(500);
  await p.click(`${gruppe} > summary`); await sleep(500);
  ok(`Verzeichnis: ${gruppe} offen, Klick holt die Übersicht zurück`, await zeigt() && await auf());
  await p.click(`${gruppe} > summary`); await sleep(300);
  ok(`Verzeichnis: ${gruppe} zweiter Klick klappt zu`, await zeigt() && !(await auf()));
}
await p.click("#papierkorb-gruppe > summary"); await sleep(500);
ok("Papierkorb: Übersicht mit drei Kacheln und einer Karte je Eintrag", await p.evaluate(()=>document.querySelectorAll("#papierkorb-kacheln .kachel").length===3&&document.querySelectorAll("#papierkorb-karten li").length===document.querySelectorAll("#papierkorb .eintrag").length&&location.hash==="#papierkorb"));
await p.screenshot({path:`${shots}/papierkorb.png`});
await p.click("#wuensche-gruppe > summary"); await sleep(500);
await p.screenshot({path:`${shots}/support-gruppe.png`});
await p.click("#medien-link"); await sleep(500);
await p.screenshot({path:`${shots}/verwaltung.png`});
await open("recht/impressum.md"); ok("Verzeichnis: Rechtliches klappt bei offener Seite auf", await p.$eval("#rechtliches-gruppe",d=>d.open));
await p.screenshot({path:`${shots}/verzeichnis.png`});
// Assistent: eigene Stile, keine Übergriffe aus Verlauf und Feldern
for (const [breite,hoehe] of [[1700,1000],[1280,800],[1000,800],[390,844]]) {
  const a=await b.newPage(); await a.setViewport({width:breite,height:hoehe,isMobile:breite<500,hasTouch:breite<500}); await a.goto(`${base}/redaktion`,{waitUntil:"networkidle2"}); await sleep(700);
  if (!(await a.$eval(".assistent",e=>e.getBoundingClientRect().width>0&&getComputedStyle(e).visibility!=="hidden"&&e.getBoundingClientRect().x<innerWidth))) { await a.click(".assistent-auf"); await sleep(400); }
  const m=await a.evaluate(()=>{const s=document.querySelector(".assistent").getBoundingClientRect();const ta=getComputedStyle(document.querySelector(".assistent .feld textarea"));const li=document.querySelector(".assistent .verlauf > li");return {rechts:Math.round(s.right),breit:Math.round(s.width),rand:ta.borderTopWidth,li:li?getComputedStyle(li).display:"",bg:li?getComputedStyle(li).backgroundColor:"",quer:document.documentElement.scrollWidth>innerWidth};});
  ok(`Assistent ${breite}: rechts bündig`, m.rechts===breite&&m.breit<=breite);
  ok(`Assistent ${breite}: Eingabefeld ohne doppelten Rahmen`, m.rand==="0px");
  ok(`Assistent ${breite}: Liste nicht als Verlauf-Karten`, m.li!=="flex");
  await a.screenshot({path:`${shots}/assistent-${breite}.png`}); await a.close();
}
// jede Vorlage öffnet Felder
for (const [rel,name] of [["kapitel/willkommen.md","start"],["kapitel/angebot.md","uebersicht"],["kapitel/ueber-uns.md","ueberuns"],["kapitel/kontakt.md","kontakt"],["kapitel/neuigkeiten.md","neuigkeiten"],["kapitel/stiftungen.md","abschnitte"]]) {
  await open(rel); ok(`${name}: Felder, kein Milkdown`, !(await p.$(".milkdown .ProseMirror")) && (await p.$$(".feld-gruppe")).length>=2);
  ok(`${name}: Feld Bildbeschreibung beim Titelbild`, !!(await p.$('[data-pfad="bild.alt"] input')));
  await p.screenshot({path:`${shots}/v-${name}.png`,fullPage:true});
}
// Über uns: Text ändern, speichern, Website, Knopfbeschriftung
await open("kapitel/ueber-uns.md");
const name=await p.$('[data-pfad="sparring.name"] input'); await name.click({count:3}); await p.keyboard.type("Patrick Testname"); await sleep(200); await speichern();
ok("Über uns gespeichert in Feldern", read("kapitel/ueber-uns.md").includes("name: Patrick Testname"));
await sleep(1800); ok("Über uns auf Website", fs.readFileSync(`${site}/ueber-uns/index.html`,"utf8").includes("Patrick Testname"));
ok("Status zeigt aktuell", (await p.$eval("#setz-status",e=>e.textContent)).startsWith("Website aktuell"));
// Beschreibung des Titelbilds: gespeichert und beim Teilen der Seite
await open("kapitel/kontakt.md");
const titelAlt=await p.$('[data-pfad="bild.alt"] input'); await titelAlt.click({count:3}); await p.keyboard.type("Blick auf das Büro in St. Gallen"); await sleep(200); await speichern(); await sleep(1800);
ok("Titelbild: Beschreibung gespeichert", read("kapitel/kontakt.md").includes("Blick auf das Büro in St. Gallen"));
ok("Titelbild: Beschreibung beim Teilen", fs.readFileSync(`${site}/kontakt/index.html`,"utf8").includes('property="og:image:alt" content="Blick auf das Büro in St. Gallen"'));
// Band-Titel jetzt frei
await open("kapitel/angebot.md");
const bt=await p.$('[data-pfad="band.titel"] input'); await bt.click({count:3}); await p.keyboard.type("Reden wir."); await sleep(200); await speichern(); await sleep(1800);
const ang=fs.readFileSync(`${site}/angebot/index.html`,"utf8"); ok("Band-Titel frei wählbar", /class="band"[\s\S]*Reden wir\./.test(ang));
// Konflikt: zweites Fenster
await open("kapitel/privatpersonen.md");
const p2=await b.newPage(); await p2.setViewport({width:1200,height:900}); await p2.goto(`${base}/redaktion#kapitel/privatpersonen.md`,{waitUntil:"networkidle2"}); await sleep(900);
const t2=await p2.$('[data-pfad="einstieg.titel"] input'); await t2.click({count:3}); await p2.keyboard.type("Von Fenster zwei"); await sleep(200);
await (await p2.evaluateHandle(()=>[...document.querySelectorAll("button")].find(x=>x.textContent.startsWith("Speichern &")))).click(); await sleep(900);
ok("Fenster zwei gespeichert", read("kapitel/privatpersonen.md").includes("Von Fenster zwei")); await p2.close();
const t1=await p.$('[data-pfad="einstieg.titel"] input'); await t1.click({count:3}); await p.keyboard.type("Von Fenster eins"); await sleep(200); await speichern();
ok("Fenster eins überschreibt nicht", read("kapitel/privatpersonen.md").includes("Von Fenster zwei") && !read("kapitel/privatpersonen.md").includes("Von Fenster eins"));
ok("Meldung bei Konflikt", (await p.$eval("#speicher",e=>e.textContent)).includes("anderswo geändert"));
await p.screenshot({path:`${shots}/konflikt.png`});
await p.evaluate(()=>{window.onbeforeunload=null}); await klick("Verwerfen"); await sleep(300); await p.click("#frage-ja"); await sleep(900);
// Neue Seite
await p.goto(`${base}/redaktion`,{waitUntil:"networkidle2"}); await sleep(700);
await klick("Neue Seite anlegen"); await sleep(300);
await p.screenshot({path:`${shots}/neue-seite-dialog.png`});
await p.keyboard.type("Für Familien"); await p.keyboard.press("Enter"); await sleep(1600);
const nrel="kapitel/fuer-familien.md"; ok("Neue Seite: Datei", fs.existsSync(`${content}/${nrel}`)); ok("Neue Seite: Felder, Entwurf", read(nrel).includes("vorlage: abschnitte")&&read(nrel).includes("entwurf: true"));
ok("Neue Seite: Felder im Editor", !(await p.$(".milkdown .ProseMirror")) && await p.$eval("#menue-feld",e=>!e.hidden));
const et=await p.$('[data-pfad="einstieg.text"] textarea'); await et.click(); await p.keyboard.type("Wir beraten Familien in allen Fragen rund um Vermögen und Recht, von Anfang an und unabhängig."); await sleep(1300);
ok("Neue Seite: speichert sich selbst", read(nrel).includes("Wir beraten Familien"));
await klick("+ Abschnitt"); await sleep(250); const at=await p.$('[data-pfad="abschnitte.0.titel"] input'); await at.type("Beratung"); await klick("+ Punkt"); await sleep(250); await p.keyboard.type("Eine Leistung"); await sleep(1300);
ok("Neue Seite: von Anfang an fürs Hauptmenü", read(nrel).includes("menue: true"));
ok("Entwurf steht im Verzeichnis an seinem Platz", (await p.$$eval("#seiten > .eintrag .thema",l=>l.map(x=>x.textContent))).join()==="Home,Unser Angebot,Über uns,Für Familien,Neuigkeiten,Kontakt");
ok("Entwurf nicht im Menü der Website", !fs.readFileSync(`${site}/kontakt/index.html`,"utf8").includes('href="/fuer-familien"'));
const mn=await p.$("#menue-name"); await mn.type("Familien"); await sleep(1400); ok("Name im Menü gespeichert", read(nrel).includes('menuename: "Familien"'));
await p.screenshot({path:`${shots}/neue-seite.png`,fullPage:true});
await klick("Veröffentlichen"); await sleep(300); await p.click("#frage-ja"); await sleep(3000);
ok("Neue Seite online", fs.existsSync(`${site}/fuer-familien/index.html`)); const nh=fs.readFileSync(`${site}/fuer-familien/index.html`,"utf8"); ok("Neue Seite: Inhalt, Spalten, Band", nh.includes("Wir beraten Familien")&&nh.includes("spalten-2-1")&&nh.includes('class="band"')&&nh.includes("<h1>Für Familien</h1>"));
await sleep(1500); ok("Neue Seite im Menü auf anderen Seiten", fs.readFileSync(`${site}/kontakt/index.html`,"utf8").includes('<a href="/fuer-familien">Familien</a>'));
ok("Neue Seite in Sitemap", fs.readFileSync(`${site}/sitemap.xml`,"utf8").includes("/fuer-familien"));
const namenImMenue=()=>p.$$eval("#seiten > .eintrag .thema",l=>l.map(x=>x.textContent).join());
ok("Verzeichnis: neue Seite im Menü vor Neuigkeiten, mit ihrem Namen", await namenImMenue()==="Home,Unser Angebot,Über uns,Familien,Neuigkeiten,Kontakt");
// Menü ordnen
const webMenue=()=>{const html=fs.readFileSync(`${site}/kontakt/index.html`,"utf8");const nav=html.slice(html.indexOf('id="menu"'),html.indexOf("</nav>",html.indexOf('id="menu"')));return [...nav.matchAll(/<a [^>]*>([^<]+)<\/a>/g)].map(m=>m[1]).filter(n=>!n.startsWith("Für ")&&n!=="Kontakt").join();};
const ordnenNamen=()=>p.$$eval("#seiten .ordnen-punkt > .ordnen-zeile .thema",l=>l.map(x=>x.textContent).join());
await p.click("#menue-ordnen"); await sleep(200);
ok("Ordnen: alle Zeilen in Menü-Reihenfolge", await ordnenNamen()==="Home,Unser Angebot,Über uns,Familien,Neuigkeiten,Kontakt");
ok("Ordnen: Home und Kontakt ohne Griff, die andern mit", (await p.$$("#seiten .griff")).length===4 && (await p.$$("#seiten .ordnen-punkt.fest")).length===2);
ok("Ordnen: Angebote hängen an Unser Angebot", await p.$eval('[data-ordnen="kapitel/angebot.md"]',e=>e.querySelectorAll(".ordnen-unter").length===3));
await p.screenshot({path:`${shots}/menue-ordnen.png`});
const zieheAuf=async(von,auf)=>{const g=await (await p.$(`[data-ordnen="${von}"] .griff`)).boundingBox();const z=await (await p.$(`[data-ordnen="${auf}"]`)).boundingBox();await p.mouse.move(g.x+g.width/2,g.y+g.height/2);await p.mouse.down();await p.mouse.move(g.x+g.width/2,g.y-8,{steps:3});await p.mouse.move(g.x+g.width/2,z.y-2,{steps:12});await sleep(150);await p.mouse.up();await sleep(250);};
await zieheAuf("kapitel/neuigkeiten.md","kapitel/angebot.md");
ok("Ordnen: Ziehen verschiebt", await ordnenNamen()==="Home,Neuigkeiten,Unser Angebot,Über uns,Familien,Kontakt");
await p.click("#ordnen-abbrechen"); await sleep(200);
ok("Ordnen: Abbrechen ändert nichts", await namenImMenue()==="Home,Unser Angebot,Über uns,Familien,Neuigkeiten,Kontakt" && !fs.existsSync(`${content}/menue.json`));
await p.click("#menue-ordnen"); await sleep(200);
await zieheAuf("kapitel/neuigkeiten.md","kapitel/angebot.md");
await p.click('[data-ordnen="kapitel/fuer-familien.md"] .hoch'); await sleep(200);
ok("Ordnen: Pfeil verschiebt", await ordnenNamen()==="Home,Neuigkeiten,Unser Angebot,Familien,Über uns,Kontakt");
await p.click("#ordnen-speichern"); await sleep(3500);
ok("Ordnen: Datei geschrieben", JSON.parse(read("menue.json")).reihenfolge.join()==="kapitel/neuigkeiten.md,kapitel/angebot.md,kapitel/fuer-familien.md,kapitel/ueber-uns.md");
ok("Ordnen: Verzeichnis zeigt die neue Reihenfolge", await namenImMenue()==="Home,Neuigkeiten,Unser Angebot,Familien,Über uns,Kontakt");
ok("Ordnen: Website auf allen Seiten", webMenue()==="Home,Neuigkeiten,Unser Angebot,Familien,Über uns");
ok("Ordnen: Offene Seite bleibt offen", await p.$eval("#blatt",e=>!e.hidden));
await klick("Kopie anlegen"); await sleep(1500); const krel=await p.evaluate(()=>decodeURIComponent(location.hash.slice(1))); ok("Kopie behält Felder", read(krel).includes("vorlage: abschnitte") && !(await p.$(".milkdown .ProseMirror")));
ok("Verzeichnis: Kopie unter Weitere Seiten", await p.$eval("#weitere-gruppe",d=>!d.hidden&&d.open&&d.textContent.includes("(Kopie)")));
await klick("Löschen"); await sleep(300); await p.click("#frage-ja"); await sleep(1000); ok("Kopie im Papierkorb, Rückgängig", !!(await p.$(".toast.sichtbar button")));
await p.screenshot({path:`${shots}/rueckgaengig.png`});
await p.click(".toast.sichtbar button"); await sleep(1200); ok("Rückgängig holt zurück", fs.existsSync(`${content}/${krel}`));
// Neue Seite unter «Unser Angebot»
await open("kapitel/kontakt.md"); await klick("Neue Seite anlegen"); await sleep(300);
await p.keyboard.type("Für Paare"); await p.select("dialog select","angebot"); await p.focus("dialog input"); await p.keyboard.press("Enter"); await sleep(1600);
const prel="kapitel/fuer-paare.md"; ok("Unter Angebot: gespeichert", read(prel).includes("menue: angebot"));
ok("Unter Angebot: im Verzeichnis darunter", (await p.$$eval("#seiten .unterseiten .thema",l=>l.map(x=>x.textContent))).at(-1)==="Für Paare");
const pt=await p.$('[data-pfad="einstieg.text"] textarea'); await pt.click(); await p.keyboard.type("Wir beraten Paare in allen Fragen rund um Vermögen und Recht, von Anfang an und unabhängig."); await sleep(1300);
await klick("+ Abschnitt"); await sleep(250); const pa=await p.$('[data-pfad="abschnitte.0.titel"] input'); await pa.type("Beratung"); await klick("+ Punkt"); await sleep(250); await p.keyboard.type("Eine Leistung"); await sleep(1300);
await klick("Veröffentlichen"); await sleep(300); await p.click("#frage-ja"); await sleep(4500);
const kh=fs.readFileSync(`${site}/kontakt/index.html`,"utf8");
ok("Unter Angebot: in der Zeile unter dem Menü", /class="nav-unter">.*<a href="\/fuer-paare">Für Paare<\/a>/.test(kh));
ok("Unter Angebot: bei den Weiteren Angeboten", fs.readFileSync(`${site}/privatpersonen/index.html`,"utf8").includes('<li><a href="/fuer-paare">Für Paare'));
ok("Unter Angebot: hat selbst die Weiteren Angebote", fs.readFileSync(`${site}/fuer-paare/index.html`,"utf8").includes('<li><a href="/privatpersonen">Für Privatpersonen'));
// Kopf der Website: viele und lange Punkte dürfen nicht über den Rand
for (const t of ["Vermögensverwaltung im Alter","Nachlass","Steuern"]) {
  const r=await p.evaluate(async(t)=>{const a=await fetch("/api/seiten",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({titel:t,menue:true})});return (await a.json()).rel},t);
  fs.writeFileSync(`${content}/${r}`,read(r).replace("entwurf: true\n",""));
}
await sleep(5000);
for (const breite of [1600,1280,1100,1024,981,390]) {
  const w=await b.newPage(); await w.setViewport({width:breite,height:700,isMobile:breite<500,hasTouch:breite<500}); await w.goto(`${base}/kontakt`,{waitUntil:"networkidle2"}); await sleep(300);
  const m=await w.evaluate(()=>({quer:document.documentElement.scrollWidth>innerWidth,kopf:Math.round(document.querySelector(".kopf").getBoundingClientRect().height)}));
  ok(`Kopf ${breite}: kein Überlauf (Höhe ${m.kopf})`, !m.quer);
  await w.screenshot({path:`${shots}/kopf-${breite}.png`}); await w.close();
}
// Zwei Zeilen im Kopf: Die Maus muss die Angebote trotzdem erreichen.
const wh=await b.newPage(); await wh.setViewport({width:1600,height:700}); await wh.goto(`${base}/kontakt`,{waitUntil:"networkidle2"}); await sleep(300);
const an=await (await wh.$(".nav-gruppe > a")).boundingBox(); await wh.mouse.move(an.x+20,an.y+8); await sleep(350);
const zi=await (await wh.$('.nav-unter a[href="/fuer-paare"]')).boundingBox(); await wh.mouse.move(zi.x+10,zi.y+8,{steps:25}); await sleep(450);
ok("Kopf: Angebote mit der Maus erreichbar, auch bei zwei Zeilen", await wh.evaluate(()=>{const u=document.querySelector(".nav-unter");return getComputedStyle(u).visibility==="visible"&&u.matches(":hover")}));
await wh.screenshot({path:`${shots}/kopf-angebote.png`}); await wh.close();
// Menü ordnen auf dem Telefon, mit dem Finger
const to=await b.newPage(); await to.setViewport({width:390,height:844,isMobile:true,hasTouch:true,deviceScaleFactor:2}); await to.goto(`${base}/redaktion`,{waitUntil:"networkidle2"}); await sleep(900);
await to.tap("#verzeichnis-auf"); await sleep(400); await to.tap("#menue-ordnen"); await sleep(300);
const toNamen=()=>to.$$eval("#seiten .ordnen-punkt.ziehbar > .ordnen-zeile .thema",l=>l.map(x=>x.textContent).join());
const toVor=await toNamen();
const tg=await (await to.$$("#seiten .ziehbar .griff")).at(-1).boundingBox(); const tz=await (await to.$("#seiten .ziehbar")).boundingBox();
await to.touchscreen.touchStart(tg.x+tg.width/2,tg.y+tg.height/2); for(let i=1;i<=12;i++){await to.touchscreen.touchMove(tg.x+tg.width/2,tg.y+tg.height/2+(tz.y-2-tg.y-tg.height/2)*i/12);await sleep(30);} await sleep(150); await to.touchscreen.touchEnd(); await sleep(300);
const toNach=await toNamen(); ok("Telefon: Menü ordnen mit dem Finger", toNach!==toVor&&toNach.split(",")[0]===toVor.split(",").at(-1)); console.log("  ",toVor,"→",toNach);
await to.screenshot({path:`${shots}/tel-ordnen.png`});
await (await to.$$("#seiten .ziehbar .runter")).at(0).tap(); await sleep(250);
ok("Telefon: Schublade bleibt beim Ordnen offen, Pfeil verschiebt", await to.evaluate(()=>document.body.classList.contains("verzeichnis-offen")) && await toNamen()!==toNach);
await to.tap("#ordnen-abbrechen"); await sleep(200); await to.close();
// Zurückgezogene Seiten: weg von der Website und aus dem Menü, im Verzeichnis noch da
const auf=(seite)=>fs.readFileSync(`${site}/${seite}/index.html`,"utf8");
const zurueckziehen=async(rel)=>{await open(rel);await klick("Zurückziehen");await sleep(300);await p.click("#frage-ja");await sleep(3500);};
const wiederOnline=async()=>{await klick("Veröffentlichen");await sleep(300);await p.click("#frage-ja");await sleep(3500);};
await zurueckziehen("kapitel/ueber-uns.md");
ok("Zurückgezogen: Über uns nicht mehr erreichbar", (await fetch(`${base}/ueber-uns`)).status===404);
ok("Zurückgezogen: Über uns nicht im Menü", !auf("kontakt").includes('href="/ueber-uns"'));
ok("Zurückgezogen: Über uns im Verzeichnis als Entwurf", await p.$eval('#seiten button[data-rel="kapitel/ueber-uns.md"]',e=>e.textContent.includes("Entwurf")));
await wiederOnline(); ok("Zurückgezogen: Über uns wieder im Menü, am selben Platz", webMenue().split(",").indexOf("Über uns")===webMenue().split(",").length-1 && (await fetch(`${base}/ueber-uns`)).status===200);
await zurueckziehen("kapitel/fuer-familien.md");
ok("Zurückgezogen: eigene Seite nicht mehr erreichbar", (await fetch(`${base}/fuer-familien`)).status===404 && !auf("kontakt").includes('href="/fuer-familien"'));
await wiederOnline();
await zurueckziehen("kapitel/stiftungen.md");
ok("Zurückgezogen: Angebot nicht in der Zeile und nicht bei den Weiteren", !auf("kontakt").includes('href="/stiftungen"') && !auf("privatpersonen").includes('<li><a href="/stiftungen"'));
await wiederOnline(); ok("Zurückgezogen: Angebot wieder in der Zeile", auf("kontakt").includes('href="/stiftungen"'));
await zurueckziehen("kapitel/kontakt.md");
ok("Zurückgezogen: Kontakt-Knopf weg", !auf("ueber-uns").includes('kontakt-desktop') && !auf("ueber-uns").includes('kontakt-mobil'));
await wiederOnline(); ok("Zurückgezogen: Kontakt-Knopf wieder da", auf("ueber-uns").includes('kontakt-desktop'));
// Startseite nicht kopierbar
await open("kapitel/willkommen.md"); ok("Startseite ohne Kopie", !(await p.evaluate(()=>[...document.querySelectorAll("#aktionen button")].some(x=>x.textContent==="Kopie anlegen"))));
// Medien
// So viele Bilder, wie im Inhalt liegen: Bis hier hat der Test keines hochgeladen oder gelöscht.
const bilderImInhalt=fs.readdirSync(`${content}/media`,{withFileTypes:true}).filter(e=>e.isFile()&&!e.name.startsWith(".")).length;
await p.goto(`${base}/redaktion#medien`,{waitUntil:"networkidle2"}); await sleep(1800);
ok(`Medien: Liste (${bilderImInhalt} Bilder)`, bilderImInhalt>=10 && (await p.$$(".medium")).length===bilderImInhalt); await p.screenshot({path:`${shots}/medien.png`});
ok("Medien: fest markiert", await p.evaluate(()=>document.body.textContent.includes("Fest auf der Website")));
const up=await p.$('#medien-seite input[type=file]'); const png=path.join(arbeit, "test – bild.png"); 
fs.writeFileSync(png,Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAEBgIApD5fRAAAAABJRU5ErkJggg==","base64"));
await up.uploadFile(png); await sleep(1800);
const nachUp=fs.readdirSync(`${content}/media`).filter(n=>n.startsWith("test-bild")); ok("Upload mit Gedankenstrich im Namen", nachUp.length===1);
await klick("Nicht verwendet"); await sleep(300); const anzahl=(await p.$$(".medium")).length; ok("Filter frei", anzahl>=1&&anzahl<10);
const loesch=await p.evaluateHandle((n)=>[...document.querySelectorAll(".medium")].find(m=>m.textContent.includes(n)).querySelector("button"),nachUp[0]); await loesch.click(); await sleep(1300);
ok("Bild gelöscht", !fs.existsSync(`${content}/media/${nachUp[0]}`));
await p.click(".toast.sichtbar button"); await sleep(1200); ok("Bild zurückgeholt", fs.existsSync(`${content}/media/${nachUp[0]}`));
const r=await p.evaluate(async()=>{const a=await fetch("/api/medien?name=Start-scaled.jpg",{method:"DELETE"});return [a.status,(await a.json()).error]}); ok("Gebrauchtes Bild nicht löschbar", r[0]===400&&r[1].includes("gebraucht")); console.log("  ",r[1]);
// Verlauf
await p.goto(`${base}/redaktion#verlauf`,{waitUntil:"networkidle2"}); await sleep(1400);
ok("Verlauf: Einträge", (await p.$$(".aenderungen > li")).length>=10); await p.screenshot({path:`${shots}/verlauf.png`});
ok("Verlauf: aktueller Stand markiert", await p.evaluate(()=>document.querySelector(".aenderungen").textContent.includes("aktueller Stand")));
ok("Verlauf: Menü neu geordnet, ohne Zurückholen", await p.evaluate(()=>{const li=[...document.querySelectorAll(".aenderungen > li")].find(x=>x.textContent.includes("Menü neu geordnet"));return !!li&&!li.querySelector("button")}));
// Verwaltung, Allgemein: Angaben ändern, sie gelten überall und ersetzen die alten im Rechtlichen
const html=(s)=>fs.readFileSync(`${site}/${s}/index.html`,"utf8");
ok("Allgemein: beim Start angelegt, Kontaktseite ohne eigene Adresse", fs.existsSync(`${content}/allgemein.json`) && !read("kapitel/kontakt.md").includes("zeilen:") && html("kontakt").includes("Rosenbergstrasse 50<br>"));
await p.goto(`${base}/redaktion#allgemein`,{waitUntil:"networkidle2"}); await sleep(900);
ok("Allgemein: Ansicht mit allen Feldern", await p.$eval("#allgemein-seite",e=>!e.hidden) && (await p.$$("#allgemein-seite .feld")).length===14 && await p.$eval("#allgemein-link",e=>e.hasAttribute("aria-current")));
// Vorlieben der Redaktion: gelten sofort, stehen im Browser, ändern das Formular nicht
const wurzel=()=>p.evaluate(()=>({thema:document.documentElement.dataset.thema,schrift:document.documentElement.dataset.schrift,px:getComputedStyle(document.documentElement).fontSize,grund:getComputedStyle(document.body).backgroundColor}));
const hell=await wurzel();
const zurRedaktion=async()=>{ await p.click('#allgemein-reiter [data-wert="redaktion"]'); await sleep(150); };
ok("Allgemein: zwei Teile, zuerst die Website", await p.$eval("#allgemein-website",e=>!e.hidden) && await p.$eval("#allgemein-redaktion",e=>e.hidden) && await p.$eval("#allgemein-speichern",e=>e.offsetParent!==null));
await zurRedaktion();
ok("Allgemein: Teil Redaktion ohne Speichern-Leiste", await p.$eval("#allgemein-redaktion",e=>!e.hidden) && await p.$eval("#allgemein-website",e=>e.hidden) && await p.$eval("#allgemein-speichern",e=>e.offsetParent===null));
await p.click('#wahl-thema [data-wert="dunkel"]'); await p.click('#wahl-schrift [data-wert="gross"]'); await sleep(200);
const dunkel=await wurzel();
ok("Redaktion: dunkel und grosse Schrift gelten sofort", hell.thema==="hell"&&hell.px==="16px"&&dunkel.thema==="dunkel"&&dunkel.schrift==="gross"&&dunkel.px==="18px"&&dunkel.grund!==hell.grund&&await p.$eval("#allgemein-speichern",e=>e.disabled));
await p.screenshot({path:`${shots}/allgemein-dunkel.png`,fullPage:true});
await p.reload({waitUntil:"networkidle2"}); await sleep(900);
ok("Redaktion: Wahl bleibt nach dem Neuladen", (await wurzel()).thema==="dunkel"&&(await wurzel()).px==="18px"&&await p.$eval('#wahl-thema [data-wert="dunkel"]',e=>e.getAttribute("aria-pressed")==="true"));
await zurRedaktion();
await p.click('#wahl-thema [data-wert="hell"]'); await p.click('#wahl-schrift [data-wert="normal"]'); await sleep(200);
await p.click("#assistent-beim-start"); await sleep(200); await p.reload({waitUntil:"networkidle2"}); await sleep(900);
ok("Redaktion: Assistent bleibt beim Öffnen zu, der Knopf öffnet ihn", (await wurzel()).thema==="hell"&&await p.$eval(".assistent",e=>e.hidden)&&await p.$eval(".assistent-auf",e=>!e.hidden));
await zurRedaktion(); await p.click("#assistent-beim-start"); await sleep(200); await p.reload({waitUntil:"networkidle2"}); await sleep(900);
ok("Redaktion: Assistent wieder da", await p.$eval(".assistent",e=>!e.hidden));
ok("Allgemein: Speichern erst nach einer Änderung", await p.$eval("#allgemein-speichern",e=>e.disabled));
// Mit focus() statt Klick: Die Leiste mit «Speichern» klebt oben und kann über einem Feld liegen.
const feldA=async(pfad,wert)=>{const e=await p.$(`#allgemein-seite [data-pfad="${pfad}"] input`); await e.evaluate(x=>{x.scrollIntoView({block:"center"});x.focus();x.select();}); await p.keyboard.press("Backspace"); if(wert) await p.keyboard.type(wert);};
await feldA("telefon","+41 71 999 88 77"); await feldA("strasse","Teststrasse 7"); await feldA("email","kaputt");
await p.click("#allgemein-speichern"); await sleep(500);
ok("Allgemein: falsche E-Mail rot, nichts gespeichert", !!(await p.$('#allgemein-seite [data-pfad="email"].hat-fehler')) && !read("allgemein.json").includes("Teststrasse"));
await feldA("email","info@beispiel.ch"); await sleep(100);
ok("Allgemein: Fehler weg, sobald behoben", !(await p.$('#allgemein-seite [data-pfad="email"].hat-fehler')));
await p.click("#medien-link"); await sleep(400);
ok("Allgemein: Wechseln mit Ungespeichertem fragt", await p.$eval("#frage",d=>d.open)); await p.click("#frage-nein"); await sleep(300);
ok("Allgemein: Hierbleiben behält die Änderungen", await p.$eval("#allgemein-seite",e=>!e.hidden) && await p.$eval('#allgemein-seite [data-pfad="strasse"] input',e=>e.value)==="Teststrasse 7");
await p.screenshot({path:`${shots}/allgemein.png`,fullPage:true});
await p.click("#allgemein-speichern");
// Alle Seiten werden neu gesetzt; das Rechtliche kommt zuletzt.
for (let i=0;i<60&&!["newsletter-1","ueber-uns","kontakt","impressum"].every(s=>html(s).includes("Teststrasse 7 | "));i+=1) await sleep(500);
const imp=read("recht/impressum.md");
ok("Allgemein: Impressum im Text angepasst, Gerichtsstand bleibt", imp.includes("Advocat Finanz AG\nTeststrasse 7\nCH-9000 St.Gallen") && imp.includes("Telefon +41 71 999 88 77") && imp.includes("(mailto:info@beispiel.ch)") && imp.includes("Gerichtsstand: CH-9000 St.Gallen"));
ok("Allgemein: Datenschutz angepasst, Meldung nennt die Seiten", read("recht/datenschutz.md").includes("Teststrasse 7") && /Impressum/.test(await p.$eval(".toast",e=>e.textContent)));
ok("Allgemein: Fuss auf allen Seiten neu", ["ueber-uns","kontakt","newsletter-1","impressum"].every(s=>html(s).includes("Teststrasse 7 | CH-9000 St.Gallen")&&html(s).includes('href="tel:+41719998877"')) && fs.readFileSync(`${site}/index.html`,"utf8").includes("Teststrasse 7"));
ok("Allgemein: Kontaktseite, Band und Formular", html("kontakt").includes("Teststrasse 7<br>CH-9000 St.Gallen") && html("kontakt").includes('data-email="info@beispiel.ch"') && html("ueber-uns").includes('<a href="mailto:info@beispiel.ch">info@beispiel.ch</a></p></div></div></aside>'));
ok("Allgemein: Impressum mit Zeilenumbrüchen", html("impressum").includes("Teststrasse 7<br>CH-9000 St.Gallen") && html("impressum").includes("Vertreten durch:<br>"));
ok("Allgemein: Angaben für Google", fs.readFileSync(`${site}/index.html`,"utf8").includes('"telephone":"+41 71 999 88 77"'));
ok("Allgemein: gespeichert, Leiste ruhig", await p.$eval("#allgemein-speichern",e=>e.disabled) && await p.$eval("#allgemein-verwerfen",e=>e.hidden));
await p.click("#medien-link"); await sleep(400); ok("Allgemein: nach dem Speichern wechseln ohne Frage", !(await p.$eval("#frage",d=>d.open)) && await p.$eval("#medien-seite",e=>!e.hidden));
// alte Fassung (Markdown) zurückholen
await open("kapitel/unternehmen.md"); await p.evaluate(()=>{document.querySelector("#fassungen-gruppe").open=true}); await sleep(1200);
const anz=await p.$$eval("#fassungen li",l=>l.length); ok("Fassungen da",anz>=2);
await p.evaluate(()=>[...document.querySelectorAll("#fassungen [data-ansehen]")].at(-1).click()); await sleep(1200); console.log("  Legende:",await p.$eval("#vorschau .legende",e=>e.textContent));
await p.evaluate(()=>[...document.querySelectorAll("#fassungen button")].filter(x=>x.textContent.includes("zurückholen")).at(1).click()); await sleep(300); await p.click("#frage-ja"); await sleep(1800);
ok("Alte Markdown-Fassung kommt als Felder zurück", !(await p.$(".milkdown .ProseMirror")) && read("kapitel/unternehmen.md").includes("vorlage: abschnitte"));
// Newsletter + Medien einfügen, Telefon
await p.goto(`${base}/redaktion#newsletter`,{waitUntil:"networkidle2"}); await sleep(600); await p.reload({waitUntil:"networkidle2"}); await sleep(600);
await p.evaluate(()=>document.querySelector("#briefe-neu").click()); await sleep(1800); const br=await p.evaluate(()=>decodeURIComponent(location.hash.slice(1)));
ok("Newsletter: Milkdown", !!(await p.$(".milkdown .ProseMirror"))); const pm=await p.$(".milkdown .ProseMirror"); await pm.click(); await p.keyboard.type("Autosave-Test"); await sleep(1600);
ok("Newsletter speichert selbst", read(br).includes("Autosave-Test"));
// Werkzeugleiste auch auf dem Computer, klebt unter der Leiste, und ihre Knöpfe wirken
const tb=await p.evaluate(()=>{const e=document.querySelector(".milkdown-top-bar");return e?getComputedStyle(e).display:"none"}); ok("Computer: Werkzeugleiste sichtbar", tb!=="none");
ok("Computer: keine Tabelle in der Leiste", !(await p.evaluate(()=>[...document.querySelectorAll(".milkdown-top-bar .top-bar-item")].some(i=>/table/i.test(i.innerHTML+i.getAttribute("title"))))));
await p.keyboard.down("Shift"); await p.keyboard.press("Home"); await p.keyboard.up("Shift"); await p.click(".milkdown-top-bar .top-bar-item"); await sleep(1500);
ok("Computer: Knopf Fett wirkt", read(br).includes("**Autosave-Test**"));
const textVorher=read(br);
await p.evaluate(()=>window.scrollTo(0,0)); const pm3=await p.$(".milkdown .ProseMirror"); await p.keyboard.press("ArrowRight"); for(let i=0;i<30;i++){await p.keyboard.type("Zeile");await p.keyboard.press("Enter");} await sleep(1500); await p.evaluate(()=>window.scrollTo(0,700)); await sleep(300); const klebe=await p.evaluate(()=>{const t=document.querySelector(".milkdown-top-bar").getBoundingClientRect();const l=document.querySelector("#blatt .leiste").getBoundingClientRect();return {t:t.top,l:l.bottom}});
ok("Computer: Werkzeugleiste klebt unter der Leiste", klebe.t>=klebe.l-3&&klebe.t<klebe.l+10); await p.screenshot({path:`${shots}/werkzeugleiste.png`}); await p.evaluate(()=>window.scrollTo(0,0)); await p.keyboard.down("Shift"); await p.keyboard.press("ArrowUp"); await p.keyboard.up("Shift"); await sleep(200);
await p.click("#bild-aus-medien"); await sleep(800); await p.waitForSelector(".medium-wahl"); await p.click(".medium-wahl"); await sleep(1800); const mitBild=/!\[[^\]]*\]\(\.\.\/media\//.test(read(br)); ok("Bild aus Medien im Newsletter, Markierung bleibt", mitBild && read(br).includes("**Autosave-Test") && read(br).includes("Zeile")); if(!mitBild||!read(br).includes("Zeile")||!read(br).includes("**Autosave-Test")) console.log("  Datei:",JSON.stringify(read(br).slice(0,160)),JSON.stringify(read(br).slice(-200)));
await p.screenshot({path:`${shots}/newsletter.png`});
const ph=await b.newPage(); await ph.setViewport({width:390,height:844,isMobile:true,hasTouch:true,deviceScaleFactor:2}); await ph.goto(`${base}/redaktion#${br}`,{waitUntil:"networkidle2"}); await sleep(1200);
ok("Telefon: Werkzeugleiste sichtbar", await ph.evaluate(()=>{const b=document.querySelector(".milkdown-top-bar");return !!b&&getComputedStyle(b).display!=="none"})); await ph.screenshot({path:`${shots}/tel-newsletter.png`});
await ph.goto(`${base}/redaktion#medien`,{waitUntil:"networkidle2"}); await sleep(1500); await ph.screenshot({path:`${shots}/tel-medien.png`}); await ph.close();
const real=errs.filter(e=>!/ERR_|favicon|404|409|422|400|WebSocket|websocket/.test(e)); console.log("Browserfehler:",real.slice(0,6),errs.length); console.log(fails?`${fails} FEHLGESCHLAGEN`:"ALLE OK");
if (real.length) console.log(`${real.length} Fehler im Browser`);
await b.close();
// Den Server und den Wegwerf-Ordner räumt process.on("exit") weiter oben weg.
process.exit(fails || real.length ? 1 : 0);
