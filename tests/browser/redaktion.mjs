/**
 * Die Redaktion im echten Browser, mit einer Kopie von dev-content in einem Wegwerf-Ordner.
 * npm run test:browser. Braucht Chrome (sonst CHROME_PATH setzen), den Inhalt in dev-content und Node 24.
 * Der Inhalt liegt nicht im Repo, darum läuft das nur lokal und nicht bei npm test.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const arbeit = fs.mkdtempSync(path.join(os.tmpdir(), "advocat-browser-"));
const content = path.join(arbeit, "content");
const site = path.join(arbeit, "site");
const shots = process.env.SHOTS ?? path.join(arbeit, "shots");
fs.mkdirSync(shots, { recursive: true });
fs.cpSync(path.join(repo, "dev-content"), content, { recursive: true });
const port = 45890;
const base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ["--import", "tsx", "src/server/index.ts"], {
  cwd: repo,
  stdio: "ignore",
  env: { ...process.env, PORT: String(port), XAI_API_KEY: "", TELEGRAM_BOT_TOKEN: "", CONTENT_DIR: content, SITE_DIR: site, ANFRAGEN_DIR: path.join(arbeit, "anf"), CHAT_DIR: path.join(arbeit, "chat") },
});
for (let i = 0; ; i += 1) {
  const fertig = fs.existsSync(path.join(site, "status.json")) && await fetch(`${base}/redaktion`).then((r) => r.ok, () => false);
  if (fertig) break;
  if (i > 180) throw new Error("Der Server kam nicht hoch.");
  await new Promise((r) => setTimeout(r, 1000));
}
const b = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", args: ["--no-sandbox"] });
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
const reihe=await p.evaluate(()=>{let k="";const out={};for(const el of document.querySelectorAll("aside > *")){if(el.classList.contains("kategorie")){k=el.textContent;out[k]=[];continue;}if(!k)continue;const n=el.querySelector?.(":scope > summary .gruppe-titel")?.textContent;if(n)out[k].push(n);}return out;});
ok("Verzeichnis: Täglich", JSON.stringify(reihe["Täglich"])===JSON.stringify(["Newsletter","Kontaktaufnahme"]));
ok("Verzeichnis: Verwaltung", JSON.stringify(reihe["Verwaltung"])===JSON.stringify(["Support","Medien","Verlauf","Papierkorb"]));
const haupt=await p.$$eval("#seiten > .eintrag .thema",l=>l.map(x=>x.textContent));
ok("Verzeichnis: wie das Menü der Website", JSON.stringify(haupt)===JSON.stringify(["Home","Unser Angebot","Über uns","Neuigkeiten","Kontakt"]));
ok("Verzeichnis: Angebote unter Unser Angebot", JSON.stringify(await p.$$eval("#seiten .unterseiten .thema",l=>l.map(x=>x.textContent)))===JSON.stringify(["Für Privatpersonen","Für Unternehmen","Für Stiftungen"]));
ok("Verzeichnis: Rechtliches", JSON.stringify(await p.$$eval("#rechtliches .thema",l=>l.map(x=>x.textContent)))===JSON.stringify(["Impressum","Disclaimer","Datenschutz"]));
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
  await p.screenshot({path:`${shots}/v-${name}.png`,fullPage:true});
}
// Über uns: Text ändern, speichern, Website, Knopfbeschriftung
await open("kapitel/ueber-uns.md");
const name=await p.$('[data-pfad="sparring.name"] input'); await name.click({count:3}); await p.keyboard.type("Patrick Testname"); await sleep(200); await speichern();
ok("Über uns gespeichert in Feldern", read("kapitel/ueber-uns.md").includes("name: Patrick Testname"));
await sleep(1800); ok("Über uns auf Website", fs.readFileSync(`${site}/ueber-uns/index.html`,"utf8").includes("Patrick Testname"));
ok("Status zeigt aktuell", (await p.$eval("#setz-status",e=>e.textContent)).startsWith("Website aktuell"));
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
await p.click("#menue"); await sleep(1200); ok("Menü-Haken gespeichert", read(nrel).includes("menue: true"));
await p.screenshot({path:`${shots}/neue-seite.png`,fullPage:true});
await klick("Veröffentlichen"); await sleep(300); await p.click("#frage-ja"); await sleep(3000);
ok("Neue Seite online", fs.existsSync(`${site}/fuer-familien/index.html`)); const nh=fs.readFileSync(`${site}/fuer-familien/index.html`,"utf8"); ok("Neue Seite: Inhalt, Spalten, Band", nh.includes("Wir beraten Familien")&&nh.includes("spalten-2-1")&&nh.includes('class="band"')&&nh.includes("<h1>Für Familien</h1>"));
await sleep(1500); ok("Neue Seite im Menü auf anderen Seiten", fs.readFileSync(`${site}/kontakt/index.html`,"utf8").includes('href="/fuer-familien"'));
ok("Neue Seite in Sitemap", fs.readFileSync(`${site}/sitemap.xml`,"utf8").includes("/fuer-familien"));
ok("Verzeichnis: neue Seite im Menü vor Neuigkeiten", (await p.$$eval("#seiten > .eintrag .thema",l=>l.map(x=>x.textContent))).join()==="Home,Unser Angebot,Über uns,Für Familien,Neuigkeiten,Kontakt");
await klick("Kopie anlegen"); await sleep(1500); const krel=await p.evaluate(()=>decodeURIComponent(location.hash.slice(1))); ok("Kopie behält Felder", read(krel).includes("vorlage: abschnitte") && !(await p.$(".milkdown .ProseMirror")));
ok("Verzeichnis: Kopie unter Weitere Seiten", await p.$eval("#weitere-gruppe",d=>!d.hidden&&d.open&&d.textContent.includes("(Kopie)")));
await klick("Löschen"); await sleep(300); await p.click("#frage-ja"); await sleep(1000); ok("Kopie im Papierkorb, Rückgängig", !!(await p.$(".toast.sichtbar button")));
await p.screenshot({path:`${shots}/rueckgaengig.png`});
await p.click(".toast.sichtbar button"); await sleep(1200); ok("Rückgängig holt zurück", fs.existsSync(`${content}/${krel}`));
// Startseite nicht kopierbar
await open("kapitel/willkommen.md"); ok("Startseite ohne Kopie", !(await p.evaluate(()=>[...document.querySelectorAll("#aktionen button")].some(x=>x.textContent==="Kopie anlegen"))));
// Medien
await p.goto(`${base}/redaktion#medien`,{waitUntil:"networkidle2"}); await sleep(1800);
ok("Medien: Liste", (await p.$$(".medium")).length>=40); await p.screenshot({path:`${shots}/medien.png`});
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
await p.evaluate(()=>window.scrollTo(0,0)); const pm3=await p.$(".milkdown .ProseMirror"); await p.keyboard.press("ArrowRight"); for(let i=0;i<30;i++){await p.keyboard.type("Zeile");await p.keyboard.press("Enter");} await sleep(1500); await p.evaluate(()=>window.scrollTo(0,700)); await sleep(300); const klebe=await p.evaluate(()=>{const t=document.querySelector(".milkdown-top-bar").getBoundingClientRect();const l=document.querySelector(".leiste").getBoundingClientRect();return {t:t.top,l:l.bottom}});
ok("Computer: Werkzeugleiste klebt unter der Leiste", klebe.t>=klebe.l-3&&klebe.t<klebe.l+10); await p.screenshot({path:`${shots}/werkzeugleiste.png`}); await p.evaluate(()=>window.scrollTo(0,0)); await p.keyboard.down("Shift"); await p.keyboard.press("ArrowUp"); await p.keyboard.up("Shift"); await sleep(200);
await p.click("#bild-aus-medien"); await sleep(800); await p.waitForSelector(".medium-wahl"); await p.click(".medium-wahl"); await sleep(1800); const mitBild=/!\[[^\]]*\]\(\.\.\/media\//.test(read(br)); ok("Bild aus Medien im Newsletter, Markierung bleibt", mitBild && read(br).includes("**Autosave-Test") && read(br).includes("Zeile")); if(!mitBild||!read(br).includes("Zeile")||!read(br).includes("**Autosave-Test")) console.log("  Datei:",JSON.stringify(read(br).slice(0,160)),JSON.stringify(read(br).slice(-200)));
await p.screenshot({path:`${shots}/newsletter.png`});
const ph=await b.newPage(); await ph.setViewport({width:390,height:844,isMobile:true,hasTouch:true,deviceScaleFactor:2}); await ph.goto(`${base}/redaktion#${br}`,{waitUntil:"networkidle2"}); await sleep(1200);
ok("Telefon: Werkzeugleiste sichtbar", await ph.evaluate(()=>{const b=document.querySelector(".milkdown-top-bar");return !!b&&getComputedStyle(b).display!=="none"})); await ph.screenshot({path:`${shots}/tel-newsletter.png`});
await ph.goto(`${base}/redaktion#medien`,{waitUntil:"networkidle2"}); await sleep(1500); await ph.screenshot({path:`${shots}/tel-medien.png`}); await ph.close();
const real=errs.filter(e=>!/ERR_|favicon|404|409|422|400|WebSocket|websocket/.test(e)); console.log("Browserfehler:",real.slice(0,6),errs.length); console.log(fails?`${fails} FEHLGESCHLAGEN`:"ALLE OK");
await b.close();
server.kill();
if (!process.env.SHOTS) fs.rmSync(arbeit, { recursive: true, force: true });
process.exit(fails ? 1 : 0);
