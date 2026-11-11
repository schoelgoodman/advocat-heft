import * as crepeModule from "@milkdown/crepe";
import * as milkdownCore from "@milkdown/kit/core";
import { TextSelection, type EditorState } from "@milkdown/kit/prose/state";
import * as milkdownUtils from "@milkdown/kit/utils";
import "@milkdown/crepe/theme/common/style.css";
import "@milkdown/crepe/theme/frame.css";
import "./redaktion.css";
import { EINMALIG, klartextBloecke, VORLAGE_VON, vorlageName } from "../content/seiten.ts";
import type { Art, ContentDocument } from "../content/document.ts";
import { mountAssistent, type AktionArt, type Lage, type SeiteKurz } from "./assistent.ts";
import { allgemeinAnsicht } from "./ansichten/allgemein.ts";
import { starteEinstellungen } from "./einstellungen.ts";
import { medienAnsicht, waehleMedium, type MedienFilter } from "./ansichten/medien.ts";
import { bloecke, markiereUnterschiede, norm } from "./ansichten/vergleich.ts";
import { verlaufAnsicht } from "./ansichten/verlauf.ts";
import { h, toast } from "./dom.ts";
import { HOME, KONTAKT, MENUE_NAME_MAX, menueBezeichnung, menueOrt, type MenueOrt } from "../content/menue.ts";
import { verschiebe, zieheStart } from "./felder/ziehen.ts";
import { seitenBaum, seitenName, verschiebbar, type BaumPunkt } from "./verzeichnis.ts";
import { mountSeite, type FelderEditor } from "./felder/seite.ts";

interface CrepeApi {
  markdownUpdated(fn: (ctx: unknown, markdown: string, prev: string) => void): void;
}

interface CrepeEditor {
  create(): Promise<unknown>;
  destroy(): Promise<unknown>;
  getMarkdown(): string;
  on(fn: (api: CrepeApi) => void): unknown;
  editor: { action(fn: unknown): void };
}

interface CrepeCtor {
  new (config: {
    root: HTMLElement;
    defaultValue: string;
    features?: Record<string, boolean>;
    featureConfigs?: Record<string, unknown>;
  }): CrepeEditor;
  Feature: {
    CodeMirror: string;
    Latex: string;
    AI: string;
    TopBar: string;
    ImageBlock: string;
    BlockEdit: string;
    Toolbar: string;
    Placeholder: string;
  };
}

const Crepe = (crepeModule as unknown as { Crepe: CrepeCtor }).Crepe;
// Die Typen von @milkdown/utils lösen unter NodeNext nicht auf. Daher von Hand, wie bei Crepe.
const { editorViewCtx } = milkdownCore as unknown as { editorViewCtx: unknown };
const { insert, replaceAll } = milkdownUtils as unknown as { insert(markdown: string): unknown; replaceAll(markdown: string, flush?: boolean): unknown };

interface PageSummary {
  rel: string;
  titel: string;
  art: Art;
  datum: string;
  nummer: number | null;
  entwurf: boolean;
  href: string;
  auszug: string;
  vorlage: ContentDocument["vorlage"];
  menue?: MenueOrt;
  menueName?: string | null;
  geloeschtAm?: string;
}

/** `version`: Stand der Datei beim Laden. Wer speichert, nennt ihn, damit nichts still überschrieben wird. */
type Doc = ContentDocument & { href: string; version: string };

interface Anfrage {
  id: string;
  eingang: string;
  vorname: string;
  name: string;
  email: string;
  nachricht: string;
  telegram?: "gesendet" | "fehler" | "aus";
  status: "neu" | "gelesen" | "erledigt";
  seit?: string;
  /** Ab dann löscht der Server die Anfrage (Frist ab Eingang, siehe Datenschutz). */
  loeschtAm: string;
}

type AnfragenFilter = "offen" | "erledigt" | "alle";

const root = document.querySelector<HTMLElement>("#redaktion");
if (!root) throw new Error("Redaktion fehlt");

let crepe: CrepeEditor | null = null;
/** Statt Crepe, wenn die offene Seite Felder hat. Es ist immer nur eines von beiden da. */
let felder: FelderEditor | null = null;
/** Eine Online-Seite hat Änderungen, die noch nicht auf der Website sind. */
let liveUngespeichert = false;
let speichernKnopf: HTMLButtonElement | null = null;
let verwerfenKnopf: HTMLButtonElement | null = null;
let current: Doc | null = null;
let saveTimer: number | null = null;
let armed = false;
let alleBriefe: PageSummary[] = [];
let alleSeiten: PageSummary[] = [];
let sichtbar = 10;
let alleAnfragen: Anfrage[] = [];
let anfragenStand = "";
let anfragenFilter: AnfragenFilter = "offen";
let briefeFilter: "alle" | "entwuerfe" | "online" = "alle";
let wuenscheFilter: "offen" | "erledigt" | "alle" = "offen";

interface Wunsch {
  id: string;
  art: "design" | "funktion" | "fehler";
  text: string;
  seite: string;
  eingang: string;
  status: "offen" | "erledigt";
  erledigtAm?: string;
  telegram: "gesendet" | "fehler" | "aus";
  anhaenge?: Anhang[];
}
/** Eine Datei zu einem Wunsch, wie sie der Server nach dem Hochladen nennt. */
interface Anhang {
  id: string;
  name: string;
  typ: string;
  groesse: number;
}
let alleWuensche: Wunsch[] = [];
let gewaehlt: string | null = null;
/** Die gespeicherte Reihenfolge des Menüs. */
let menueReihe: string[] = [];
/** Während «Menü ordnen»: die Reihenfolge in Arbeit. Sonst null. */
let ordnung: string[] | null = null;
/** Ab hier wird es im Kopf der Website eng. */
const MENUE_NAME_LANG = 24;

// Hell oder dunkel und die Schriftgrösse gelten, bevor etwas zu sehen ist.
starteEinstellungen();
root.innerHTML = `
  <button type="button" class="verzeichnis-auf" id="verzeichnis-auf" title="Verzeichnis zeigen" aria-label="Verzeichnis zeigen" aria-expanded="false">
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
  </button>
  <div class="schleier" aria-hidden="true"></div>
  <div class="redaktion">
    <aside id="verzeichnis">
      <div class="verzeichnis-kopf">
        <button type="button" class="wort" id="heim" title="Zur Startseite">
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M3 11 12 4l9 7M6 9.5V20h4.5v-5.5h3V20H18V9.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>
        Redaktion
      </button>
      <a class="knopf zur-website" id="zur-website" href="/">
        <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M3.5 12h17M12 3.5c2.4 2.3 3.6 5.1 3.6 8.5s-1.2 6.2-3.6 8.5c-2.4-2.3-3.6-5.1-3.6-8.5s1.2-6.2 3.6-8.5Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>
        Zur Website
      </a>
      </div>
      <p class="kategorie">Täglich</p>
      <details id="briefe-gruppe">
        <summary><button type="button" class="gruppe-titel" id="briefe-titel">Newsletter</button><span class="zahl" id="briefe-zahl" title="Entwürfe, noch nicht veröffentlicht"></span></summary>
        <nav id="briefe"></nav>
        <button type="button" class="leise mehr" id="mehr" hidden></button>
      </details>
      <details id="anfragen-gruppe">
        <summary><button type="button" class="gruppe-titel" id="anfragen-titel">Kontaktaufnahme</button><span class="zahl neu" id="anfragen-zahl"></span><span class="zahl offen" id="anfragen-gelesen" title="Gelesen, aber noch nicht erledigt"></span></summary>
        <nav id="anfragen-liste"></nav>
      </details>
      <p class="kategorie">Seiten</p>
      <nav id="seiten"></nav>
      <button type="button" class="leise mehr" id="menue-ordnen">Menü ordnen</button>
      <div class="ordnen-leiste" id="ordnen-leiste" hidden>
        <p class="leise">Ziehen oder mit den Pfeilen verschieben. Home und Kontakt bleiben fest. «Speichern» ändert das Menü sofort auf der Website.</p>
        <div class="aktionen">
          <button type="button" class="haupt" id="ordnen-speichern">Speichern</button>
          <button type="button" id="ordnen-abbrechen">Abbrechen</button>
        </div>
      </div>
      <details id="rechtliches-gruppe">
        <summary><span class="gruppe-titel">Rechtliches</span></summary>
        <nav id="rechtliches"></nav>
      </details>
      <details id="weitere-gruppe" hidden>
        <summary><span class="gruppe-titel">Weitere Seiten</span></summary>
        <nav id="weitere"></nav>
      </details>
      <button type="button" class="leise mehr" id="seite-neu">Neue Seite anlegen</button>
      <p class="kategorie">Verwaltung</p>
      <!-- Einstellungen zuerst, dann der Inhalt von «jetzt verbessern» bis «gelöscht», Hilfe zuletzt. -->
      <button type="button" class="zeile-link" id="allgemein-link">Allgemein</button>
      <button type="button" class="zeile-link" id="check-link"><span>Website-Check</span><span class="zahl offen" id="check-zahl"></span></button>
      <button type="button" class="zeile-link" id="medien-link">Medien</button>
      <button type="button" class="zeile-link" id="verlauf-link">Verlauf</button>
      <details id="papierkorb-gruppe">
        <summary><button type="button" class="gruppe-titel" id="papierkorb-titel">Papierkorb</button><span class="zahl" id="papierkorb-zahl"></span></summary>
        <p class="leise" id="papierkorb-hinweis"></p>
        <nav id="papierkorb"></nav>
        <button type="button" class="leise mehr gefahr" id="papierkorb-leeren">Papierkorb leeren</button>
      </details>
      <details id="wuensche-gruppe">
        <summary><button type="button" class="gruppe-titel" id="wuensche-link">Support</button><span class="zahl offen" id="wuensche-zahl" title="Noch nicht erledigt"></span><span class="marke neu" id="wuensche-neu" hidden>Neu</span></summary>
        <nav id="wuensche-liste"></nav>
      </details>
      <p class="setz-status" id="setz-status" role="status"></p>
    </aside>
    <main>
      <div class="setz-warnung" id="setz-warnung" role="alert" hidden></div>
      <section id="allgemein-seite" hidden></section>
      <section id="medien-seite" hidden></section>
      <section id="verlauf-seite" hidden></section>
      <section id="check-seite" hidden>
        <h1>Website-Check</h1>
        <p class="leise einleitung">Was Google von den Seiten liest: ein Thema, einen Einstiegsabsatz und Bilder mit Beschreibung. Die wichtigsten Seiten zuerst. Seite öffnen und im Assistenten «Seite prüfen» klicken, er schlägt die Verbesserung vor.</p>
        <p class="check-stand" id="check-stand" aria-live="polite">Wird geprüft …</p>
        <ol class="aenderungen" id="check-liste"></ol>
      </section>
      <section id="start">
        <h1 id="gruss">Guten Tag, Patrick.</h1>
        <div class="naechstes" id="start-naechstes" hidden></div>
        <div class="aufgaben">
          <article class="aufgabe" id="start-briefe"></article>
          <article class="aufgabe" id="start-anfragen"></article>
          <article class="aufgabe breit" id="start-zuletzt" hidden></article>
        </div>
        <div class="start-support">
          <div>
            <h2>Support <button type="button" class="zahl offen" id="start-support-offen" title="Noch nicht erledigt. Zum Support." hidden></button></h2>
            <p class="leise">Fehlt etwas in der Redaktion, soll die Website anders aussehen oder funktioniert etwas nicht?</p>
          </div>
          <div class="aktionen">
            <button type="button" id="start-wunsch">An Support schreiben</button>
            <button type="button" id="start-fehler">Bug melden</button>
          </div>
        </div>
      </section>
      <section id="anfragen" hidden>
        <h1>Kontaktaufnahme</h1>
        <div class="kacheln" id="anfragen-kacheln" role="group" aria-label="Anfragen filtern"></div>
        <p class="leise" id="anfragen-text"></p>
        <p class="leise frist" id="anfragen-frist"></p>
        <ol id="anfragen-karten"></ol>
      </section>
      <section id="briefe-seite" hidden>
        <div class="seitenkopf">
          <h1>Newsletter</h1>
          <button type="button" class="haupt" id="briefe-neu">Neuen Newsletter schreiben</button>
        </div>
        <div class="kacheln" id="briefe-kacheln" role="group" aria-label="Newsletter filtern"></div>
        <input type="search" class="suche" id="briefe-suche" placeholder="Nach Thema oder Nummer suchen …" aria-label="Newsletter suchen">
        <p class="leise" id="briefe-text"></p>
        <ol id="briefe-karten"></ol>
      </section>
      <section id="papierkorb-seite" hidden>
        <div class="seitenkopf">
          <h1>Papierkorb</h1>
          <button type="button" class="leise gefahr" id="papierkorb-seite-leeren" hidden>Papierkorb leeren</button>
        </div>
        <div class="kacheln" id="papierkorb-kacheln" role="group" aria-label="Papierkorb filtern"></div>
        <p class="leise" id="papierkorb-text"></p>
        <ol id="papierkorb-karten"></ol>
      </section>
      <section id="wuensche-seite" hidden>
        <h1>Support</h1>
        <p class="leise einleitung">Was in der Redaktion fehlt, an der Website anders sein soll oder in der Redaktion nicht funktioniert. Alles geht per Telegram an die Betreuung der Website. Beim Formulieren hilft der Assistent rechts.</p>
        <form class="neuer-wunsch" id="wunsch-form">
          <label>Art
            <select id="wunsch-art">
              <option value="funktion">Feature</option>
              <option value="fehler">Bug</option>
              <option value="design">Styling</option>
            </select>
          </label>
          <textarea id="wunsch-text" rows="4" placeholder="Was fehlt oder soll anders sein, und wozu?"></textarea>
          <ul class="anhaenge" id="wunsch-anhaenge" aria-label="Anhänge" hidden></ul>
          <div class="anhang-knoepfe">
            <button type="button" id="wunsch-foto">Foto aufnehmen</button>
            <button type="button" id="wunsch-datei">Datei anhängen</button>
            <span class="leise">Bildschirmfoto, Foto oder PDF. Höchstens 5 Dateien, je 10 MB.</span>
            <input type="file" id="wunsch-foto-input" accept="image/*" capture="environment" hidden>
            <input type="file" id="wunsch-datei-input" accept="image/*,application/pdf" multiple hidden>
          </div>
          <p class="leise telegram-hinweis">Bitte keine vertraulichen Angaben wie Kundennamen, Beträge oder Vertragsdetails, auch nicht auf Bildschirmfotos und Fotos: Support-Nachrichten gehen über Telegram, also über Server im Ausland.</p>
          <div class="aktionen">
            <button type="submit" class="haupt" id="wunsch-senden">An Support senden</button>
            <p class="leise" id="wunsch-meldung" aria-live="polite"></p>
          </div>
        </form>
        <div class="kacheln" id="wuensche-kacheln" role="group" aria-label="Support filtern"></div>
        <ol id="wuensche-karten"></ol>
      </section>
      <form id="blatt" hidden>
        <div class="leiste">
          <p class="stand" id="stand"></p>
          <p class="speicher" id="speicher" aria-live="polite"></p>
          <div class="aktionen" id="aktionen"></div>
        </div>
        <p class="kennung" id="kennung"></p>
        <textarea id="titel" class="titel" rows="1" autocomplete="off"></textarea>
        <div class="angaben" id="angaben">
          <label class="datum" id="nummer-feld">Nummer <input type="number" id="nummer" min="1" max="9999" step="1" inputmode="numeric"></label>
          <label class="datum" id="datum-feld">Datum <input type="date" id="datum"></label>
          <label class="datum" id="menue-feld">Menü <select id="menue"><option value="true">Hauptmenü</option><option value="angebot">Unter «Unser Angebot»</option><option value="">Nicht im Menü</option></select></label>
          <label class="datum" id="menue-name-feld">Name im Menü <input type="text" id="menue-name" maxlength="${MENUE_NAME_MAX}" autocomplete="off"></label>
          <label class="datum adresse-feld" id="adresse-feld">Adresse <span class="adresse-eingabe"><span class="adresse-vor" id="adresse-vor"></span><input type="text" id="adresse" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="done"></span></label>
        </div>
        <p class="nummer-hinweis" id="menue-hinweis" hidden>Dieser Name ist lang für das Menü. Am besten «Name im Menü» kürzer wählen.</p>
        <p class="nummer-hinweis" id="adresse-hinweis" hidden></p>
        <p class="nummer-hinweis" id="nummer-hinweis" hidden></p>
        <div class="google-hinweise" id="google-hinweise" role="note" hidden aria-live="polite"></div>
        <div id="editor"></div>
        <div id="felder" hidden></div>
        <p class="tipp" id="tipp">Tipp: Am Anfang einer leeren Zeile <kbd>/</kbd> tippen für Zwischentitel, Liste oder Bild. Text markieren für fett, kursiv oder Link. <button type="button" class="leise" id="bild-aus-medien">Bild aus Medien einfügen</button></p>
        <details id="fassungen-gruppe">
          <summary>Frühere Fassungen</summary>
          <p class="leise">Jede Fassung lässt sich ansehen und zurückholen. Nichts geht verloren.</p>
          <ol id="fassungen"></ol>
          <article id="vorschau" hidden></article>
        </details>
      </form>
    </main>
  </div>
  <dialog id="kamera" class="kamera">
    <h2>Foto aufnehmen</h2>
    <video id="kamera-bild" autoplay playsinline muted></video>
    <div class="aktionen">
      <button type="button" id="kamera-zu">Abbrechen</button>
      <button type="button" id="kamera-los" class="haupt">Aufnehmen</button>
    </div>
  </dialog>
  <dialog id="frage">
    <form method="dialog">
      <h2 id="frage-titel"></h2>
      <p id="frage-text"></p>
      <div class="aktionen">
        <button value="nein" id="frage-nein">Abbrechen</button>
        <button value="ja" id="frage-ja" class="haupt"></button>
      </div>
    </form>
  </dialog>
`;

const briefe = root.querySelector<HTMLElement>("#briefe")!;
const seiten = root.querySelector<HTMLElement>("#seiten")!;
const mehr = root.querySelector<HTMLButtonElement>("#mehr")!;
const briefeGruppe = root.querySelector<HTMLDetailsElement>("#briefe-gruppe")!;
const rechtlichesGruppe = root.querySelector<HTMLDetailsElement>("#rechtliches-gruppe")!;
const rechtliches = root.querySelector<HTMLElement>("#rechtliches")!;
const weitereGruppe = root.querySelector<HTMLDetailsElement>("#weitere-gruppe")!;
const weitere = root.querySelector<HTMLElement>("#weitere")!;
const papierkorb = root.querySelector<HTMLElement>("#papierkorb")!;
const papierkorbZahl = root.querySelector<HTMLElement>("#papierkorb-zahl")!;
const papierkorbLeeren = root.querySelector<HTMLButtonElement>("#papierkorb-leeren")!;
const papierkorbHinweis = root.querySelector<HTMLElement>("#papierkorb-hinweis")!;
const papierkorbGruppe = root.querySelector<HTMLDetailsElement>("#papierkorb-gruppe")!;
const papierkorbSeite = root.querySelector<HTMLElement>("#papierkorb-seite")!;
const papierkorbSeiteLeeren = root.querySelector<HTMLButtonElement>("#papierkorb-seite-leeren")!;
const papierkorbKacheln = root.querySelector<HTMLElement>("#papierkorb-kacheln")!;
const papierkorbText = root.querySelector<HTMLElement>("#papierkorb-text")!;
const papierkorbKarten = root.querySelector<HTMLOListElement>("#papierkorb-karten")!;
let papierkorbAnzahl = 0;
let geloeschte: PageSummary[] = [];
let papierkorbFilter: "alle" | "briefe" | "seiten" = "alle";
for (const knopf of [papierkorbLeeren, papierkorbSeiteLeeren]) {
  knopf.addEventListener("click", () => {
    void deleteFromTrash(null, papierkorbAnzahl === 1 ? "Ein Eintrag" : `Alle ${papierkorbAnzahl} Einträge`);
  });
}
const start = root.querySelector<HTMLElement>("#start")!;
const anfragenGruppe = root.querySelector<HTMLDetailsElement>("#anfragen-gruppe")!;
const anfragenListe = root.querySelector<HTMLElement>("#anfragen-liste")!;
const anfragenZahl = root.querySelector<HTMLElement>("#anfragen-zahl")!;
const anfragenGelesen = root.querySelector<HTMLElement>("#anfragen-gelesen")!;
const anfragenSeite = root.querySelector<HTMLElement>("#anfragen")!;
const briefeSeite = root.querySelector<HTMLElement>("#briefe-seite")!;
const briefeKacheln = root.querySelector<HTMLElement>("#briefe-kacheln")!;
const briefeSuche = root.querySelector<HTMLInputElement>("#briefe-suche")!;
const briefeText = root.querySelector<HTMLElement>("#briefe-text")!;
const briefeKarten = root.querySelector<HTMLOListElement>("#briefe-karten")!;
const wuenscheSeite = root.querySelector<HTMLElement>("#wuensche-seite")!;
const wuenscheGruppe = root.querySelector<HTMLDetailsElement>("#wuensche-gruppe")!;
const wuenscheListe = root.querySelector<HTMLElement>("#wuensche-liste")!;
const wuenscheKacheln = root.querySelector<HTMLElement>("#wuensche-kacheln")!;
const wuenscheKarten = root.querySelector<HTMLOListElement>("#wuensche-karten")!;
const wuenscheZahl = root.querySelector<HTMLElement>("#wuensche-zahl")!;
const wuenscheNeu = root.querySelector<HTMLElement>("#wuensche-neu")!;
const wunschForm = root.querySelector<HTMLFormElement>("#wunsch-form")!;
const wunschArt = root.querySelector<HTMLSelectElement>("#wunsch-art")!;
const wunschText = root.querySelector<HTMLTextAreaElement>("#wunsch-text")!;
const wunschMeldung = root.querySelector<HTMLElement>("#wunsch-meldung")!;
const wunschAnhaenge = root.querySelector<HTMLUListElement>("#wunsch-anhaenge")!;
const wunschFotoInput = root.querySelector<HTMLInputElement>("#wunsch-foto-input")!;
const wunschDateiInput = root.querySelector<HTMLInputElement>("#wunsch-datei-input")!;
const kamera = root.querySelector<HTMLDialogElement>("#kamera")!;
const kameraBild = root.querySelector<HTMLVideoElement>("#kamera-bild")!;
const anfragenText = root.querySelector<HTMLElement>("#anfragen-text")!;
const anfragenFrist = root.querySelector<HTMLElement>("#anfragen-frist")!;
const anfragenKacheln = root.querySelector<HTMLElement>("#anfragen-kacheln")!;
const startAnfragen = root.querySelector<HTMLElement>("#start-anfragen")!;
const startBriefe = root.querySelector<HTMLElement>("#start-briefe")!;
const briefeZahl = root.querySelector<HTMLElement>("#briefe-zahl")!;
const startNaechstes = root.querySelector<HTMLElement>("#start-naechstes")!;
const startZuletzt = root.querySelector<HTMLElement>("#start-zuletzt")!;
const startSupportOffen = root.querySelector<HTMLButtonElement>("#start-support-offen")!;
const checkSeite = root.querySelector<HTMLElement>("#check-seite")!;
const checkLink = root.querySelector<HTMLButtonElement>("#check-link")!;
const checkZahl = root.querySelector<HTMLElement>("#check-zahl")!;
const checkStand = root.querySelector<HTMLElement>("#check-stand")!;
const checkListe = root.querySelector<HTMLOListElement>("#check-liste")!;
const googleHinweise = root.querySelector<HTMLElement>("#google-hinweise")!;
const anfragenKarten = root.querySelector<HTMLOListElement>("#anfragen-karten")!;
const form = root.querySelector<HTMLFormElement>("#blatt")!;
const stand = root.querySelector<HTMLElement>("#stand")!;
const speicher = root.querySelector<HTMLElement>("#speicher")!;
const aktionen = root.querySelector<HTMLElement>("#aktionen")!;
const kennung = root.querySelector<HTMLElement>("#kennung")!;
const titelInput = root.querySelector<HTMLTextAreaElement>("#titel")!;
const datumFeld = root.querySelector<HTMLElement>("#datum-feld")!;
const datumInput = root.querySelector<HTMLInputElement>("#datum")!;
const nummerFeld = root.querySelector<HTMLElement>("#nummer-feld")!;
const nummerInput = root.querySelector<HTMLInputElement>("#nummer")!;
const nummerHinweis = root.querySelector<HTMLElement>("#nummer-hinweis")!;
const menueFeld = root.querySelector<HTMLElement>("#menue-feld")!;
const menueInput = root.querySelector<HTMLSelectElement>("#menue")!;
const menueNameFeld = root.querySelector<HTMLElement>("#menue-name-feld")!;
const menueNameInput = root.querySelector<HTMLInputElement>("#menue-name")!;
const menueHinweis = root.querySelector<HTMLElement>("#menue-hinweis")!;
const menueOrdnen = root.querySelector<HTMLButtonElement>("#menue-ordnen")!;
const ordnenLeiste = root.querySelector<HTMLElement>("#ordnen-leiste")!;
const allgemeinSeite = root.querySelector<HTMLElement>("#allgemein-seite")!;
const allgemeinLink = root.querySelector<HTMLButtonElement>("#allgemein-link")!;
const medienSeite = root.querySelector<HTMLElement>("#medien-seite")!;
const verlaufSeite = root.querySelector<HTMLElement>("#verlauf-seite")!;
const medienLink = root.querySelector<HTMLButtonElement>("#medien-link")!;
const verlaufLink = root.querySelector<HTMLButtonElement>("#verlauf-link")!;
const setzStatus = root.querySelector<HTMLElement>("#setz-status")!;
const setzWarnung = root.querySelector<HTMLElement>("#setz-warnung")!;
const adresseFeld = root.querySelector<HTMLElement>("#adresse-feld")!;
const adresseVor = root.querySelector<HTMLElement>("#adresse-vor")!;
const adresseInput = root.querySelector<HTMLInputElement>("#adresse")!;
const adresseHinweis = root.querySelector<HTMLElement>("#adresse-hinweis")!;
const editorHost = root.querySelector<HTMLElement>("#editor")!;
// Die Werkzeugleiste des Texts klebt direkt unter der Leiste mit den Knöpfen, wie hoch die auch ist.
const leiste = root.querySelector<HTMLElement>(".leiste")!;
new ResizeObserver(() => {
  const klebt = getComputedStyle(leiste).position === "sticky";
  document.documentElement.style.setProperty("--leiste-hoehe", klebt ? `${leiste.offsetHeight}px` : "0px");
}).observe(leiste);
const felderHost = root.querySelector<HTMLElement>("#felder")!;
const tipp = root.querySelector<HTMLElement>("#tipp")!;
const fassungenGruppe = root.querySelector<HTMLDetailsElement>("#fassungen-gruppe")!;
const fassungen = root.querySelector<HTMLOListElement>("#fassungen")!;
const vorschau = root.querySelector<HTMLElement>("#vorschau")!;

const frage = root.querySelector<HTMLDialogElement>("#frage")!;
const frageTitel = root.querySelector<HTMLElement>("#frage-titel")!;
const frageText = root.querySelector<HTMLElement>("#frage-text")!;
const frageJa = root.querySelector<HTMLButtonElement>("#frage-ja")!;
const frageNein = root.querySelector<HTMLButtonElement>("#frage-nein")!;

/** Fragt auf der Seite statt mit dem Browser-Dialog. Ohne `nein` ist es nur ein Hinweis. */
function ask(options: { titel: string; text: string; ja: string; nein?: string; gefahr?: boolean }): Promise<boolean> {
  frageTitel.textContent = options.titel;
  frageText.textContent = options.text;
  frageJa.textContent = options.ja;
  frageJa.classList.toggle("gefahr", options.gefahr === true);
  frageNein.hidden = options.nein == null;
  frageNein.textContent = options.nein ?? "";
  frage.returnValue = "";
  frage.showModal();
  frageJa.focus();
  return new Promise((resolve) => {
    frage.addEventListener("close", () => resolve(frage.returnValue === "ja"), { once: true });
  });
}

const eingangFormat = new Intl.DateTimeFormat("de-CH", { dateStyle: "medium", timeStyle: "short" });
const tagFormat = new Intl.DateTimeFormat("de-CH", { dateStyle: "medium" });
const uhrFormat = new Intl.DateTimeFormat("de-CH", { timeStyle: "short" });

/** Die öffentliche Adresse kommt vom Server (PUBLIC_URL). Lokal ist es derselbe Server. */
let publicOrigin = "";

const dateFormat = new Intl.DateTimeFormat("de-CH", { day: "numeric", month: "short", year: "numeric" });

function shortDate(iso: string): string {
  const date = new Date(`${iso}T12:00:00`);
  return Number.isNaN(date.getTime()) ? "" : dateFormat.format(date);
}

/** Der Titel eines Newsletters ist „Newsletter 36: Thema“. Bearbeitet wird nur das Thema. */
function thema(titel: string): string {
  return titel.replace(/^Newsletter\s+\d+\s*:?\s*/i, "").trim();
}

function briefTitel(nummer: number | null, text: string): string {
  const head = `Newsletter ${nummer ?? ""}`.trim();
  return text.trim() ? `${head}: ${text.trim()}` : head;
}

/** Die Startseite bleibt immer online. */
const STARTSEITE = "kapitel/willkommen.md";

function isBrief(doc: Pick<ContentDocument, "art"> | null | undefined): boolean {
  return doc?.art === "brief";
}

/**
 * Ein Bild allein in seiner Zeile. Der Editor macht daraus einen Bildblock, und der speichert
 * anders als die Website liest: die Beschreibung im Titel, an ihrer Stelle das Grössenverhältnis.
 * `![Beschreibung](bild.png)` in der Datei ist im Editor `![1](bild.png "Beschreibung")`.
 */
const BILD_ZEILE = /^!\[((?:[^\]\\]|\\.)*)\]\((\S+?)(?:\s+"((?:[^"\\]|\\.)*)")?\)[ \t]*$/gm;

/** «1.00»: das Grössenverhältnis, das der Editor früher als Beschreibung in die Datei schrieb. */
const VERHAELTNIS = /^\d+(\.\d+)?$/;

const ohneEscape = (value: string) => value.replace(/\\(.)/g, "$1");

function forEditor(markdown: string): string {
  return markdown
    .replace(BILD_ZEILE, (_zeile, alt: string, src: string, titel: string | undefined) => {
      const text = (VERHAELTNIS.test(alt) ? "" : ohneEscape(alt)) || ohneEscape(titel ?? "");
      return text ? `![1](${src} "${text.replace(/["\\]/g, "\\$&")}")` : `![1](${src})`;
    })
    .replaceAll("](../media/", "](/media/");
}

function forFile(markdown: string): string {
  return markdown
    .replace(BILD_ZEILE, (_zeile, alt: string, src: string, titel: string | undefined) => {
      const text = ohneEscape(titel ?? "") || (VERHAELTNIS.test(alt) ? "" : ohneEscape(alt));
      return `![${text.replace(/[[\]\\]/g, "\\$&")}](${src})`;
    })
    .replaceAll("](/media/", "](../media/");
}

function esc(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function button(label: string, className: string, onClick: () => void): HTMLButtonElement {
  const element = document.createElement("button");
  element.type = "button";
  element.className = className;
  element.textContent = label;
  element.addEventListener("click", onClick);
  return element;
}

/** Das Titelfeld wächst mit dem Text, damit lange Themen ganz sichtbar bleiben. */
function fitTitel(): void {
  titelInput.style.height = "auto";
  titelInput.style.height = `${titelInput.scrollHeight}px`;
}

/** Eine Meldung, die das nächste „Gespeichert ✓“ nicht gleich überschreibt, etwa nach dem Word-Import. */
let haltMeldungBis = 0;

function setSaved(text: string, kind: "ok" | "busy" | "fehler" = "ok"): void {
  if (Date.now() < haltMeldungBis && (text === "Gespeichert ✓" || kind === "busy")) return;
  speicher.textContent = text;
  speicher.dataset.kind = kind;
}

async function uploadImage(file: File): Promise<string> {
  const response = await fetch("/api/media", {
    method: "POST",
    headers: { "x-filename": encodeURIComponent(file.name) },
    body: file,
  });
  if (!response.ok) {
    const fehler = (await response.json().catch(() => null)) as { error?: string } | null;
    const meldung = fehler?.error ?? "Bild wurde nicht gespeichert";
    setSaved(meldung, "fehler");
    haltMeldungBis = Date.now() + 8000;
    throw new Error(meldung);
  }
  const json = (await response.json()) as { url: string };
  return json.url.replace("../media/", "/media/");
}

/** Der Text der offenen Seite, wie ihn Assistent und Fassungsvergleich sehen. */
function aktuellerText(): string {
  if (felder) return felder.markdown();
  return crepe ? forFile(crepe.getMarkdown()).trim() : "";
}

function editorBereit(): boolean {
  return felder != null || crepe != null;
}

async function mountEditor(markdown: string): Promise<void> {
  armed = false;
  if (crepe) {
    await crepe.destroy();
    crepe = null;
  }
  felder = null;
  editorHost.replaceChildren();
  felderHost.replaceChildren();
  const hatFelder = current?.vorlage && current.felder ? current : null;
  editorHost.hidden = hatFelder != null;
  felderHost.hidden = hatFelder == null;
  tipp.hidden = hatFelder != null;
  if (hatFelder) {
    felder = mountSeite(felderHost, hatFelder.vorlage!, hatFelder.felder!, {
      seitenTitel: () => titelInput.value.trim() || current?.titel || "",
      geaendert: () => scheduleSave(),
      ladeBild: uploadImage,
      frage: ask,
    });
    armed = true;
    return;
  }
  const next = new Crepe({
    root: editorHost,
    defaultValue: forEditor(markdown),
    features: {
      [Crepe.Feature.CodeMirror]: false,
      [Crepe.Feature.Latex]: false,
      [Crepe.Feature.AI]: false,
      [Crepe.Feature.TopBar]: true,
    },
    featureConfigs: {
      // Auf allen Bildschirmen. Griff und Blase bei markiertem Text gibt es auf dem Telefon nicht (redaktion.css).
      [Crepe.Feature.TopBar]: {
        headingOptions: [
          { label: "Absatz", level: null },
          { label: "Zwischentitel", level: 2 },
          { label: "Kleiner Zwischentitel", level: 3 },
        ],
        buildTopBar: (bar: { getGroup(name: string): { group: { items: { key: string }[] } } }) => {
          const behalte = (name: string, ...keys: string[]) => {
            const gruppe = bar.getGroup(name).group;
            gruppe.items = gruppe.items.filter((item) => keys.includes(item.key));
          };
          behalte("formatting", "bold", "italic");
          behalte("list", "bullet-list", "ordered-list");
          behalte("insert", "link", "image");
          behalte("block");
          behalte("more");
        },
      },
      [Crepe.Feature.Placeholder]: { text: "Hier den Text schreiben …", mode: "doc" },
      [Crepe.Feature.Toolbar]: { linkLabel: "Link" },
      [Crepe.Feature.ImageBlock]: {
        onUpload: uploadImage,
        blockUploadButton: "Bild hochladen",
        blockUploadPlaceholderText: "oder Bildadresse einfügen",
        blockConfirmButton: "Übernehmen",
        // Auf der Website steht das nicht unter dem Bild: Es ist die Beschreibung, die Google liest.
        blockCaptionPlaceholderText: "Bildbeschreibung für Google: Was ist zu sehen?",
      },
      [Crepe.Feature.BlockEdit]: {
        textGroup: {
          label: "Text",
          text: { label: "Absatz" },
          h1: null,
          h2: { label: "Zwischentitel" },
          h3: { label: "Kleiner Zwischentitel" },
          h4: null,
          h5: null,
          h6: null,
          quote: { label: "Zitat" },
          divider: null,
        },
        listGroup: {
          label: "Liste",
          bulletList: { label: "Aufzählung" },
          orderedList: { label: "Nummerierte Liste" },
          taskList: null,
        },
        advancedGroup: {
          label: "Bild",
          image: { label: "Bild" },
          codeBlock: null,
          table: null,
          math: null,
        },
      },
    },
  });
  next.on((api) => {
    api.markdownUpdated((_ctx, markdownNow, prev) => {
      if (!armed || markdownNow === prev) return;
      scheduleSave();
    });
  });
  await next.create();
  crepe = next;
  // Crepe schreibt manche Zeilen anders, als sie in der Datei stehen.
  // Diese Fassung ist der Ausgangspunkt, kein Speichern.
  if (current && current.body.trim() === markdown.trim()) {
    current = { ...current, body: forFile(next.getMarkdown()).trim() };
  }
  armed = true;
}

const ICONS = {
  mehr: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="3" cy="8" r="1.4" fill="currentColor"/><circle cx="8" cy="8" r="1.4" fill="currentColor"/><circle cx="13" cy="8" r="1.4" fill="currentColor"/></svg>',
};

/** Ein Menü für alle Einträge im Verzeichnis. Es liegt über allem, damit das Verzeichnis es nicht abschneidet. */
const menue = document.createElement("div");
menue.className = "menue";
menue.popover = "auto";
menue.setAttribute("role", "menu");
root.append(menue);
let menueAnker: HTMLElement | null = null;
/** Drückt Patrick den «…» eines offenen Menüs, soll der Klick danach es nicht wieder öffnen. */
let menueSchliesst = false;
menue.addEventListener("toggle", (event) => {
  menueAnker?.setAttribute("aria-expanded", String((event as ToggleEvent).newState === "open"));
  if ((event as ToggleEvent).newState !== "closed") return;
  if (menue.contains(document.activeElement) || document.activeElement === document.body) menueAnker?.focus({ preventScroll: true });
});
menue.addEventListener("keydown", (event) => {
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
  event.preventDefault();
  const punkte = [...menue.querySelectorAll<HTMLButtonElement>("button")];
  const jetzt = punkte.indexOf(document.activeElement as HTMLButtonElement);
  punkte[(jetzt + (event.key === "ArrowDown" ? 1 : -1) + punkte.length) % punkte.length]?.focus();
});

function zeigeMenue(anker: HTMLElement, page: PageSummary): void {
  // Ein Klick auf denselben Knopf schliesst das Menü. Der Browser hat es beim Drücken schon zugemacht.
  if (menueSchliesst) {
    menueSchliesst = false;
    return;
  }
  menueAnker?.setAttribute("aria-expanded", "false");
  menueAnker = anker;
  const ansehen: [string, () => void] = page.entwurf
    ? ["Vorschau ↗", () => (page.rel === current?.rel ? void openPreview() : void window.open(`/api/preview?rel=${encodeURIComponent(page.rel)}`, "_blank"))]
    : ["Auf der Website ansehen ↗", () => void window.open(`${publicOrigin}${page.href}`, "_blank", "noopener")];
  const punkte: [string, () => void][] = [
    ["Öffnen", () => void openPage(page.rel)],
    ...(page.vorlage && EINMALIG.includes(page.vorlage) ? [] : [["Kopie anlegen", () => void copyPage(page.rel)] as [string, () => void]]),
    ansehen,
  ];
  menue.replaceChildren(
    ...punkte.map(([label, aktion]) => {
      const punkt = button(label, "", () => {
        menue.hidePopover();
        aktion();
      });
      punkt.setAttribute("role", "menuitem");
      return punkt;
    }),
  );
  menue.showPopover();
  const rahmen = anker.getBoundingClientRect();
  const unten = rahmen.bottom + 4 + menue.offsetHeight > window.innerHeight;
  menue.style.top = `${unten ? rahmen.top - 4 - menue.offsetHeight : rahmen.bottom + 4}px`;
  menue.style.left = `${Math.max(8, rahmen.right - menue.offsetWidth)}px`;
  menue.querySelector("button")?.focus();
}

function icon(svg: string, label: string, onClick: () => void): HTMLButtonElement {
  const element = document.createElement("button");
  element.type = "button";
  element.className = "werkzeug";
  element.title = label;
  element.setAttribute("aria-label", label);
  element.innerHTML = svg;
  element.addEventListener("click", onClick);
  return element;
}

function listItem(page: PageSummary): HTMLElement {
  const item = document.createElement("button");
  item.type = "button";
  item.dataset.rel = page.rel;
  const head = document.createElement("span");
  head.className = "kopfzeile";
  const text = document.createElement("span");
  text.className = "thema";
  if (page.art === "brief") {
    head.innerHTML = page.entwurf
      ? `<span class="marke entwurf">Entwurf</span> Nr. ${page.nummer ?? ""}`
      : `Nr. ${page.nummer ?? ""} · ${esc(shortDate(page.datum))}`;
    text.textContent = thema(page.titel) || "Noch ohne Thema";
    item.append(head, text);
  } else {
    head.innerHTML = `<span class="marke entwurf">Entwurf</span>`;
    text.textContent = seitenName(page);
    item.append(...(page.entwurf ? [head, text] : [text]));
  }
  item.addEventListener("click", () => void openPage(page.rel));

  // Veröffentlichen und Zurückziehen stehen beim offenen Blatt, nicht hier: ein Klick daneben wäre zu leicht.
  const werkzeuge = document.createElement("span");
  werkzeuge.className = "werkzeuge";
  const mehrKnopf = icon(ICONS.mehr, "Weitere Aktionen", () => zeigeMenue(mehrKnopf, page));
  mehrKnopf.setAttribute("aria-haspopup", "menu");
  mehrKnopf.setAttribute("aria-expanded", "false");
  mehrKnopf.addEventListener("pointerdown", () => {
    menueSchliesst = menueAnker === mehrKnopf && menue.matches(":popover-open");
  });
  werkzeuge.append(mehrKnopf);
  const zeile = document.createElement("div");
  zeile.className = "eintrag";
  zeile.append(item, werkzeuge);
  return zeile;
}

function trashItem(page: PageSummary): HTMLElement {
  const zeile = document.createElement("div");
  zeile.className = "eintrag geloescht";
  const text = document.createElement("span");
  text.className = "thema";
  const titel = trashTitel(page);
  text.textContent = titel;
  if (page.geloeschtAm) text.append(h("small", { class: "geloescht-am" }, `Gelöscht am ${tagFormat.format(new Date(page.geloeschtAm))}`));
  const loeschen = button("Endgültig löschen", "leise gefahr", () => void deleteFromTrash(page.rel, titel));
  zeile.append(text, button("Zurückholen", "leise", () => void restoreFromTrash(page.rel)), loeschen);
  return zeile;
}

function trashTitel(page: PageSummary): string {
  return isBrief(page) ? `Nr. ${page.nummer ?? ""} · ${thema(page.titel) || "Ohne Thema"}` : page.titel;
}

/** Eine Karte in der Übersicht des Papierkorbs, gebaut wie die der Newsletter. */
function trashKarte(page: PageSummary): HTMLElement {
  const karte = document.createElement("li");
  const brief = isBrief(page);
  const kopf = document.createElement("p");
  kopf.className = "kopfzeile";
  kopf.innerHTML = `<span class="marke entwurf">${brief ? "Newsletter" : "Seite"}</span> ${brief ? `Nr. ${page.nummer ?? ""} · ` : ""}${
    page.geloeschtAm ? `gelöscht am ${esc(tagFormat.format(new Date(page.geloeschtAm)))}` : "gelöscht"
  }`;
  const titel = document.createElement("h2");
  titel.textContent = brief ? thema(page.titel) || "Noch ohne Thema" : page.titel;
  const text = document.createElement("p");
  text.className = "auszug";
  text.textContent = page.auszug || "Noch kein Text.";
  const knoepfe = document.createElement("div");
  knoepfe.className = "aktionen";
  knoepfe.append(
    button("Zurückholen", "", () => void restoreFromTrash(page.rel)),
    button("Endgültig löschen", "leise gefahr", () => void deleteFromTrash(page.rel, trashTitel(page))),
  );
  karte.append(kopf, titel, text, knoepfe);
  return karte;
}

function papierkorbKachel(filter: typeof papierkorbFilter, wert: number, label: string, unter: string): HTMLButtonElement {
  const element = document.createElement("button");
  element.type = "button";
  element.className = "kachel";
  element.setAttribute("aria-pressed", String(papierkorbFilter === filter));
  element.innerHTML = `<span class="label">${esc(label)}</span><span class="wert">${wert}</span><span class="unter">${esc(unter)}</span>`;
  element.addEventListener("click", () => {
    papierkorbFilter = filter;
    renderPapierkorb();
  });
  return element;
}

/** Die Übersicht: Zahlen oben, darunter die gelöschten Entwürfe, der zuletzt gelöschte zuerst. */
function renderPapierkorb(): void {
  const briefeImKorb = geloeschte.filter(isBrief);
  const seitenImKorb = geloeschte.filter((page) => !isBrief(page));
  papierkorbKacheln.replaceChildren(
    papierkorbKachel("alle", geloeschte.length, "Gesamt", "alle Einträge"),
    papierkorbKachel("briefe", briefeImKorb.length, "Newsletter", "gelöschte Entwürfe"),
    papierkorbKachel("seiten", seitenImKorb.length, "Seiten", "gelöschte Entwürfe"),
  );
  const sichtbare = papierkorbFilter === "briefe" ? briefeImKorb : papierkorbFilter === "seiten" ? seitenImKorb : geloeschte;
  papierkorbSeiteLeeren.hidden = geloeschte.length === 0;
  papierkorbText.textContent = !geloeschte.length
    ? "Der Papierkorb ist leer. Gelöschte Entwürfe landen hier und lassen sich zurückholen."
    : !sichtbare.length
      ? "Hier ist nichts."
      : "Gelöschte Entwürfe, der zuletzt gelöschte zuerst. Zurückgeholt sind sie wieder Entwürfe. «Endgültig löschen» lässt sich in der Redaktion nicht rückgängig machen.";
  papierkorbKarten.replaceChildren(...sichtbare.map(trashKarte));
}

/** Die Übersicht des Papierkorbs, wie die der Newsletter. */
async function showPapierkorb(): Promise<void> {
  if (!(await flushCommit())) return;
  current = null;
  gewaehlt = null;
  markCurrent();
  zeigeNur(papierkorbSeite);
  papierkorbGruppe.open = true;
  merke("papierkorb");
  renderPapierkorb();
  nachOben();
}

/** Ein Eintrag oder (ohne rel) der ganze Papierkorb, nach einer Rückfrage. */
async function deleteFromTrash(rel: string | null, titel: string): Promise<void> {
  const ja = await ask({
    titel: rel ? "Endgültig löschen?" : "Papierkorb leeren?",
    text: rel
      ? `„${titel}“ wird endgültig gelöscht und lässt sich in der Redaktion nicht mehr zurückholen.`
      : papierkorbAnzahl === 1
        ? "Der Eintrag im Papierkorb wird endgültig gelöscht und lässt sich in der Redaktion nicht mehr zurückholen."
        : `${titel} im Papierkorb werden endgültig gelöscht und lassen sich in der Redaktion nicht mehr zurückholen.`,
    ja: rel ? "Endgültig löschen" : "Papierkorb leeren",
    nein: "Abbrechen",
    gefahr: true,
  });
  if (!ja) return;
  const response = await fetch(`/api/papierkorb${rel ? `?rel=${encodeURIComponent(rel)}` : ""}`, { method: "DELETE" }).catch(() => null);
  if (!response?.ok) {
    await ask({ titel: "Das hat nicht geklappt", text: response ? await errorText(response, "Löschen ging nicht.") : "Keine Verbindung zum Server.", ja: "OK" });
    return;
  }
  const { bilderFrei = 0 } = (await response.json().catch(() => ({}))) as { bilderFrei?: number };
  await loadList();
  // Bilder, die nur noch der gelöschte Eintrag brauchte, blieben sonst unbemerkt in «Medien» liegen.
  if (bilderFrei) {
    toast(bilderFrei === 1 ? "Ein Bild wird jetzt nicht mehr verwendet." : `${bilderFrei} Bilder werden jetzt nicht mehr verwendet.`, { label: "In Medien ansehen", aus: () => void showMedien("frei") });
  }
}

async function loadList(): Promise<void> {
  const response = await fetch("/api/pages");
  const json = (await response.json()) as { pages: PageSummary[]; menueReihe: string[] };
  alleSeiten = json.pages;
  alleBriefe = json.pages.filter((page) => page.art === "brief");
  menueReihe = json.menueReihe;
  zeichneSeiten();
  renderBriefe();
  const geloescht = (await fetch("/api/papierkorb")
    .then((res) => res.json())
    .catch(() => ({ pages: [] }))) as { pages: PageSummary[] };
  papierkorb.replaceChildren(...geloescht.pages.map(trashItem));
  geloeschte = geloescht.pages;
  if (!papierkorbSeite.hidden) renderPapierkorb();
  papierkorbAnzahl = geloescht.pages.length;
  papierkorbZahl.textContent = papierkorbAnzahl ? String(papierkorbAnzahl) : "";
  papierkorbLeeren.hidden = papierkorbAnzahl === 0;
  papierkorbHinweis.textContent = papierkorbAnzahl ? "Gelöschte Entwürfe. Zurückgeholt sind sie wieder Entwürfe." : "Der Papierkorb ist leer.";
}

const seitenOhneBriefe = () => alleSeiten.filter((page) => page.art !== "brief");

/** Das Verzeichnis, gleich aufgebaut wie das Menü. Während «Menü ordnen» gilt die Reihenfolge in Arbeit. */
function zeichneSeiten(): void {
  const baum = seitenBaum(seitenOhneBriefe(), ordnung ?? menueReihe);
  if (ordnung) {
    // Kam inzwischen eine Seite dazu oder fiel eine weg, stimmt die Liste so wieder.
    ordnung = verschiebbar(baum);
    seiten.replaceChildren(...baum.menue.map(ordnenPunkt));
  } else {
    seiten.replaceChildren(...baum.menue.flatMap(({ seite, unter }) => [
      listItem(seite),
      ...(unter.length ? [h("div", { class: "unterseiten" }, ...unter.map(listItem))] : []),
    ]));
  }
  menueOrdnen.hidden = ordnung != null;
  ordnenLeiste.hidden = ordnung == null;
  rechtliches.replaceChildren(...baum.rechtliches.map(listItem));
  weitere.replaceChildren(...baum.weitere.map(listItem));
  weitereGruppe.hidden = baum.weitere.length === 0;
  markCurrent();
}

/** Eine Zeile in «Menü ordnen». Sie öffnet keine Seite: In diesem Modus geht es nur um den Platz. */
function ordnenPunkt({ seite, unter }: BaumPunkt<PageSummary>): HTMLElement {
  const name = h("span", { class: "thema" }, seitenName(seite));
  const entwurf = seite.entwurf ? h("span", { class: "marke entwurf" }, "Entwurf") : null;
  const unterseiten = unter.length ? h("div", { class: "unterseiten" }, ...unter.map((u) => h("span", { class: "ordnen-unter" }, seitenName(u)))) : null;
  if (seite.rel === HOME || seite.rel === KONTAKT) {
    return h("div", { class: "ordnen-punkt fest" }, h("div", { class: "ordnen-zeile" }, name));
  }
  const platz = ordnung!.indexOf(seite.rel);
  const griff = h("span", { class: "griff", title: "Ziehen zum Verschieben", "aria-hidden": "true" }, "⋮⋮");
  griff.addEventListener("pointerdown", (event) => zieheStart(event, griff, verschiebeImMenue));
  const pfeil = (zeichen: string, klasse: string, wort: string, nach: number) => h("button", {
    type: "button",
    class: `werkzeug-klein ${klasse}`,
    title: `${wort} schieben`,
    "aria-label": `${seitenName(seite)} ${wort} schieben`,
    disabled: nach < 0 || nach >= ordnung!.length,
    onclick: () => {
      verschiebeImMenue(platz, nach);
      seiten.querySelector<HTMLButtonElement>(`[data-ordnen="${CSS.escape(seite.rel)}"] .${klasse}:not(:disabled)`)?.focus();
    },
  }, zeichen);
  return h(
    "div",
    { class: "ordnen-punkt ziehbar", "data-ordnen": seite.rel },
    h("div", { class: "ordnen-zeile" }, griff, name, entwurf, pfeil("↑", "hoch", "nach oben", platz - 1), pfeil("↓", "runter", "nach unten", platz + 1)),
    unterseiten,
  );
}

function verschiebeImMenue(von: number, nach: number): void {
  verschiebe(ordnung!, von, nach);
  zeichneSeiten();
}

function menueOrdnenBeginnen(): void {
  ordnung = verschiebbar(seitenBaum(seitenOhneBriefe(), menueReihe));
  zeichneSeiten();
}

function menueOrdnenBeenden(): void {
  ordnung = null;
  zeichneSeiten();
}

async function menueOrdnenSpeichern(): Promise<void> {
  const unveraendert = JSON.stringify(ordnung) === JSON.stringify(verschiebbar(seitenBaum(seitenOhneBriefe(), menueReihe)));
  if (unveraendert) {
    menueOrdnenBeenden();
    return;
  }
  const response = await post("/api/menue", { reihenfolge: ordnung }).catch(() => null);
  if (!response?.ok) {
    await ask({ titel: "Das hat nicht geklappt", text: response ? await errorText(response, "Das Menü liess sich nicht speichern.") : "Keine Verbindung zum Server.", ja: "OK" });
    return;
  }
  menueReihe = ((await response.json()) as { reihenfolge: string[] }).reihenfolge;
  menueOrdnenBeenden();
  toast("Menü gespeichert. Die Website wird neu gesetzt.");
  beobachteSetzen();
}

/** Zeigt die neuesten Newsletter, ältere erst auf Wunsch. */
function renderBriefe(): void {
  const offen = alleBriefe.findIndex((page) => page.rel === current?.rel);
  if (offen >= sichtbar) sichtbar = Math.ceil((offen + 1) / 10) * 10;
  briefe.replaceChildren(...alleBriefe.slice(0, sichtbar).map(listItem));
  const rest = alleBriefe.length - sichtbar;
  mehr.hidden = rest <= 0;
  mehr.textContent = `Ältere anzeigen (noch ${rest})`;
  markCurrent();
  renderStartBriefe();
  if (!briefeSeite.hidden) renderBriefUebersicht();
}

/** Eine Karte auf der Startseite: Titel, eine grosse Zeile, Kleingedrucktes, eine kurze Liste, ein Knopf. */
function aufgabe(
  host: HTMLElement,
  options: { titel: string; zahlen?: { text: string; art: "neu" | "offen" | "" }[]; gross?: string; leise?: string; liste: { label: string; info: string; vorschau?: string; onClick: () => void }[]; knopf: HTMLButtonElement | HTMLButtonElement[] },
): void {
  const titel = document.createElement("h2");
  titel.textContent = options.titel;
  // Dieselben Zahlen wie im Verzeichnis links, in denselben Farben.
  for (const zahl of options.zahlen ?? []) {
    const pille = document.createElement("span");
    pille.className = `zahl ${zahl.art}`.trim();
    pille.textContent = zahl.text;
    titel.append(pille);
  }
  const gross = document.createElement("p");
  gross.className = "gross";
  gross.textContent = options.gross ?? "";
  const leise = document.createElement("p");
  leise.className = "leise";
  leise.textContent = options.leise ?? "";
  const liste = document.createElement("ul");
  for (const eintrag of options.liste) {
    const item = document.createElement("li");
    const link = button(eintrag.label, "", eintrag.onClick);
    const info = document.createElement("span");
    info.textContent = eintrag.info;
    link.append(info);
    if (eintrag.vorschau) {
      const vorschau = document.createElement("span");
      vorschau.className = "vorschau";
      vorschau.textContent = eintrag.vorschau;
      link.append(vorschau);
    }
    item.append(link);
    liste.append(item);
  }
  const knoepfe = document.createElement("div");
  knoepfe.className = "aktionen";
  knoepfe.append(...[options.knopf].flat());
  host.replaceChildren(titel, ...(options.gross ? [gross] : []), ...(options.leise ? [leise] : []), ...(options.liste.length ? [liste] : []), knoepfe);
}

function entwurfZahl(anzahl: number): string {
  return anzahl === 1 ? "1 Entwurf" : `${anzahl} Entwürfe`;
}

function renderStartBriefe(): void {
  const entwuerfe = alleBriefe.filter((page) => page.entwurf);
  briefeZahl.textContent = entwuerfe.length ? entwurfZahl(entwuerfe.length) : "";
  const zuletzt = alleBriefe.find((page) => !page.entwurf);
  // Wartet ein Entwurf, ist Weiterschreiben das Naheliegende. So entsteht kein zweiter leerer Entwurf aus Versehen.
  const weiter = entwuerfe[0];
  const knoepfe = weiter
    ? [
        button("Entwurf weiterschreiben", "haupt", () => void openPage(weiter.rel)),
        button("Neuen Newsletter schreiben", "", () => void newBrief()),
      ]
    : [button("Neuen Newsletter schreiben", "haupt", () => void newBrief())];
  // Entwürfe zuerst, die wollen fertig werden. Sonst die letzten veröffentlichten.
  const liste = (entwuerfe.length ? entwuerfe : alleBriefe).slice(0, 3).map((page) => {
    const bearbeitet = page.entwurf ? zuletztAm.get(page.rel) : undefined;
    return {
      label: thema(page.titel) || "Noch ohne Thema",
      info: page.entwurf
        ? `Entwurf · Nr. ${page.nummer ?? ""}${bearbeitet ? ` · zuletzt bearbeitet ${wannKurz(bearbeitet)}` : ""}`
        : `Nr. ${page.nummer ?? ""} · ${shortDate(page.datum)}`,
      onClick: () => void openPage(page.rel),
    };
  });
  aufgabe(startBriefe, {
    titel: "Newsletter",
    zahlen: entwuerfe.length ? [{ text: entwurfZahl(entwuerfe.length), art: "" }] : [],
    gross: entwuerfe.length
      ? `${entwuerfe.length === 1 ? "Ein Entwurf wartet" : `${entwuerfe.length} Entwürfe warten`}`
      : "Keine offenen Entwürfe",
    leise: zuletzt
      ? `Zuletzt erschienen: Nr. ${zuletzt.nummer ?? ""} am ${shortDate(zuletzt.datum)}, ${seit(zuletzt.datum)}.`
      : "Der erste Newsletter erscheint, sobald Sie ihn veröffentlichen.",
    liste,
    knopf: [...knoepfe, button("Zur Übersicht", "", () => void showBriefe())],
  });
  renderNaechstes();
}

/** Nach so vielen Tagen ohne neuen Newsletter erinnert «Als Nächstes» sanft. Google mag Seiten, die leben. */
const PAUSE_TAGE = 60;

function tageSeit(iso: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return 0;
  const damals = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Math.max(0, Math.floor((Date.now() - damals.getTime()) / 86_400_000));
}

/** «heute», «vor 5 Tagen», «vor 3 Wochen», «vor 7 Monaten». */
function seit(iso: string): string {
  const tage = tageSeit(iso);
  if (tage === 0) return "heute";
  if (tage === 1) return "gestern";
  if (tage < 14) return `vor ${tage} Tagen`;
  if (tage < 60) return `vor ${Math.round(tage / 7)} Wochen`;
  const monate = Math.round(tage / 30.4);
  if (monate < 24) return `vor ${monate} Monaten`;
  return `vor ${Math.round(tage / 365)} Jahren`;
}

interface Befund {
  rel: string;
  titel: string;
  art: Art;
  probleme: Problem[];
}

let befunde: Befund[] = [];
/** Solange der erste Check läuft, sagt die Ansicht «Wird geprüft …» statt «Alles in Ordnung». */
let checkGeladen = false;

/** Holt den Website-Check. Unveränderte Seiten prüft der Server nicht nochmals. */
async function loadCheck(): Promise<void> {
  const json = (await fetch("/api/check", { cache: "no-store" })
    .then((res) => (res.ok ? res.json() : null))
    .catch(() => null)) as { befunde?: Befund[] } | null;
  if (!json?.befunde) return;
  befunde = json.befunde;
  checkGeladen = true;
  renderCheck();
}

function checkSatz(n: number): string {
  return `${n === 1 ? "Eine Seite lässt" : `${n} Seiten lassen`} sich für Google verbessern`;
}

/** Die Zahl im Verzeichnis, die Ansicht «Website-Check» und der nächste Schritt auf der Startseite. */
function renderCheck(): void {
  const n = befunde.length;
  // Gelb wie alles, was gesehen, aber nicht erledigt ist. Ohne Befund steht nichts da.
  checkZahl.textContent = n ? String(n) : "";
  checkLink.title = n ? checkSatz(n) : "";
  checkStand.textContent = n
    ? `${checkSatz(n)}.`
    : "Alles in Ordnung ✓ Alle Seiten haben ein Thema, einen Einstiegsabsatz für Google und Bilder mit Beschreibung.";
  checkStand.classList.toggle("gut", n === 0);
  checkListe.replaceChildren(
    ...befunde.map((befund) =>
      h(
        "li",
        {},
        h(
          "div",
          {},
          h("strong", {}, befund.titel),
          h("small", { class: "leise" }, befund.probleme.map((problem) => problem.text).join(" · ")),
        ),
        h("div", { class: "aktionen" }, button("Seite öffnen", "", () => void openPage(befund.rel))),
      ),
    ),
  );
  renderNaechstes();
}

/** «heute, 14:05», «gestern», «vor 5 Tagen», danach das Datum. Gezählt werden Kalendertage. */
function wannKurz(iso: string): string {
  const wann = new Date(iso);
  if (Number.isNaN(wann.getTime())) return "";
  const mitternacht = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const tage = Math.round((mitternacht(new Date()) - mitternacht(wann)) / 86_400_000);
  if (tage <= 0) return `heute, ${uhrFormat.format(wann)}`;
  if (tage === 1) return "gestern";
  if (tage < 14) return `vor ${tage} Tagen`;
  return `am ${tagFormat.format(wann)}`;
}

/** Wann eine Seite zuletzt geändert wurde, aus dem Verlauf. Für «Zuletzt bearbeitet» und die Entwürfe. */
let zuletztAm = new Map<string, string>();
const ZULETZT_ZAHL = 4;
/** Fassungen über mehr Seiten sind Umstellungen oder «Allgemeine Angaben geändert», nicht Arbeit an einer Seite. */
const UMSTELLUNG_AB = 2;

async function loadZuletzt(): Promise<void> {
  const json = (await fetch("/api/verlauf", { cache: "no-store" })
    .then((res) => (res.ok ? res.json() : null))
    .catch(() => null)) as { eintraege?: { date: string; dateien: { status: string; pfad: string }[] }[] } | null;
  if (!json?.eintraege) return;
  const neu = new Map<string, string>();
  for (const eintrag of json.eintraege) {
    const seiten = eintrag.dateien.filter((d) => d.status !== "D" && /^(briefe|kapitel|recht)\/.+\.md$/.test(d.pfad));
    if (seiten.length > UMSTELLUNG_AB) continue;
    // Die neueste Fassung zuerst: Was schon drin ist, ist neuer.
    for (const seite of seiten) if (!neu.has(seite.pfad)) neu.set(seite.pfad, eintrag.date);
  }
  zuletztAm = neu;
  renderStartZuletzt();
  renderStartBriefe();
}

function zuletztName(page: PageSummary): string {
  // Wie im Verzeichnis, damit Patrick die Seite wiedererkennt.
  if (page.art !== "brief") return seitenName(page);
  const text = thema(page.titel);
  return `Newsletter ${page.nummer ?? ""}${text ? `: ${text}` : ""}`;
}

/** Weitermachen, wo Patrick aufgehört hat. Seiten, die es nicht mehr gibt, fallen weg. */
function renderStartZuletzt(): void {
  const seiten = [...zuletztAm]
    .map(([rel, date]) => ({ page: alleSeiten.find((page) => page.rel === rel), date }))
    .filter((eintrag): eintrag is { page: PageSummary; date: string } => eintrag.page != null)
    .slice(0, ZULETZT_ZAHL);
  startZuletzt.hidden = seiten.length === 0;
  if (!seiten.length) return;
  aufgabe(startZuletzt, {
    titel: "Zuletzt bearbeitet",
    liste: seiten.map(({ page, date }) => ({
      label: zuletztName(page),
      info: `${page.entwurf ? "Entwurf" : page.art === "brief" ? "Newsletter" : page.art === "recht" ? "Rechtliches" : "Seite"} · ${wannKurz(date)}`,
      onClick: () => void openPage(page.rel),
    })),
    knopf: button("Zum Verlauf", "", () => void showVerlauf()),
  });
}

/** Erst wenn Seiten und Anfragen da sind, weiss die Startseite, was als Nächstes ansteht. */
let startBereit = false;

/**
 * Das eine, was als Nächstes ansteht, mit einem Knopf: eine neue Anfrage vor einem Entwurf, der vor
 * gelesenen Anfragen, die noch offen sind, dann der Website-Check, dann ein überfälliger Newsletter.
 */
function renderNaechstes(): void {
  if (!startBereit) return;
  let satz = "Alles erledigt.";
  let dazu = "Keine neue Anfrage, kein offener Entwurf.";
  let knopf: HTMLButtonElement | null = null;
  let dringend = false;

  const neue = alleAnfragen.filter((a) => a.status === "neu");
  // Wer am längsten wartet, kommt zuerst.
  const aelteste = [...neue].sort((a, b) => a.eingang.localeCompare(b.eingang))[0];
  const gelesene = alleAnfragen.filter((a) => a.status === "gelesen").length;
  const entwuerfe = alleSeiten
    .filter((page) => page.entwurf)
    .sort((a, b) => (zuletztAm.get(b.rel) ?? "").localeCompare(zuletztAm.get(a.rel) ?? ""));
  const entwurf = entwuerfe[0];
  const zuletzt = alleBriefe.find((page) => !page.entwurf);

  if (aelteste) {
    dringend = true;
    satz = `${wer(aelteste).trim() || "Jemand"} hat geschrieben`;
    dazu = `Wartet ${wartetSeit(aelteste.eingang)}${neue.length > 1 ? ` · ${neue.length - 1 === 1 ? "eine weitere neue Anfrage" : `${neue.length - 1} weitere neue Anfragen`}` : ""}`;
    knopf = button("Anfrage öffnen", "haupt", () => void openAnfrage(aelteste.id));
  } else if (entwurf) {
    const bearbeitet = zuletztAm.get(entwurf.rel);
    satz = entwurf.art === "brief" ? `Newsletter ${entwurf.nummer ?? ""} ist noch ein Entwurf` : `«${seitenName(entwurf)}» ist noch ein Entwurf`;
    dazu = [
      entwurf.art === "brief" ? thema(entwurf.titel) || "Noch ohne Thema" : "",
      bearbeitet ? `zuletzt bearbeitet ${wannKurz(bearbeitet)}` : "",
      entwuerfe.length > 1 ? `${entwuerfe.length - 1 === 1 ? "ein weiterer Entwurf" : `${entwuerfe.length - 1} weitere Entwürfe`}` : "",
    ].filter(Boolean).join(" · ");
    knopf = button("Weiterschreiben", "haupt", () => void openPage(entwurf.rel));
  } else if (gelesene) {
    satz = `${gelesene === 1 ? "Eine gelesene Anfrage ist" : `${gelesene} gelesene Anfragen sind`} noch offen`;
    dazu = "Beantwortet? Dann auf «Erledigt» setzen.";
    knopf = button("Zur Kontaktaufnahme", "haupt", () => void showAnfragen());
  } else if (befunde.length) {
    satz = checkSatz(befunde.length);
    dazu = "Thema, Einstiegsabsatz oder Bildbeschreibung fehlen.";
    knopf = button("Ansehen", "haupt", () => void showCheck());
  } else if (zuletzt && tageSeit(zuletzt.datum) > PAUSE_TAGE) {
    satz = `Der letzte Newsletter erschien ${seit(zuletzt.datum)}`;
    dazu = "Zeit für den nächsten? Google mag Seiten, die leben.";
    knopf = button("Neuen Newsletter schreiben", "haupt", () => void newBrief());
  }

  const kopf = h("p", { class: "kopf" }, "Als Nächstes");
  const text = h("div", {}, kopf, h("p", { class: "gross" }, satz), h("p", { class: "leise" }, dazu));
  startNaechstes.classList.toggle("dringend", dringend);
  startNaechstes.classList.toggle("ruhig", knopf == null);
  startNaechstes.replaceChildren(text, ...(knopf ? [knopf] : []));
  startNaechstes.hidden = false;
}

/** Für die offene Seite, wie sie gespeichert ist. Gilt nur, solange dieselbe Seite offen ist. */
interface Problem {
  art: "thema" | "einstieg" | "bilder";
  text: string;
  /** Wie src/server/pruefung.ts. Der Server prüft, die Redaktion zeigt nur an. */
  bilder?: { datei: string; grund: "fehlt" | "dateiname"; alt: string }[];
}

/** Hatte die offene Seite Hinweise? Dann gibt es eine kurze Bestätigung, wenn alles erledigt ist. */
let hinweiseFuer: string | null = null;
let hinweiseTimer: number | null = null;

async function loadSeitenCheck(): Promise<void> {
  const rel = current?.rel;
  if (!rel || current?.art === "recht") {
    googleHinweise.hidden = true;
    return;
  }
  const json = (await fetch(`/api/check?rel=${encodeURIComponent(rel)}`, { cache: "no-store" })
    .then((res) => (res.ok ? res.json() : null))
    .catch(() => null)) as { probleme?: Problem[] } | null;
  if (!json?.probleme || current?.rel !== rel) return;
  renderSeitenCheck(rel, json.probleme);
}

/** Nach dem Speichern nachsehen, ob ein Hinweis erledigt ist. Nicht bei jedem Tastendruck. */
function spaeterSeitenCheck(): void {
  if (hinweiseTimer != null) window.clearTimeout(hinweiseTimer);
  hinweiseTimer = window.setTimeout(() => {
    hinweiseTimer = null;
    void loadSeitenCheck();
  }, 400);
}

function renderSeitenCheck(rel: string, probleme: Problem[]): void {
  // Der Website-Check zählt nur, was online ist. Stimmt er für diese Seite nicht mehr, neu holen.
  if (current && !current.entwurf && befunde.some((befund) => befund.rel === rel) !== probleme.length > 0) void loadCheck();
  if (!probleme.length) {
    // Nur wer Hinweise gesehen hat, bekommt die Bestätigung. Sonst bleibt der Platz leer.
    googleHinweise.hidden = hinweiseFuer !== rel;
    googleHinweise.classList.add("erledigt");
    googleHinweise.innerHTML = `<p class="kopf">Für Google ist auf dieser Seite alles in Ordnung ✓</p>`;
    return;
  }
  hinweiseFuer = rel;
  googleHinweise.hidden = false;
  googleHinweise.classList.remove("erledigt");
  const kopf = document.createElement("p");
  kopf.className = "kopf";
  kopf.textContent = probleme.length === 1 ? "Für Google lässt sich hier eine Sache verbessern" : `Für Google lassen sich hier ${probleme.length} Sachen verbessern`;
  const liste = document.createElement("ul");
  for (const problem of probleme) {
    const item = document.createElement("li");
    const text = document.createElement("p");
    if (problem.art === "thema") {
      text.innerHTML = "<strong>Thema fehlt.</strong> Oben ins grosse Feld schreiben, worum es geht. Es wird der Titel bei Google.";
      item.append(text, button("Zum Thema", "leise", () => titelInput.focus()));
    } else if (problem.art === "einstieg") {
      text.innerHTML = "<strong>Kein Einstiegsabsatz.</strong> Am Anfang ein, zwei Sätze schreiben: worum es geht und für wen. Google zeigt sie unter dem Titel.";
      item.append(text);
    } else {
      const bilder = problem.bilder ?? [];
      text.innerHTML = `<strong>${esc(problem.text)}.</strong> In ein paar Worten beschreiben, was zu sehen ist; Google liest das, Besucher sehen es nicht. Der Knopf öffnet das Feld unter dem Bild.`;
      item.append(text);
      for (const bild of bilder) {
        const zeile = document.createElement("div");
        zeile.className = "aktionen";
        const knopf = button("Beschreibung schreiben", "leise", () => zumBild(bild.datei));
        knopf.title = bild.datei;
        if (bilder.length > 1) knopf.textContent = `Beschreibung schreiben · ${kurzerName(bild.datei)}`;
        zeile.append(knopf);
        // Steht schon etwas im Feld, soll Patrick sehen, warum es nicht zählt.
        if (bild.grund === "dateiname") {
          const warum = document.createElement("span");
          warum.className = "leise";
          warum.textContent = `Jetzt steht dort nur der Dateiname «${bild.alt}».`;
          zeile.append(warum);
        }
        item.append(zeile);
      }
    }
    liste.append(item);
  }
  const fuss = document.createElement("div");
  fuss.className = "aktionen";
  fuss.append(button("Seite prüfen lassen", "", () => document.dispatchEvent(new CustomEvent("seite-pruefen"))));
  const fussText = document.createElement("span");
  fussText.className = "leise";
  fussText.textContent = "Der Assistent schlägt Text vor.";
  fuss.append(fussText);
  googleHinweise.replaceChildren(kopf, liste, fuss);
}

/** «Marktperformance-Newsletter33-1024x206.png» → «Marktperformance-Newsletter33». */
function kurzerName(name: string): string {
  return name.replace(/\.[a-z0-9]+$/i, "").replace(/-\d+x\d+$/, "").replace(/-scaled$/, "").slice(0, 32);
}

/**
 * Springt zum Bild im Text und öffnet das Feld für die Beschreibung. Das Feld zeigt der Editor
 * erst nach einem Klick auf die Sprechblase oben rechts am Bild; das übernimmt hier der Knopf.
 */
function zumBild(name: string): void {
  if (felder) {
    felder.fokusBild(name);
    return;
  }
  const block = [...editorHost.querySelectorAll<HTMLElement>(".milkdown-image-block")].find((el) => {
    const src = el.querySelector("img")?.getAttribute("src") ?? "";
    return decodeURIComponent(src.split("/").pop() ?? "") === name;
  });
  if (!block) return;
  block.scrollIntoView({ block: "center", behavior: "smooth" });
  const feld = () => block.querySelector<HTMLInputElement>(".caption-input");
  if (!feld()) block.querySelector(".operation-item")?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
  window.setTimeout(() => feld()?.focus({ preventScroll: true }), 80);
}

/** Nach einem Wechsel an den Anfang der Ansicht. */
function nachOben(): void {
  window.scrollTo({ top: 0 });
}

/** Jede Ansicht bekommt einen Eintrag im Verlauf des Browsers, damit «Zurück» in der Redaktion bleibt. */
function merke(hash: string): void {
  if (decodeURIComponent(location.hash.slice(1)) === hash) return;
  history.pushState(null, "", hash ? `#${hash}` : location.pathname + location.search);
}

function markCurrent(): void {
  for (const item of root!.querySelectorAll<HTMLButtonElement>("nav button[data-rel]")) {
    item.toggleAttribute("aria-current", item.dataset.rel === current?.rel);
  }
  for (const item of root!.querySelectorAll<HTMLButtonElement>("nav button[data-anfrage], nav button[data-wunsch]")) {
    item.toggleAttribute("aria-current", (item.dataset.anfrage ?? item.dataset.wunsch) === gewaehlt);
  }
  // Die Gruppe der offenen Seite aufklappen. Die Hauptseiten stehen immer da.
  if (current) {
    if (isBrief(current)) briefeGruppe.open = true;
    else if (rechtliches.querySelector(`button[data-rel="${CSS.escape(current.rel)}"]`)) rechtlichesGruppe.open = true;
    else if (weitere.querySelector(`button[data-rel="${CSS.escape(current.rel)}"]`)) weitereGruppe.open = true;
  }
}

/** Der Name fürs Menü zählt nur, wenn die Seite im Menü steht. Leer gilt der Titel. */
function zeigeMenueName(): void {
  const imMenue = !menueFeld.hidden && menueInput.value !== "";
  menueNameFeld.hidden = !imMenue;
  menueNameInput.placeholder = titelInput.value.trim();
  const name = menueBezeichnung({ titel: titelInput.value.trim(), menueName: menueNameInput.value });
  menueHinweis.hidden = !imMenue || name.length <= MENUE_NAME_LANG;
}

/** Hält das Thema im Verzeichnis gleich, während getippt wird. */
function updateListLabel(): void {
  if (!current || !isBrief(current)) return;
  const item = briefe.querySelector<HTMLElement>(`button[data-rel="${CSS.escape(current.rel)}"] .thema`);
  if (item) item.textContent = titelInput.value.trim() || "Noch ohne Thema";
}

/** Die Nummer aus dem Feld. Nur ein Entwurf darf sie ändern: online hängt die Adresse daran. */
function gewaehlteNummer(): number | null {
  if (!current || !isBrief(current) || !current.entwurf) return current?.nummer ?? null;
  const wert = Number(nummerInput.value);
  return Number.isInteger(wert) && wert > 0 && wert < 10_000 ? wert : current.nummer;
}

/** Warnt, wenn ein anderer Newsletter dieselbe Nummer hat. Verboten ist es erst beim Veröffentlichen. */
function pruefeNummer(): void {
  const nummer = gewaehlteNummer();
  const andere = alleBriefe.filter((page) => page.rel !== current?.rel && page.nummer === nummer);
  const online = andere.find((page) => !page.entwurf);
  nummerHinweis.hidden = andere.length === 0 || !current?.entwurf;
  nummerHinweis.textContent = online
    ? `Nr. ${nummer} ist schon online: «${thema(online.titel)}». So lässt er sich nicht veröffentlichen.`
    : `Nr. ${nummer} hat auch ${andere.length === 1 ? "ein anderer Entwurf" : `${andere.length} andere Entwürfe`}.`;
  nummerHinweis.classList.toggle("fehler", online != null);
}

function collect(): ContentDocument {
  if (!current || !editorBereit()) throw new Error("Keine Seite");
  const brief = isBrief(current);
  const nummer = gewaehlteNummer();
  return {
    rel: current.rel,
    art: current.art,
    nummer,
    entwurf: current.entwurf,
    titel: brief ? briefTitel(nummer, titelInput.value) : titelInput.value.trim() || current.titel,
    datum: brief ? datumInput.value || current.datum : current.datum,
    menue: menueFeld.hidden ? false : menueOrt(menueInput.value),
    menueName: menueFeld.hidden || !menueInput.value ? null : menueNameInput.value.trim() || null,
    vorlage: felder ? current.vorlage : null,
    felder: felder ? felder.werte() : null,
    // Hat die Seite Felder, ist der Text leer: Sie sind das, was gespeichert wird.
    body: felder ? "" : aktuellerText(),
  };
}

function same(a: ContentDocument, b: ContentDocument): boolean {
  return a.titel === b.titel && a.datum === b.datum && a.nummer === b.nummer && a.body.trim() === b.body.trim()
    && (a.menue || false) === (b.menue || false) && (a.menueName || null) === (b.menueName || null) && JSON.stringify(a.felder ?? null) === JSON.stringify(b.felder ?? null);
}

function viewHref(doc: Doc): string {
  return `${publicOrigin}${doc.href}`;
}

/** Zeigt, wo die Seite steht und was als Nächstes zu tun ist. */
function renderStand(): void {
  if (!current) return;
  const doc = current;
  nummerInput.disabled = !doc.entwurf;
  nummerFeld.title = doc.entwurf ? "" : "Die Nummer lässt sich nur im Entwurf ändern. Online hängt die Adresse daran.";
  nummerInput.value = String(doc.nummer ?? "");
  pruefeNummer();
  aktionen.replaceChildren();
  const einmalig = doc.vorlage != null && EINMALIG.includes(doc.vorlage);
  // Online sieht das Blatt anders aus: Was gespeichert wird, ist auf der Website.
  form.dataset.stand = doc.entwurf ? "entwurf" : "online";
  // Was die Seite wegnimmt (Löschen, Zurückziehen) steht links für sich, die übrigen Knöpfe rechts.
  if (doc.entwurf) {
    stand.innerHTML = `<span class="marke entwurf">Entwurf</span> Nur hier in der Redaktion sichtbar.`;
    aktionen.append(
      button("Löschen", "leise weg", () => void deleteDraft()),
      ...(doc.felder ? [] : [button("Word importieren", "leise", () => wordInput.click())]),
      ...(einmalig ? [] : [button("Kopie anlegen", "leise", () => void copyPage(doc.rel))]),
      button("Vorschau", "", () => void openPreview()),
      button("Veröffentlichen", "haupt", () => void publish()),
    );
    return;
  }
  stand.innerHTML = `<span class="marke online">Online</span> Änderungen erscheinen erst nach dem Speichern auf der Website.`;
  // Startseite und Rechtliches bleiben online: Der Fuss jeder Seite verlinkt Impressum, Disclaimer und Datenschutz.
  if (doc.rel !== STARTSEITE && doc.art !== "recht") aktionen.append(button("Zurückziehen", "leise weg", () => void unpublish()));
  if (!einmalig) aktionen.append(button("Kopie anlegen", "leise", () => void copyPage(doc.rel)));
  const link = document.createElement("a");
  link.className = "knopf";
  link.href = viewHref(doc);
  link.target = "_blank";
  link.rel = "noopener";
  link.textContent = "Auf der Website ansehen ↗";
  verwerfenKnopf = button("Verwerfen", "leise", () => void verwerfen());
  verwerfenKnopf.hidden = !liveUngespeichert;
  speichernKnopf = button("Speichern & veröffentlichen", "haupt", () => void saveNow());
  speichernKnopf.disabled = !liveUngespeichert;
  aktionen.append(link, verwerfenKnopf, speichernKnopf);
}

/** Zeigt, ob die Online-Seite vom gespeicherten Stand abweicht. Tippen und Zurücktippen ergibt keine Änderung. */
function pruefeLive(): void {
  if (!current || !editorBereit()) return;
  liveUngespeichert = !same(collect(), current);
  if (speichernKnopf) speichernKnopf.disabled = !liveUngespeichert;
  if (verwerfenKnopf) verwerfenKnopf.hidden = !liveUngespeichert;
  setSaved(liveUngespeichert ? "Noch nicht veröffentlicht" : "", liveUngespeichert ? "busy" : "ok");
}

async function verwerfen(): Promise<void> {
  if (!current) return;
  const ja = await ask({
    titel: "Änderungen verwerfen?",
    text: "Die Seite springt zurück auf den Stand, der auf der Website ist.",
    ja: "Verwerfen",
    nein: "Abbrechen",
    gefahr: true,
  });
  if (!ja || !current) return;
  // Patrick hat entschieden: Beim Neuladen nichts mehr fragen, auch nicht nach unvollständigen Feldern.
  liveUngespeichert = false;
  felder = null;
  await openPage(current.rel);
}

/**
 * Vor einer Aktion, die vom gespeicherten Stand ausgeht. Entwürfe speichern sich von selbst. Bei einer
 * Online-Seite hiesse das, Halbfertiges zu veröffentlichen: Dort entscheidet Patrick zuerst.
 */
async function erstSichern(): Promise<boolean> {
  if (!liveUngespeichert) return saveNow();
  await ask({
    titel: "Noch nicht gespeichert",
    text: "Diese Seite hat Änderungen, die noch nicht auf der Website sind. Bitte zuerst speichern oder verwerfen.",
    ja: "OK",
  });
  return false;
}

/** «Guten Morgen» bis elf, dann «Guten Tag», ab fünf «Guten Abend». Auch spät in der Nacht noch Abend. */
function gruss(): string {
  const stunde = new Date().getHours();
  if (stunde >= 5 && stunde < 11) return "Guten Morgen, Patrick.";
  if (stunde >= 11 && stunde < 17) return "Guten Tag, Patrick.";
  return "Guten Abend, Patrick.";
}

/** Von den Ansichten rechts ist immer nur eine sichtbar. */
function zeigeNur(ansicht: HTMLElement): void {
  for (const el of [start, form, anfragenSeite, briefeSeite, wuenscheSeite, allgemeinSeite, medienSeite, verlaufSeite, checkSeite, papierkorbSeite]) el.hidden = el !== ansicht;
  checkLink.toggleAttribute("aria-current", ansicht === checkSeite);
  allgemeinLink.toggleAttribute("aria-current", ansicht === allgemeinSeite);
  medienLink.toggleAttribute("aria-current", ansicht === medienSeite);
  verlaufLink.toggleAttribute("aria-current", ansicht === verlaufSeite);
}

function showStart(): void {
  root!.querySelector("#gruss")!.textContent = gruss();
  current = null;
  gewaehlt = null;
  zeigeNur(start);
  void loadCheck();
  void loadZuletzt();
  merke("");
  // Auf der Startseite ist das Verzeichnis zugeklappt. Eine geöffnete Seite klappt ihre Gruppe selbst auf.
  for (const gruppe of root!.querySelectorAll<HTMLDetailsElement>("aside details")) gruppe.open = false;
  markCurrent();
}

async function openPage(rel: string): Promise<void> {
  if (!(await flushCommit())) return;
  const response = await fetch(`/api/pages?rel=${encodeURIComponent(rel)}`);
  if (!response.ok) {
    showStart();
    return;
  }
  current = (await response.json()) as Doc;
  gewaehlt = null;
  liveUngespeichert = false;
  const brief = isBrief(current);
  zeigeNur(form);
  kennung.textContent = brief ? `Newsletter ${current.nummer ?? ""}` : current.art === "recht" ? "Rechtliches" : "Seite";
  titelInput.placeholder = brief ? "Thema, z. B. Revision des Erbrechts" : "Titel";
  titelInput.value = brief ? thema(current.titel) : current.titel;
  fitTitel();
  datumFeld.hidden = !brief;
  datumInput.value = current.datum;
  nummerFeld.hidden = !brief;
  nummerInput.value = String(current.nummer ?? "");
  // Selbst angelegte Seiten dürfen ins Menü. Die festen stehen dort schon oder im Fuss.
  menueFeld.hidden = current.art !== "kapitel" || VORLAGE_VON[current.rel] != null;
  menueInput.value = current.menue === true ? "true" : current.menue === "angebot" ? "angebot" : "";
  menueNameInput.value = current.menueName ?? "";
  zeigeMenueName();
  zeigeAdresse();
  fassungenGruppe.open = false;
  setSaved("");
  googleHinweise.hidden = true;
  hinweiseFuer = null;
  renderStand();
  merke(current.rel);
  renderBriefe();
  nachOben();
  await mountEditor(current.body);
  void loadHistory(current.rel);
  void loadSeitenCheck();
  if (brief && current.entwurf && !titelInput.value) titelInput.focus();
  void pruefeSetzen();
}

/** Wie der Server aus der Eingabe eine Adresse macht: klein, ä zu ae, Leerzeichen zu Bindestrichen. */
function adresseAus(text: string): string {
  return text
    .replace(/^\s*(https?:\/\/)?[^/]*advocat-finanz\.ch/i, "")
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

/** Die Adresse der offenen Seite. Nur übrige Seiten haben eine; die Startseite bleibt «/». */
function zeigeAdresse(): void {
  const doc = current;
  adresseFeld.hidden = !doc || isBrief(doc);
  adresseHinweis.hidden = true;
  adresseHinweis.classList.remove("fehler");
  if (!doc || isBrief(doc)) return;
  adresseVor.textContent = `${publicOrigin ? new URL(publicOrigin).host : location.host}/`;
  adresseInput.value = doc.href.replace(/^\//, "");
  const start = doc.rel === STARTSEITE;
  adresseInput.disabled = start;
  adresseFeld.title = start ? "Die Startseite hat immer die Adresse «/»." : "";
}

/** Was aus der Eingabe wird, noch bevor sie gilt. */
function adresseVorschau(): void {
  if (!current) return;
  const neu = adresseAus(adresseInput.value);
  const alt = current.href.replace(/^\//, "");
  adresseHinweis.classList.remove("fehler");
  if (neu === alt) {
    adresseHinweis.hidden = true;
    return;
  }
  adresseHinweis.hidden = false;
  adresseHinweis.textContent = neu
    ? `Wird zu /${neu}. Mit Enter übernehmen, Esc bricht ab.`
    : "Bitte eine Adresse eingeben.";
}

let adresseLaeuft = false;

/** Neue Adresse übernehmen: nachfragen, dann leitet der Server die alte weiter und passt die Links an. */
async function aendereAdresse(): Promise<void> {
  if (!current || isBrief(current) || current.rel === STARTSEITE || adresseLaeuft) return;
  const doc = current;
  const alt = doc.href;
  const slug = adresseAus(adresseInput.value);
  if (!slug || `/${slug}` === alt) {
    zeigeAdresse();
    return;
  }
  adresseLaeuft = true;
  try {
    const ja = await ask({
      titel: "Adresse ändern?",
      text: `Die Seite «${doc.titel}» steht danach unter /${slug}. Wer die alte Adresse ${alt} aufruft, landet automatisch auf der neuen, und alle Links auf den anderen Seiten zeigen auf die neue Adresse.`,
      ja: "Adresse ändern",
      nein: "Abbrechen",
    });
    if (!ja || current?.rel !== doc.rel) {
      zeigeAdresse();
      return;
    }
    const fehler = await adresseSetzen(doc.rel, slug);
    if (fehler) {
      await ask({ titel: "Adresse nicht geändert", text: fehler, ja: "OK" });
      if (current?.rel === doc.rel) zeigeAdresse();
    }
  } finally {
    adresseLaeuft = false;
  }
}

/**
 * Gibt einer übrigen Seite eine neue Adresse, offen oder nicht. Der Server leitet die alte weiter
 * und passt die Links an. Gibt den Fehler zurück, oder null, wenn es geklappt hat.
 */
async function adresseSetzen(rel: string, slug: string): Promise<string | null> {
  const offen = current?.rel === rel;
  if (offen && liveUngespeichert) return "Die Seite hat noch nicht gespeicherte Änderungen. Bitte zuerst speichern oder verwerfen.";
  if (offen && !(await saveNow())) return "Die Seite liess sich vorher nicht speichern.";
  if (offen) setSaved("Ändert die Adresse …", "busy");
  const response = await post("/api/adresse", { rel, adresse: slug }).catch(() => null);
  if (!response?.ok) {
    if (current?.rel === rel) setSaved("");
    return response ? await errorText(response, "Das ging nicht.") : "Keine Verbindung zum Server.";
  }
  const neu = (await response.json()) as Doc & { angepasst?: number };
  if (current?.rel === rel) {
    const textGeaendert = neu.body.trim() !== current.body.trim() || JSON.stringify(neu.felder ?? null) !== JSON.stringify(current.felder ?? null);
    current = { ...current, adresse: neu.adresse, frueher: neu.frueher, href: neu.href, body: neu.body, felder: neu.felder, version: neu.version };
    zeigeAdresse();
    renderStand();
    if (textGeaendert) await mountEditor(current.body);
    const andere = neu.angepasst ?? 0;
    setSaved(
      andere
        ? `Neue Adresse ${neu.href} ✓ Links auf ${andere === 1 ? "einer Seite" : `${andere} Seiten`} angepasst.`
        : `Neue Adresse ${neu.href} ✓`,
    );
  }
  await loadList();
  return null;
}

function scheduleSave(): void {
  if (!armed) return;
  // Online entscheidet der Knopf, was auf die Website kommt. Nur Entwürfe speichern sich von selbst.
  if (current && !current.entwurf) {
    pruefeLive();
    return;
  }
  setSaved("Ungespeichert …", "busy");
  if (saveTimer != null) window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => void save(), 600);
}

/** Es läuft immer nur ein Speichern. Ein zweites zugleich nennte einen Stand, den das erste gerade ablöst. */
let speichernLaeuft: Promise<boolean> | null = null;

async function save(): Promise<boolean> {
  saveTimer = null;
  while (speichernLaeuft) await speichernLaeuft;
  speichernLaeuft = speichere();
  try {
    return await speichernLaeuft;
  } finally {
    speichernLaeuft = null;
  }
}

async function speichere(): Promise<boolean> {
  if (!current || !editorBereit()) return true;
  const fehlt = felder?.fehler();
  if (fehlt) {
    setSaved(fehlt, "fehler");
    return false;
  }
  const doc = collect();
  const online = !current.entwurf;
  if (same(doc, current)) {
    setSaved(online ? "" : "Gespeichert ✓");
    return true;
  }
  setSaved("Speichert …", "busy");
  const response = await fetch("/api/pages", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...doc, version: current.version }),
  }).catch(() => null);
  if (response?.status === 409) {
    // Die Datei ist weg oder anderswo geändert. Nicht endlos neu versuchen, und nichts überschreiben.
    setSaved(`Nicht gespeichert: ${await errorText(response, "Diese Seite wurde inzwischen geändert.")}`, "fehler");
    void loadList();
    return false;
  }
  if (response?.status === 422) {
    const json = (await response.json().catch(() => ({}))) as { error?: string; felder?: Record<string, string> };
    if (felder && json.felder) felder.zeigeFehler(json.felder);
    setSaved(`Nicht gespeichert: ${json.error ?? "Bitte die Felder prüfen."}`, "fehler");
    return false;
  }
  if (!response?.ok) {
    if (online) {
      setSaved("Nicht gespeichert: Die Verbindung fehlt. Bitte nochmals versuchen.", "fehler");
      return false;
    }
    setSaved("Nicht gespeichert. Die Verbindung fehlt, die Redaktion versucht es gleich wieder.", "fehler");
    // Der wartende Versuch hält auch die Warnung beim Schliessen des Fensters wach.
    saveTimer = window.setTimeout(() => void save(), 5000);
    return false;
  }
  const { version } = (await response.json()) as { version: string };
  const neueNummer = current.rel === doc.rel && current.nummer !== doc.nummer;
  if (current.rel === doc.rel) current = { ...current, ...doc, version };
  if (online) {
    liveUngespeichert = false;
    if (speichernKnopf) speichernKnopf.disabled = true;
    if (verwerfenKnopf) verwerfenKnopf.hidden = true;
    beobachteSetzen();
  }
  setSaved(online ? "Veröffentlicht ✓" : "Gespeichert ✓");
  spaeterSeitenCheck();
  // Das Verzeichnis zeigt die Nummer und sortiert danach; die übrigen Seiten ihren Titel.
  if (neueNummer || !isBrief(current)) void loadList().then(pruefeNummer);
  return true;
}

/** Wartendes Speichern sofort ausführen. */
async function saveNow(): Promise<boolean> {
  if (saveTimer != null) window.clearTimeout(saveTimer);
  return save();
}

/**
 * Vor jedem Wechsel: Wartendes speichern, dann eine Fassung schreiben.
 * Geht das Speichern nicht, entscheidet Patrick, ob die Änderungen verloren gehen dürfen.
 */
async function flushCommit(): Promise<boolean> {
  // Die allgemeinen Angaben speichern nur mit «Speichern»: Wer wechselt, entscheidet.
  if (!allgemeinSeite.hidden && allgemeinVerwaltung.ungespeichert()) {
    const weg = await ask({
      titel: "Nicht gespeichert",
      text: "Die allgemeinen Angaben haben Änderungen, die noch nicht gespeichert sind. Wer jetzt wechselt, verliert sie.",
      ja: "Trotzdem wechseln",
      nein: "Hierbleiben",
      gefahr: true,
    });
    if (!weg) {
      merke("allgemein");
      return false;
    }
    allgemeinVerwaltung.verwirf();
  }
  // Online-Änderungen und unvollständige Felder lassen sich nicht einfach mitspeichern.
  if (current && (liveUngespeichert || felder?.fehler())) {
    const weg = await ask({
      titel: "Nicht gespeichert",
      text: liveUngespeichert
        ? "Diese Seite hat Änderungen, die noch nicht auf der Website sind. Wer jetzt wechselt, verliert sie."
        : "Einige Felder sind noch nicht ausgefüllt, darum ist die letzte Änderung nicht gespeichert. Wer jetzt wechselt, verliert sie.",
      ja: "Trotzdem wechseln",
      nein: "Hierbleiben",
      gefahr: true,
    });
    if (!weg) {
      merke(current.rel);
      return false;
    }
    liveUngespeichert = false;
    if (saveTimer != null) window.clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (saveTimer != null && !(await saveNow())) {
    const weg = await ask({
      titel: "Nicht gespeichert",
      text: "Die letzten Änderungen sind noch nicht gespeichert, weil die Verbindung zum Server fehlt. Wer jetzt wechselt, verliert sie.",
      ja: "Trotzdem wechseln",
      nein: "Hierbleiben",
      gefahr: true,
    });
    if (!weg) {
      // «Zurück» im Browser hat die Adresse schon geändert. Sie soll wieder zum offenen Blatt passen.
      if (current) merke(current.rel);
      return false;
    }
    if (saveTimer != null) window.clearTimeout(saveTimer);
    saveTimer = null;
  }
  await fetch("/api/commit", { method: "POST", keepalive: true }).catch(() => null);
  return true;
}

async function post(url: string, payload: unknown): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

async function errorText(response: Response, fallback: string): Promise<string> {
  const json = (await response.json().catch(() => ({}))) as { error?: string };
  return json.error ?? fallback;
}

interface SetzStatus {
  ok: boolean;
  zeit: string;
  fehler?: string;
}

let setzStand: SetzStatus | null = null;
let setzBeobachtung = 0;

function zeigeSetzen(wird: boolean): void {
  const zeit = setzStand ? eingangFormat.format(new Date(setzStand.zeit)) : "";
  setzStatus.textContent = wird ? "Website wird aktualisiert …" : !setzStand ? "" : setzStand.ok ? `Website aktuell · ${zeit}` : "Website nicht aktualisiert";
  setzStatus.dataset.kind = wird ? "busy" : setzStand?.ok === false ? "fehler" : "ok";
  setzWarnung.hidden = wird || setzStand?.ok !== false;
  if (!setzWarnung.hidden) {
    setzWarnung.replaceChildren(
      h("strong", {}, "Die Website konnte nicht aktualisiert werden. "),
      "Online ist noch der vorherige Stand. Wenn es nach dem nächsten Speichern noch dasteht, bitte an den Support schreiben.",
      h("pre", {}, setzStand?.fehler ?? ""),
    );
  }
}

async function holeSetzen(): Promise<SetzStatus | null> {
  const json = (await fetch("/api/status", { cache: "no-store" }).then((res) => res.json()).catch(() => null)) as { status: SetzStatus | null } | null;
  return json?.status ?? null;
}

async function pruefeSetzen(): Promise<void> {
  setzStand = await holeSetzen();
  zeigeSetzen(setzBeobachtung !== 0 && aktiveBeobachtung);
}

let aktiveBeobachtung = false;

/** Nach einem Speichern: wartet, bis die Seite neu gesetzt hat, höchstens eine Minute. */
function beobachteSetzen(): void {
  const meine = ++setzBeobachtung;
  const vorher = setzStand?.zeit;
  aktiveBeobachtung = true;
  zeigeSetzen(true);
  void (async () => {
    for (let i = 0; i < 30 && meine === setzBeobachtung; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const neu = await holeSetzen();
      if (neu && neu.zeit !== vorher) {
        setzStand = neu;
        break;
      }
    }
    if (meine !== setzBeobachtung) return;
    aktiveBeobachtung = false;
    zeigeSetzen(false);
  })();
}

/** Fragt nach dem Titel und legt eine neue Seite als Entwurf an. */
async function neueSeiteAnlegen(): Promise<void> {
  if (!(await flushCommit())) return;
  const eingabe = h("input", { type: "text", placeholder: "z. B. Für Familien", "aria-label": "Titel der neuen Seite", required: true });
  const hinweisText = h("p", { class: "leise", role: "alert" });
  const ortWahl = h(
    "select",
    { "aria-label": "Platz im Menü" },
    h("option", { value: "true" }, "Hauptmenü"),
    h("option", { value: "angebot" }, "Unter «Unser Angebot»"),
    h("option", { value: "" }, "Nicht im Menü"),
  );
  const titel = await new Promise<string | null>((resolve) => {
    const dialog: HTMLDialogElement = h(
      "dialog",
      {},
      h(
        "form",
        {
          method: "dialog",
          onsubmit: () => resolve(eingabe.value.trim() || null),
        },
        h("h2", {}, "Neue Seite anlegen"),
        h("p", {}, `Sie bekommt die Vorlage «${vorlageName("abschnitte")}» und beginnt als Entwurf. Aus dem Titel entsteht die Adresse.`),
        eingabe,
        h("label", { class: "datum" }, "Menü", ortWahl),
        h("p", { class: "leise" }, "Auf der Website erscheint sie im Menü erst, wenn sie veröffentlicht ist."),
        hinweisText,
        h(
          "div",
          { class: "aktionen" },
          h("button", { type: "button", onclick: () => { dialog.close(); resolve(null); } }, "Abbrechen"),
          h("button", { type: "submit", class: "haupt" }, "Anlegen"),
        ),
      ),
    );
    dialog.addEventListener("cancel", () => resolve(null));
    dialog.addEventListener("close", () => dialog.remove());
    document.body.append(dialog);
    dialog.showModal();
    eingabe.focus();
  });
  if (!titel) return;
  const response = await post("/api/seiten", { titel, menue: menueOrt(ortWahl.value) }).catch(() => null);
  if (!response?.ok) {
    await ask({ titel: "Das hat nicht geklappt", text: response ? await errorText(response, "Die Seite liess sich nicht anlegen.") : "Keine Verbindung zum Server.", ja: "OK" });
    return;
  }
  const doc = (await response.json()) as Doc;
  await loadList();
  await openPage(doc.rel);
  setSaved("Neue Seite angelegt ✓");
}

async function newBrief(): Promise<void> {
  if (!(await flushCommit())) return;
  const response = await fetch("/api/briefs", { method: "POST" });
  if (!response.ok) {
    await ask({
      titel: "Das hat nicht geklappt",
      text: await errorText(response, "Der neue Newsletter liess sich nicht anlegen."),
      ja: "OK",
    });
    return;
  }
  const doc = (await response.json()) as Doc;
  current = doc;
  await loadList();
  await openPage(doc.rel);
}

async function openPreview(): Promise<void> {
  if (!current) return;
  // Das Fenster sofort öffnen, sonst blockiert der Browser es nach dem Speichern.
  const win = window.open("", "_blank");
  await saveNow();
  const url = `/api/preview?rel=${encodeURIComponent(current.rel)}`;
  if (win) win.location.href = url;
  else window.location.href = url;
}

/** Fehler beim offenen Blatt in der Leiste, sonst als Hinweis. */
async function melde(offen: boolean, text: string): Promise<void> {
  if (offen) setSaved(text, "fehler");
  else await ask({ titel: "Das hat nicht geklappt", text, ja: "OK" });
}

/** Ohne `rel` das offene Blatt. Aus dem Verzeichnis auch jede andere Seite. */
async function publish(rel = current?.rel, ohneFrage = false): Promise<boolean> {
  if (!rel) return false;
  const offen = current?.rel === rel;
  if (offen) {
    if (isBrief(current) && !titelInput.value.trim()) {
      titelInput.focus();
      setSaved("Bitte zuerst ein Thema eingeben.", "fehler");
      return false;
    }
    if (!(await saveNow())) return false;
  }
  const page = offen ? current : alleSeiten.find((item) => item.rel === rel);
  if (!page) return false;
  if (isBrief(page) && !thema(page.titel)) {
    await ask({ titel: "Noch ohne Thema", text: "Bitte den Newsletter öffnen und zuerst ein Thema eingeben.", ja: "OK" });
    return false;
  }
  const ja = ohneFrage || await ask({
    titel: "Jetzt veröffentlichen?",
    text: isBrief(page)
      ? `„${page.titel}“ erscheint sofort auf der Website und auf der Startseite.`
      : `„${page.titel}“ erscheint sofort auf der Website${page.menue ? " und im Menü" : ""}.`,
    ja: "Veröffentlichen",
    nein: "Noch nicht",
  });
  if (!ja) return false;
  if (offen) setSaved("Veröffentlicht …", "busy");
  const response = await post("/api/publish", { rel });
  if (!response.ok) {
    await melde(current?.rel === rel, await errorText(response, "Veröffentlichen fehlgeschlagen."));
    return false;
  }
  const doc = (await response.json()) as Doc;
  if (current?.rel === rel) {
    current = doc;
    // Die Datei hat jetzt das Thema im Namen. Derselbe Eintrag im Verlauf, nur mit neuer Adresse.
    history.replaceState(null, "", `#${current.rel}`);
    renderStand();
    setSaved("Veröffentlicht ✓");
    void loadHistory(current.rel);
  }
  beobachteSetzen();
  await loadList();
  return true;
}

async function unpublish(rel = current?.rel, ohneFrage = false): Promise<boolean> {
  if (!rel) return false;
  const offen = current?.rel === rel;
  if (offen && !(await erstSichern())) return false;
  const page = offen ? current : alleSeiten.find((item) => item.rel === rel);
  if (!page) return false;
  const ja = ohneFrage || await ask({
    titel: "Von der Website nehmen?",
    text: `„${page.titel}“ verschwindet von der Website. Der Text bleibt hier als Entwurf erhalten.`,
    ja: "Zurückziehen",
    nein: "Abbrechen",
  });
  if (!ja) return false;
  const response = await post("/api/unpublish", { rel });
  if (!response.ok) {
    await melde(current?.rel === rel, await errorText(response, "Zurückziehen fehlgeschlagen."));
    return false;
  }
  const doc = (await response.json()) as Doc;
  if (current?.rel === rel) {
    current = doc;
    renderStand();
    setSaved("Zurückgezogen. Jetzt nur noch als Entwurf hier.");
    void loadHistory(current.rel);
  }
  beobachteSetzen();
  await loadList();
  return true;
}

/** Legt eine Kopie als Entwurf an und öffnet sie. Ein Newsletter bekommt die nächste Nummer. */
async function copyPage(rel: string): Promise<boolean> {
  if (current?.rel === rel && !(await erstSichern())) return false;
  const response = await post("/api/copy", { rel });
  if (!response.ok) {
    await melde(current?.rel === rel, await errorText(response, "Die Kopie liess sich nicht anlegen."));
    return false;
  }
  const doc = (await response.json()) as Doc;
  await loadList();
  await openPage(doc.rel);
  setSaved("Kopie angelegt ✓");
  return true;
}

async function restoreFromTrash(rel: string): Promise<void> {
  const response = await post("/api/zurueckholen", { rel });
  if (!response.ok) {
    await melde(false, await errorText(response, "Zurückholen fehlgeschlagen."));
    return;
  }
  const doc = (await response.json()) as Doc;
  await loadList();
  await openPage(doc.rel);
  setSaved("Aus dem Papierkorb zurückgeholt ✓");
}

async function deleteDraft(): Promise<void> {
  if (!current?.entwurf) return;
  const ja = await ask({
    titel: "Entwurf löschen?",
    text: `„${current.titel}“ kommt in den Papierkorb. Von dort lässt es sich zurückholen.`,
    ja: "Löschen",
    nein: "Abbrechen",
    gefahr: true,
  });
  if (!ja || !current?.entwurf) return;
  await deletePage(current.rel);
}

/** Legt einen Entwurf in den Papierkorb. Ist er offen, geht die Redaktion zur Startseite. */
async function deletePage(rel: string): Promise<boolean> {
  const offen = current?.rel === rel;
  if (offen) {
    if (saveTimer != null) window.clearTimeout(saveTimer);
    saveTimer = null;
  }
  const response = await fetch(`/api/pages?rel=${encodeURIComponent(rel)}`, { method: "DELETE" });
  if (!response.ok) {
    await melde(offen, await errorText(response, "Löschen fehlgeschlagen."));
    return false;
  }
  const { papierkorb: ablage } = (await response.json().catch(() => ({}))) as { papierkorb?: string };
  if (current?.rel === rel) showStart();
  await loadList();
  if (ablage) toast("In den Papierkorb gelegt.", { label: "Rückgängig", aus: () => void restoreFromTrash(ablage) });
  return true;
}

interface Revision {
  rev: string;
  date: string;
  message: string;
  path: string;
}

async function loadHistory(rel: string): Promise<void> {
  vorschau.hidden = true;
  fassungen.replaceChildren();
  const response = await fetch(`/api/history?rel=${encodeURIComponent(rel)}`);
  const json = (await response.json()) as { revisions: Revision[] };
  if (current?.rel !== rel) return;
  for (const revision of json.revisions) {
    const item = document.createElement("li");
    const when = document.createElement("time");
    when.dateTime = revision.date;
    when.textContent = new Date(revision.date).toLocaleString("de-CH", { dateStyle: "medium", timeStyle: "short" });
    const text = document.createElement("span");
    text.textContent = revision.message;
    const knöpfe = document.createElement("span");
    knöpfe.className = "knoepfe";
    const ansehen = button("Ansehen", "leise", () => void showRevision(rel, revision, item, ansehen));
    ansehen.dataset.ansehen = "";
    knöpfe.append(ansehen, button("Diese Fassung zurückholen", "leise", () => void restoreRevision(rel, revision)));
    item.append(when, text, knöpfe);
    fassungen.append(item);
  }
  if (json.revisions.length === 0) {
    const item = document.createElement("li");
    item.textContent = "Noch keine früheren Fassungen.";
    fassungen.append(item);
  }
}

/** Was heute im Text steht, je Absatz, Titel oder Listenpunkt. */
function jetzigeBloecke(): string[] {
  return felder
    ? klartextBloecke(felder.markdown())
    : bloecke(editorHost.querySelector(".ProseMirror") ?? editorHost).map((block) => norm(block.textContent ?? ""));
}

let offeneFassung: HTMLElement | null = null;

/** Zeigt die Fassung direkt unter ihrem Eintrag. Ein zweiter Klick schliesst sie. */
async function showRevision(rel: string, revision: Revision, item: HTMLElement, knopf: HTMLButtonElement): Promise<void> {
  for (const andere of fassungen.querySelectorAll<HTMLButtonElement>("[data-ansehen]")) andere.textContent = "Ansehen";
  if (offeneFassung === item && !vorschau.hidden) {
    vorschau.hidden = true;
    offeneFassung = null;
    return;
  }
  const params = new URLSearchParams({ rel, rev: revision.rev, path: revision.path });
  const response = await fetch(`/api/history?${params}`);
  const json = (await response.json()) as { html: string; titel: string };
  if (current?.rel !== rel) return;
  offeneFassung = item;
  knopf.textContent = "Schliessen";
  vorschau.innerHTML = `<p class="legende"></p><h3 class="fassung-titel">${esc(json.titel)}</h3>${json.html}`;
  const titel = vorschau.querySelector<HTMLElement>(".fassung-titel")!;
  if (json.titel !== collect().titel) titel.classList.add("anders");
  const { anders, neu } = markiereUnterschiede(vorschau, jetzigeBloecke());
  // Nur sagen, was wirklich anders ist.
  const teile = [
    titel.classList.contains("anders") ? "Der Titel war anders." : "",
    anders ? `${anders === 1 ? "1 Absatz steht" : `${anders} Absätze stehen`} so nicht mehr im Text (gelb, geänderte Wörter hervorgehoben).` : "",
    neu ? `Seither ${neu === 1 ? "ist 1 Absatz" : `sind ${neu} Absätze`} dazugekommen.` : "",
  ].filter(Boolean);
  vorschau.querySelector(".legende")!.textContent = teile.length ? teile.join(" ") : "Diese Fassung ist gleich wie der jetzige Text.";
  item.append(vorschau);
  vorschau.hidden = false;
  vorschau.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

async function restoreRevision(rel: string, revision: Revision): Promise<void> {
  const ja = await ask({
    titel: "Diese Fassung zurückholen?",
    text: "Der jetzige Text wird ersetzt, bleibt aber unter „Frühere Fassungen“ erhalten.",
    ja: "Zurückholen",
    nein: "Abbrechen",
  });
  if (!ja) return;
  if (!(await erstSichern())) return;
  const response = await post("/api/restore", { rel, rev: revision.rev, path: revision.path });
  if (!response.ok) {
    setSaved(await errorText(response, "Zurückholen fehlgeschlagen."), "fehler");
    return;
  }
  await openPage(rel);
  setSaved("Fassung zurückgeholt ✓");
  await loadList();
}

/** Monate bis zur Löschung, vom Server. 12, bis er etwas anderes sagt. */
let aufbewahrungMonate = 12;
const BALD_TAGE = 30;

function tageBisLoeschung(anfrage: Anfrage): number {
  return Math.ceil((new Date(anfrage.loeschtAm).getTime() - Date.now()) / 86_400_000);
}

function baldGeloescht(): Anfrage[] {
  return alleAnfragen.filter((anfrage) => tageBisLoeschung(anfrage) <= BALD_TAGE);
}

const TELEGRAM: Record<NonNullable<Anfrage["telegram"]>, string> = {
  gesendet: "an Telegram gesendet",
  fehler: "Telegram fehlgeschlagen",
  aus: "Telegram aus",
};

const STATUS_MARKE: Record<Anfrage["status"], string> = {
  neu: `<span class="marke neu">Neu</span>`,
  gelesen: `<span class="marke offen">Gelesen</span>`,
  erledigt: `<span class="marke online">Erledigt</span>`,
};

function wer(anfrage: Anfrage): string {
  return `${anfrage.vorname} ${anfrage.name}`;
}

function offen(anfrage: Anfrage): boolean {
  return anfrage.status !== "erledigt";
}

/** „vor 3 Tagen“, für die älteste offene Anfrage. */
function wartetSeit(iso: string): string {
  const tage = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (tage <= 0) return "seit heute";
  if (tage === 1) return "seit gestern";
  return `seit ${tage} Tagen`;
}

function zaehle() {
  const neu = alleAnfragen.filter((a) => a.status === "neu").length;
  const gelesen = alleAnfragen.filter((a) => a.status === "gelesen").length;
  const offene = alleAnfragen.filter(offen).length;
  return { neu, gelesen, offen: offene, erledigt: alleAnfragen.length - offene, alle: alleAnfragen.length };
}

function anfrageItem(anfrage: Anfrage): HTMLElement {
  const item = document.createElement("button");
  item.type = "button";
  item.dataset.anfrage = anfrage.id;
  item.toggleAttribute("aria-current", anfrage.id === gewaehlt);
  const head = document.createElement("span");
  head.className = "kopfzeile";
  head.innerHTML = `${anfrage.status === "erledigt" ? "" : STATUS_MARKE[anfrage.status] + " "}${esc(eingangFormat.format(new Date(anfrage.eingang)))}`;
  const text = document.createElement("span");
  text.className = "thema";
  text.textContent = wer(anfrage);
  item.append(head, text);
  item.addEventListener("click", () => void openAnfrage(anfrage.id));
  const zeile = document.createElement("div");
  zeile.className = anfrage.status === "neu" ? "eintrag ungelesen" : "eintrag";
  zeile.append(item);
  return zeile;
}

function anfrageKarte(anfrage: Anfrage): HTMLElement {
  const karte = document.createElement("li");
  karte.id = `anfrage-${anfrage.id}`;
  karte.dataset.status = anfrage.status;
  karte.classList.toggle("gewaehlt", anfrage.id === gewaehlt);
  const kopf = document.createElement("p");
  kopf.className = "kopfzeile";
  kopf.innerHTML = `${STATUS_MARKE[anfrage.status]} `;
  const when = document.createElement("time");
  when.dateTime = anfrage.eingang;
  when.textContent = eingangFormat.format(new Date(anfrage.eingang));
  kopf.append(when);
  if (anfrage.status === "erledigt" && anfrage.seit) kopf.append(` · erledigt am ${eingangFormat.format(new Date(anfrage.seit))}`);
  if (anfrage.telegram) kopf.append(` · ${TELEGRAM[anfrage.telegram]}`);
  const tage = tageBisLoeschung(anfrage);
  const loeschung = document.createElement(tage <= BALD_TAGE ? "strong" : "span");
  loeschung.textContent = tage <= BALD_TAGE
    ? `wird ${tage <= 1 ? "morgen" : `in ${tage} Tagen`} gelöscht`
    : `wird am ${tagFormat.format(new Date(anfrage.loeschtAm))} gelöscht`;
  kopf.append(" · ", loeschung);
  const name = document.createElement("h2");
  name.textContent = wer(anfrage);
  const mail = document.createElement("a");
  mail.href = `mailto:${encodeURIComponent(anfrage.email).replace("%40", "@")}?subject=${encodeURIComponent("Ihre Anfrage an Advocat Finanz")}`;
  mail.textContent = anfrage.email;
  const nachricht = document.createElement("p");
  nachricht.className = "nachricht";
  nachricht.textContent = anfrage.nachricht;
  const knoepfe = document.createElement("div");
  knoepfe.className = "aktionen";
  const antworten = document.createElement("a");
  antworten.className = "knopf";
  antworten.href = mail.href;
  antworten.textContent = "Per E-Mail antworten";
  // Wer antwortet, hat sie gelesen.
  antworten.addEventListener("click", () => {
    if (anfrage.status === "neu") void setStatus(anfrage.id, "gelesen");
  });
  if (anfrage.status === "erledigt") {
    knoepfe.append(antworten, button("Wieder öffnen", "leise", () => void setStatus(anfrage.id, "gelesen")));
  } else {
    knoepfe.append(button("Erledigt ✓", "haupt", () => void setStatus(anfrage.id, "erledigt")), antworten);
    knoepfe.append(
      anfrage.status === "neu"
        ? button("Als gelesen markieren", "leise", () => void setStatus(anfrage.id, "gelesen"))
        : button("Als ungelesen markieren", "leise", () => void setStatus(anfrage.id, "neu")),
    );
  }
  karte.append(kopf, name, mail, nachricht, knoepfe);
  return karte;
}

/** Holt die Anfragen und zeichnet alles neu, was davon abhängt. Unverändert: nichts. */
async function loadAnfragen(force = false): Promise<void> {
  const json = (await fetch("/api/anfragen", { cache: "no-store" })
    .then((res) => res.json())
    .catch(() => null)) as { anfragen: Anfrage[]; aufbewahrungMonate?: number } | null;
  if (!json) return;
  if (json.aufbewahrungMonate) aufbewahrungMonate = json.aufbewahrungMonate;
  const stand = JSON.stringify(json.anfragen);
  if (!force && stand === anfragenStand) return;
  anfragenStand = stand;
  alleAnfragen = json.anfragen;
  renderAnfragen();
}

function renderAnfragen(): void {
  const zahl = zaehle();
  document.title = `${zahl.neu ? `(${zahl.neu}) ` : ""}Redaktion · Advocat Finanz`;
  anfragenZahl.textContent = zahl.neu ? `${zahl.neu} neu` : "";
  // Gelb: gelesen, aber noch nicht erledigt. Steht neben dem Roten, nie statt seiner.
  anfragenGelesen.textContent = zahl.gelesen ? `${zahl.gelesen} offen` : "";

  // Im Verzeichnis nur, was noch offen ist. Erledigte stehen in der Übersicht.
  const offene = alleAnfragen.filter(offen);
  anfragenListe.replaceChildren(...offene.map(anfrageItem));
  if (offene.length === 0) {
    const leer = document.createElement("p");
    leer.className = "leise";
    leer.textContent = alleAnfragen.length ? "Alle Anfragen sind erledigt." : "Noch keine Anfragen.";
    anfragenListe.append(leer);
  }

  renderStartAnfragen(zahl);
  if (!anfragenSeite.hidden) renderUebersicht();
}

function renderStartAnfragen(zahl: ReturnType<typeof zaehle>): void {
  // Neue zuerst. Gibt es keine, die noch offenen.
  const zeigen = (zahl.neu ? alleAnfragen.filter((a) => a.status === "neu") : alleAnfragen.filter(offen)).slice(0, 3);
  startAnfragen.classList.toggle("dringend", zahl.neu > 0);
  aufgabe(startAnfragen, {
    titel: "Kontaktaufnahme",
    zahlen: [
      ...(zahl.neu ? [{ text: `${zahl.neu} neu`, art: "neu" as const }] : []),
      ...(zahl.gelesen ? [{ text: `${zahl.gelesen} offen`, art: "offen" as const }] : []),
    ],
    gross: zahl.neu
      ? zahl.neu === 1 ? "Eine neue Anfrage" : `${zahl.neu} neue Anfragen`
      : zahl.gelesen
        ? `${zahl.gelesen === 1 ? "Eine gelesene Anfrage ist" : `${zahl.gelesen} gelesene Anfragen sind`} noch offen`
        : "Keine neuen Anfragen",
    leise: zahl.alle
      ? `${zahl.offen} offen · ${zahl.erledigt} erledigt · ${baldText() ?? `gelöscht ${aufbewahrungMonate} Monate nach Eingang`}`
      : `Anfragen aus dem Kontaktformular erscheinen hier. Sie werden ${aufbewahrungMonate} Monate nach Eingang automatisch gelöscht.`,
    liste: zeigen.map((anfrage) => ({
      label: wer(anfrage),
      info: anfrage.status === "neu" ? `Neu · wartet ${wartetSeit(anfrage.eingang)}` : `Gelesen · ${eingangFormat.format(new Date(anfrage.eingang))}`,
      vorschau: anfrage.nachricht.replace(/\s+/g, " ").trim().slice(0, 160),
      onClick: () => void openAnfrage(anfrage.id),
    })),
    knopf: button("Zur Kontaktaufnahme", zahl.neu ? "haupt" : "", () => void showAnfragen()),
  });
  renderNaechstes();
}

function kachel(filter: AnfragenFilter, wert: number, label: string, unter: string): HTMLButtonElement {
  const element = document.createElement("button");
  element.type = "button";
  element.className = "kachel";
  element.setAttribute("aria-pressed", String(anfragenFilter === filter));
  element.innerHTML = `<span class="label">${esc(label)}</span><span class="wert">${wert}</span><span class="unter">${esc(unter)}</span>`;
  element.addEventListener("click", () => {
    anfragenFilter = filter;
    renderUebersicht();
  });
  return element;
}

function offenUnter(zahl: ReturnType<typeof zaehle>): string {
  if (!zahl.offen) return "keine";
  if (!zahl.neu) return "alle gelesen";
  return zahl.gelesen ? `${zahl.neu} neu, ${zahl.gelesen} gelesen` : "alle neu";
}

function renderUebersicht(): void {
  const zahl = zaehle();
  anfragenKacheln.replaceChildren(
    kachel("offen", zahl.offen, "Offen", offenUnter(zahl)),
    kachel("erledigt", zahl.erledigt, "Erledigt", zahl.alle ? `${Math.round((zahl.erledigt / zahl.alle) * 100)} % aller Anfragen` : "–"),
    kachel("alle", zahl.alle, "Gesamt", `${alleAnfragen.filter((a) => Date.now() - new Date(a.eingang).getTime() < 30 * 86_400_000).length} in den letzten 30 Tagen`),
  );
  const sichtbare = alleAnfragen.filter((a) =>
    anfragenFilter === "alle" ? true : anfragenFilter === "offen" ? offen(a) : !offen(a),
  );
  const aeltesteOffene = alleAnfragen.filter(offen).at(-1);
  if (alleAnfragen.length === 0) anfragenText.textContent = "Noch keine Anfragen über das Kontaktformular.";
  else if (anfragenFilter === "offen") {
    anfragenText.textContent = aeltesteOffene
      ? `Offene Anfragen, die neueste zuerst. Die älteste wartet ${wartetSeit(aeltesteOffene.eingang)}.`
      : "Keine offenen Anfragen. Alles erledigt.";
  } else if (anfragenFilter === "erledigt") {
    anfragenText.textContent = sichtbare.length ? "Erledigte Anfragen, die neueste zuerst." : "Noch nichts erledigt.";
  } else anfragenText.textContent = "Alle Anfragen, die neueste zuerst.";
  anfragenFrist.textContent =
    `Jede Anfrage wird ${aufbewahrungMonate} Monate nach Eingang automatisch gelöscht, auch wenn sie noch offen ist. ` +
    "So steht es in der Datenschutzerklärung. Was Sie länger brauchen, legen Sie in Ihrer Kundenakte ab." +
    (baldText() ? ` ${baldText()}.` : "");
  anfragenKarten.replaceChildren(...sichtbare.map(anfrageKarte));
}

/** «2 werden in den nächsten 30 Tagen gelöscht», oder null. */
function baldText(): string | null {
  const bald = baldGeloescht().length;
  if (!bald) return null;
  return `${bald === 1 ? "Eine wird" : `${bald} werden`} in den nächsten ${BALD_TAGE} Tagen gelöscht`;
}

async function setStatus(id: string, status: Anfrage["status"]): Promise<void> {
  const response = await fetch("/api/anfragen", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id, status }),
  }).catch(() => null);
  if (!response?.ok) {
    await ask({
      titel: "Das hat nicht geklappt",
      text: response ? await errorText(response, "Der Stand liess sich nicht speichern.") : "Keine Verbindung zum Server.",
      ja: "OK",
    });
    return;
  }
  await loadAnfragen(true);
}

function briefKachel(filter: typeof briefeFilter, wert: number, label: string, unter: string): HTMLButtonElement {
  const element = document.createElement("button");
  element.type = "button";
  element.className = "kachel";
  element.setAttribute("aria-pressed", String(briefeFilter === filter));
  element.innerHTML = `<span class="label">${esc(label)}</span><span class="wert">${wert}</span><span class="unter">${esc(unter)}</span>`;
  element.addEventListener("click", () => {
    briefeFilter = filter;
    renderBriefUebersicht();
  });
  return element;
}

function briefKarte(page: PageSummary): HTMLElement {
  const karte = document.createElement("li");
  karte.dataset.entwurf = String(page.entwurf);
  const kopf = document.createElement("p");
  kopf.className = "kopfzeile";
  kopf.innerHTML = page.entwurf
    ? `<span class="marke entwurf">Entwurf</span> Nr. ${page.nummer ?? ""} · ${esc(shortDate(page.datum))}`
    : `<span class="marke online">Online</span> Nr. ${page.nummer ?? ""} · ${esc(shortDate(page.datum))}`;
  const titel = document.createElement("h2");
  const link = button(thema(page.titel) || "Noch ohne Thema", "titel-knopf", () => void openPage(page.rel));
  titel.append(link);
  const text = document.createElement("p");
  text.className = "auszug";
  text.textContent = page.auszug || "Noch kein Text.";
  const knoepfe = document.createElement("div");
  knoepfe.className = "aktionen";
  knoepfe.append(button("Bearbeiten", "", () => void openPage(page.rel)));
  if (page.entwurf) knoepfe.append(button("Veröffentlichen", "haupt", () => void publish(page.rel)));
  else {
    const ansehen = document.createElement("a");
    ansehen.className = "knopf";
    ansehen.href = `${publicOrigin}${page.href}`;
    ansehen.target = "_blank";
    ansehen.rel = "noopener";
    ansehen.textContent = "Auf der Website ansehen ↗";
    knoepfe.append(ansehen);
  }
  knoepfe.append(button("Kopie anlegen", "leise", () => void copyPage(page.rel)));
  karte.append(kopf, titel, text, knoepfe);
  return karte;
}

/** Alle Newsletter auf einen Blick: Zahlen oben, Suche, darunter die Karten. Entwürfe zuerst. */
function renderBriefUebersicht(): void {
  const entwuerfe = alleBriefe.filter((page) => page.entwurf);
  const online = alleBriefe.filter((page) => !page.entwurf);
  const zuletzt = online[0];
  briefeKacheln.replaceChildren(
    briefKachel("entwuerfe", entwuerfe.length, "Entwürfe", entwuerfe.length ? "warten aufs Veröffentlichen" : "keine offenen"),
    briefKachel("online", online.length, "Online", zuletzt ? `zuletzt Nr. ${zuletzt.nummer ?? ""} am ${shortDate(zuletzt.datum)}` : "noch keiner"),
    briefKachel("alle", alleBriefe.length, "Gesamt", "alle Newsletter"),
  );
  const suche = briefeSuche.value.trim().toLowerCase();
  const sichtbare = alleBriefe
    .filter((page) => (briefeFilter === "alle" ? true : briefeFilter === "entwuerfe" ? page.entwurf : !page.entwurf))
    .filter((page) => !suche || page.titel.toLowerCase().includes(suche) || String(page.nummer ?? "") === suche.replace(/^nr\.?\s*/, ""));
  if (suche) briefeText.textContent = sichtbare.length ? `${sichtbare.length} Treffer für «${briefeSuche.value.trim()}».` : `Nichts gefunden für «${briefeSuche.value.trim()}».`;
  else if (briefeFilter === "entwuerfe") briefeText.textContent = sichtbare.length ? "Entwürfe, nur hier in der Redaktion sichtbar." : "Keine offenen Entwürfe.";
  else if (briefeFilter === "online") briefeText.textContent = "Veröffentlichte Newsletter, der neueste zuerst.";
  else briefeText.textContent = "Alle Newsletter. Entwürfe zuerst, dann der neueste.";
  briefeKarten.replaceChildren(...sichtbare.map(briefKarte));
}

/** Die Übersicht der Newsletter, wie die Kontaktaufnahme. */
async function showBriefe(): Promise<void> {
  if (!(await flushCommit())) return;
  current = null;
  gewaehlt = null;
  markCurrent();
  zeigeNur(briefeSeite);
  briefeGruppe.open = true;
  merke("newsletter");
  renderBriefUebersicht();
  nachOben();
}

const ART_LABEL: Record<Wunsch["art"], string> = {
  // Intern bleiben die alten Werte, damit gespeicherte Wünsche ihre Art behalten.
  funktion: "Feature",
  fehler: "Bug",
  design: "Styling",
};

/** Ein Bug braucht andere Angaben als ein Feature. Feld und Knopf sagen, welche. */
function passeWunschFormAn(): void {
  const fehler = wunschArt.value === "fehler";
  wunschText.placeholder = fehler
    ? "Was ist passiert? Was hast du kurz davor gemacht? Was hättest du erwartet?"
    : "Was fehlt oder soll anders sein, und wozu?";
  wunschForm.querySelector("#wunsch-senden")!.textContent = fehler ? "Bug melden" : "An Support senden";
}

/** Browser und Fenstergrösse, damit die Betreuung einen Fehler nachstellen kann. */
function geraet(): string {
  return `${navigator.userAgent} · Fenster ${window.innerWidth}×${window.innerHeight}`;
}

/** Wünsche zeigen Absätze und **fett** wie im Assistenten, sonst reinen Text. */
function wunschHtml(text: string): string {
  return esc(text)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/^\s*[-*•]\s+/gm, "• ")
    .replace(/\n/g, "<br>");
}

const MAX_ANHAENGE = 5;
const MAX_ANHANG = 10 * 1024 * 1024;

/** Eine Datei, die Patrick an die Nachricht gehängt hat. Hochgeladen wird sie erst beim Senden. */
interface WartenderAnhang {
  datei: File;
  /** Die Vorschau für ein Bild, sonst leer. */
  vorschau: string;
  /** Schon auf dem Server: Scheitert das Senden danach, lädt ein zweiter Versuch sie nicht nochmals hoch. */
  oben?: Anhang;
}
let wartendeAnhaenge: WartenderAnhang[] = [];

function dateiGroesse(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
}

function anhangUrl(anhang: Anhang): string {
  return `/api/wuensche/anhang?id=${encodeURIComponent(anhang.id)}`;
}

/** Das Zeichen für eine Datei ohne Vorschau: ihre Endung. */
function dateiZeichen(name: string): HTMLElement {
  const zeichen = document.createElement("span");
  zeichen.className = "datei";
  zeichen.textContent = (name.match(/\.([A-Za-z0-9]{1,5})$/)?.[1] ?? "Datei").toUpperCase();
  return zeichen;
}

/** Ein Anhang auf der Karte eines gesendeten Wunsches: Ein Klick öffnet ihn in einem neuen Tab. */
function anhangAufKarte(anhang: Anhang): HTMLElement {
  const zeile = document.createElement("li");
  const link = document.createElement("a");
  link.href = anhangUrl(anhang);
  link.target = "_blank";
  link.rel = "noopener";
  link.title = `${anhang.name} öffnen`;
  if (["image/jpeg", "image/png", "image/webp", "image/gif"].includes(anhang.typ)) {
    const bild = document.createElement("img");
    bild.src = anhangUrl(anhang);
    bild.alt = "";
    bild.loading = "lazy";
    link.append(bild);
  } else link.append(dateiZeichen(anhang.name));
  const name = document.createElement("span");
  name.className = "name";
  name.textContent = anhang.name;
  const groesse = document.createElement("span");
  groesse.className = "groesse";
  groesse.textContent = dateiGroesse(anhang.groesse);
  link.append(name, groesse);
  zeile.append(link);
  return zeile;
}

function renderWartendeAnhaenge(): void {
  wunschAnhaenge.hidden = wartendeAnhaenge.length === 0;
  wunschAnhaenge.replaceChildren(
    ...wartendeAnhaenge.map((anhang) => {
      const zeile = document.createElement("li");
      const kasten = document.createElement("div");
      if (anhang.vorschau) {
        const bild = document.createElement("img");
        bild.alt = "";
        // Ein HEIC etwa zeigt nicht jeder Browser: dann steht die Endung da.
        bild.addEventListener("error", () => bild.replaceWith(dateiZeichen(anhang.datei.name)), { once: true });
        bild.src = anhang.vorschau;
        kasten.append(bild);
      } else kasten.append(dateiZeichen(anhang.datei.name));
      const name = document.createElement("span");
      name.className = "name";
      name.textContent = anhang.datei.name;
      const groesse = document.createElement("span");
      groesse.className = "groesse";
      groesse.textContent = dateiGroesse(anhang.datei.size);
      kasten.append(name, groesse);
      const weg = button("×", "leise weg", () => {
        if (anhang.vorschau) URL.revokeObjectURL(anhang.vorschau);
        wartendeAnhaenge = wartendeAnhaenge.filter((a) => a !== anhang);
        wunschMeldung.textContent = "";
        renderWartendeAnhaenge();
      });
      weg.setAttribute("aria-label", `${anhang.datei.name} entfernen`);
      weg.title = "Entfernen";
      zeile.append(kasten, weg);
      return zeile;
    }),
  );
}

/** Hängt Dateien an die Nachricht. Was nicht passt, bleibt draussen, und die Meldung sagt warum. */
function haengeAn(dateien: Iterable<File>): void {
  const abgelehnt: string[] = [];
  for (const datei of dateien) {
    const bild = datei.type.startsWith("image/") || /\.(heic|heif)$/i.test(datei.name);
    const pdf = datei.type === "application/pdf" || /\.pdf$/i.test(datei.name);
    if (!bild && !pdf) abgelehnt.push(`«${datei.name}» ist weder ein Bild noch ein PDF.`);
    else if (datei.size > MAX_ANHANG) abgelehnt.push(`«${datei.name}» ist zu gross (höchstens 10 MB).`);
    else if (wartendeAnhaenge.length >= MAX_ANHAENGE) {
      abgelehnt.push(`Höchstens ${MAX_ANHAENGE} Dateien pro Nachricht.`);
      break;
    } else wartendeAnhaenge.push({ datei, vorschau: bild ? URL.createObjectURL(datei) : "" });
  }
  wunschMeldung.textContent = abgelehnt.join(" ");
  renderWartendeAnhaenge();
}

function leereAnhaenge(): void {
  for (const anhang of wartendeAnhaenge) if (anhang.vorschau) URL.revokeObjectURL(anhang.vorschau);
  wartendeAnhaenge = [];
  renderWartendeAnhaenge();
}

/** Lädt hoch, was noch nicht oben ist. Wirft mit einer Meldung für Patrick. */
async function ladeAnhaengeHoch(): Promise<Anhang[]> {
  for (const [i, anhang] of wartendeAnhaenge.entries()) {
    if (anhang.oben) continue;
    wunschMeldung.textContent = wartendeAnhaenge.length > 1 ? `Datei ${i + 1} von ${wartendeAnhaenge.length} wird hochgeladen …` : "Datei wird hochgeladen …";
    const response = await fetch("/api/wuensche/anhang", {
      method: "POST",
      headers: { "content-type": "application/octet-stream", "x-filename": encodeURIComponent(anhang.datei.name) },
      body: anhang.datei,
    }).catch(() => null);
    if (!response) throw new Error("Keine Verbindung zum Server.");
    if (!response.ok) throw new Error(`«${anhang.datei.name}»: ${await errorText(response, "Hochladen ging nicht.")}`);
    anhang.oben = (await response.json()) as Anhang;
  }
  return wartendeAnhaenge.map((anhang) => anhang.oben!);
}

let kameraStrom: MediaStream | null = null;

/**
 * «Foto aufnehmen». Auf dem Telefon öffnet der Browser gleich die Kamera. Am Computer zeigt ein
 * Fenster das Bild der Webcam; gibt es keine oder ist sie nicht erlaubt, bleibt die Dateiauswahl.
 */
async function nimmFotoAuf(): Promise<void> {
  const telefon = window.matchMedia("(pointer: coarse)").matches;
  if (telefon || !navigator.mediaDevices?.getUserMedia) {
    wunschFotoInput.click();
    return;
  }
  try {
    kameraStrom = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } } });
  } catch (error) {
    const verboten = error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "SecurityError");
    wunschMeldung.textContent = verboten
      ? "Die Kamera ist für diese Seite nicht erlaubt. Im Browser neben der Adresse freigeben oder ein Bild als Datei anhängen."
      : "Keine Kamera gefunden. Bitte ein Bild als Datei anhängen.";
    return;
  }
  kameraBild.srcObject = kameraStrom;
  kamera.showModal();
}

function schliesseKamera(): void {
  for (const spur of kameraStrom?.getTracks() ?? []) spur.stop();
  kameraStrom = null;
  kameraBild.srcObject = null;
  if (kamera.open) kamera.close();
}

async function loadWuensche(): Promise<void> {
  const json = (await fetch("/api/wuensche", { cache: "no-store" })
    .then((res) => res.json())
    .catch(() => null)) as { wuensche: Wunsch[] } | null;
  if (!json) return;
  alleWuensche = json.wuensche;
  const offene = alleWuensche.filter((w) => w.status === "offen").length;
  wuenscheZahl.textContent = offene ? `${offene} offen` : "";
  startSupportOffen.hidden = offene === 0;
  startSupportOffen.textContent = `${offene} offen`;
  renderWuenscheListe();
  if (!wuenscheSeite.hidden) renderWuensche();
}

function wunschKachel(filter: typeof wuenscheFilter, wert: number, label: string, unter: string): HTMLButtonElement {
  const element = document.createElement("button");
  element.type = "button";
  element.className = "kachel";
  element.setAttribute("aria-pressed", String(wuenscheFilter === filter));
  element.innerHTML = `<span class="label">${esc(label)}</span><span class="wert">${wert}</span><span class="unter">${esc(unter)}</span>`;
  element.addEventListener("click", () => {
    wuenscheFilter = filter;
    renderWuensche();
  });
  return element;
}

async function aendereWunsch(id: string, aenderung: { status?: Wunsch["status"]; aktion?: "senden" }): Promise<void> {
  const response = await fetch("/api/wuensche", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id, ...aenderung }),
  }).catch(() => null);
  if (!response?.ok) {
    await ask({ titel: "Das hat nicht geklappt", text: response ? await errorText(response, "Der Eintrag liess sich nicht ändern.") : "Keine Verbindung zum Server.", ja: "OK" });
    return;
  }
  await loadWuensche();
}

/** Ein Eintrag im Verzeichnis unter «Support», wie eine Anfrage unter «Kontaktaufnahme». */
function wunschItem(wunsch: Wunsch): HTMLElement {
  const item = document.createElement("button");
  item.type = "button";
  item.dataset.wunsch = wunsch.id;
  item.toggleAttribute("aria-current", wunsch.id === gewaehlt);
  const head = document.createElement("span");
  head.className = "kopfzeile";
  head.textContent = `${ART_LABEL[wunsch.art]} · ${eingangFormat.format(new Date(wunsch.eingang))}`;
  const text = document.createElement("span");
  text.className = "thema";
  // Die erste Zeile ohne Markdown. Der Assistent beginnt oft mit «**Was fehlt:**».
  const erste = wunsch.text.split("\n").find((zeile) => zeile.trim()) ?? "";
  text.textContent = erste.replace(/\*\*[^*]+:\*\*\s*/, "").replace(/\*\*/g, "").trim().slice(0, 90) || ART_LABEL[wunsch.art];
  item.append(head, text);
  item.addEventListener("click", () => void openWunsch(wunsch.id));
  const zeile = document.createElement("div");
  zeile.className = "eintrag";
  zeile.append(item);
  return zeile;
}

function renderWuenscheListe(): void {
  // Im Verzeichnis nur, was noch offen ist. Erledigte stehen in der Übersicht.
  const offene = alleWuensche.filter((w) => w.status === "offen");
  wuenscheListe.replaceChildren(...offene.map(wunschItem));
  if (offene.length === 0) {
    const leer = document.createElement("p");
    leer.className = "leise";
    leer.textContent = alleWuensche.length ? "Alles erledigt." : "Noch nichts an den Support geschickt.";
    wuenscheListe.append(leer);
  }
}

function wunschKarte(wunsch: Wunsch): HTMLElement {
  const karte = document.createElement("li");
  karte.id = `wunsch-${wunsch.id}`;
  karte.dataset.status = wunsch.status;
  karte.classList.toggle("gewaehlt", wunsch.id === gewaehlt);
  const kopf = document.createElement("p");
  kopf.className = "kopfzeile";
  kopf.innerHTML = `${wunsch.status === "erledigt" ? `<span class="marke online">Erledigt</span>` : `<span class="marke offen">Offen</span>`} ${esc(ART_LABEL[wunsch.art])} · ${esc(eingangFormat.format(new Date(wunsch.eingang)))}${
    wunsch.status === "erledigt" && wunsch.erledigtAm ? ` · erledigt am ${esc(shortDate(wunsch.erledigtAm.slice(0, 10)))}` : ""
  }${wunsch.seite ? ` · ${esc(wunsch.seite)}` : ""}`;
  const text = document.createElement("p");
  text.className = "nachricht";
  text.innerHTML = wunschHtml(wunsch.text);
  const knoepfe = document.createElement("div");
  knoepfe.className = "aktionen";
  knoepfe.append(
    wunsch.status === "offen"
      ? button("Als erledigt markieren", "", () => void aendereWunsch(wunsch.id, { status: "erledigt" }))
      : button("Wieder öffnen", "leise", () => void aendereWunsch(wunsch.id, { status: "offen" })),
  );
  if (wunsch.telegram !== "gesendet") {
    const hinweis = document.createElement("span");
    hinweis.className = "telegram-fehlt";
    hinweis.textContent = wunsch.telegram === "aus" ? "Telegram ist nicht eingerichtet." : "Telegram hat nicht geklappt.";
    knoepfe.append(hinweis, button("Nochmals senden", "leise", () => void aendereWunsch(wunsch.id, { aktion: "senden" })));
  }
  karte.append(kopf, text);
  if (wunsch.anhaenge?.length) {
    const liste = document.createElement("ul");
    liste.className = "anhaenge";
    liste.setAttribute("aria-label", "Anhänge");
    liste.append(...wunsch.anhaenge.map(anhangAufKarte));
    karte.append(liste);
  }
  karte.append(knoepfe);
  return karte;
}

function renderWuensche(): void {
  const offene = alleWuensche.filter((w) => w.status === "offen");
  const erledigte = alleWuensche.filter((w) => w.status === "erledigt");
  wuenscheKacheln.replaceChildren(
    wunschKachel("offen", offene.length, "Offen", offene.length ? "warten auf die Betreuung" : "nichts offen"),
    wunschKachel("erledigt", erledigte.length, "Erledigt", erledigte.length ? "umgesetzt oder beantwortet" : "–"),
    wunschKachel("alle", alleWuensche.length, "Gesamt", "alle Einträge"),
  );
  const sichtbare = wuenscheFilter === "alle" ? alleWuensche : wuenscheFilter === "offen" ? offene : erledigte;
  if (sichtbare.length) wuenscheKarten.replaceChildren(...sichtbare.map(wunschKarte));
  else {
    const leer = document.createElement("li");
    leer.className = "leer";
    leer.textContent = alleWuensche.length ? "Hier ist nichts." : "Noch nichts an den Support geschickt. Oben schreiben oder den Assistenten fragen.";
    wuenscheKarten.replaceChildren(leer);
  }
}

const WUENSCHE_GESEHEN = "wuensche-gesehen";

/** Die Seite «Support». Beim ersten Besuch verschwindet die Marke „Neu“ im Verzeichnis. */
async function showWuensche(): Promise<boolean> {
  if (!(await flushCommit())) return false;
  current = null;
  gewaehlt = null;
  markCurrent();
  zeigeNur(wuenscheSeite);
  wuenscheGruppe.open = true;
  merke("wuensche");
  try {
    localStorage.setItem(WUENSCHE_GESEHEN, "1");
  } catch {
    // Dann bleibt „Neu“ eben stehen.
  }
  wuenscheNeu.hidden = true;
  await loadWuensche();
  renderWuensche();
  nachOben();
  return true;
}

/** Ein Eintrag aus dem Verzeichnis: in der Übersicht zeigen, wie bei einer Anfrage. */
async function openWunsch(id: string): Promise<void> {
  if (!(await showWuensche())) return;
  const wunsch = alleWuensche.find((w) => w.id === id);
  if (!wunsch) return;
  gewaehlt = id;
  // Der Filter muss den gewählten Eintrag zeigen.
  if (wuenscheFilter !== "alle" && wuenscheFilter !== wunsch.status) wuenscheFilter = wunsch.status;
  renderWuensche();
  renderWuenscheListe();
  document.getElementById(`wunsch-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

/** Die Übersicht: Zahlen oben, darunter die Anfragen des gewählten Filters. */
async function showAnfragen(): Promise<boolean> {
  if (!(await flushCommit())) return false;
  current = null;
  gewaehlt = null;
  markCurrent();
  zeigeNur(anfragenSeite);
  anfragenGruppe.open = true;
  merke("anfragen");
  await loadAnfragen(true);
  nachOben();
  return true;
}

/** Eine Anfrage aus dem Verzeichnis: in der Übersicht zeigen und als gelesen merken. */
async function openAnfrage(id: string): Promise<void> {
  if (!(await showAnfragen())) return;
  const anfrage = alleAnfragen.find((a) => a.id === id);
  if (!anfrage) return;
  gewaehlt = id;
  // Der Filter muss die gewählte Anfrage zeigen.
  if (!offen(anfrage) && anfragenFilter === "offen") anfragenFilter = "alle";
  if (offen(anfrage) && anfragenFilter === "erledigt") anfragenFilter = "offen";
  if (anfrage.status === "neu") await setStatus(id, "gelesen");
  else renderAnfragen();
  document.getElementById(`anfrage-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

form.addEventListener("submit", (event) => event.preventDefault());
titelInput.addEventListener("keydown", (event) => {
  // Ein Titel hat keine Zeilenumbrüche. Enter springt in den Text.
  if (event.key !== "Enter") return;
  event.preventDefault();
  editorHost.querySelector<HTMLElement>("[contenteditable]")?.focus();
});
titelInput.addEventListener("input", () => {
  titelInput.value = titelInput.value.replace(/\s*\n\s*/g, " ");
  fitTitel();
  updateListLabel();
  zeigeMenueName();
  scheduleSave();
});
datumInput.addEventListener("input", () => scheduleSave());
adresseInput.addEventListener("input", adresseVorschau);
adresseInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    adresseInput.blur();
  } else if (event.key === "Escape") {
    event.preventDefault();
    zeigeAdresse();
    adresseInput.blur();
  }
});
// Erst beim Verlassen des Feldes, nicht bei jedem Buchstaben: jede Änderung legt eine Weiterleitung an.
adresseInput.addEventListener("change", () => void aendereAdresse());
nummerInput.addEventListener("input", () => {
  if (!current || !isBrief(current)) return;
  kennung.textContent = `Newsletter ${gewaehlteNummer() ?? ""}`;
  pruefeNummer();
  scheduleSave();
});
window.addEventListener("pagehide", () => {
  void fetch("/api/commit", { method: "POST", keepalive: true }).catch(() => null);
});
window.addEventListener("beforeunload", (event) => {
  if (saveTimer != null || liveUngespeichert || (!allgemeinSeite.hidden && allgemeinVerwaltung.ungespeichert())) event.preventDefault();
});
// Ist die Verbindung zurück, gleich speichern statt auf den nächsten Versuch zu warten.
window.addEventListener("online", () => {
  if (saveTimer != null) void saveNow();
});
// Ctrl+S oder Cmd+S speichert sofort, statt dass der Browser die Seite herunterlädt.
document.addEventListener("keydown", (event) => {
  if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "s") return;
  event.preventDefault();
  if (current && !form.hidden) void saveNow();
});
/**
 * Das Verzeichnis als Schublade links: auf dem Telefon immer, auf einem kleinen Laptop,
 * solange der Assistent offen ist (sonst hätte der Text kaum Platz). Hier wird entschieden,
 * das CSS zeichnet nur `body.schublade`.
 */
const verzeichnis = root.querySelector<HTMLElement>("#verzeichnis")!;
const verzeichnisAuf = root.querySelector<HTMLButtonElement>("#verzeichnis-auf")!;
const telefon = window.matchMedia("(max-width: 800px)");
const laptop = window.matchMedia("(min-width: 1101px) and (max-width: 1439px)");
function pruefeSchublade(): void {
  const schublade = telefon.matches || (laptop.matches && document.body.classList.contains("mit-assistent"));
  document.body.classList.toggle("schublade", schublade);
  if (!schublade) zeigeVerzeichnis(false);
}
telefon.addEventListener("change", pruefeSchublade);
laptop.addEventListener("change", pruefeSchublade);
// Der Assistent setzt «mit-assistent» selbst, beim Öffnen und Schliessen.
new MutationObserver(pruefeSchublade).observe(document.body, { attributes: true, attributeFilter: ["class"] });
pruefeSchublade();

function zeigeVerzeichnis(offen: boolean): void {
  document.body.classList.toggle("verzeichnis-offen", offen);
  verzeichnisAuf.setAttribute("aria-expanded", String(offen));
}
verzeichnisAuf.addEventListener("click", (event) => {
  event.stopPropagation();
  const offen = !document.body.classList.contains("verzeichnis-offen");
  zeigeVerzeichnis(offen);
  if (offen) verzeichnis.querySelector<HTMLElement>("button, summary")?.focus();
});
// Ein Klick daneben schliesst sie, ebenso jede Wahl darin, die eine andere Ansicht öffnet.
document.addEventListener("click", (event) => {
  if (!document.body.classList.contains("verzeichnis-offen")) return;
  const ziel = event.target as Element;
  // composedPath: Die Pfeile in «Menü ordnen» zeichnen ihre Zeile neu, das Ziel hängt dann nicht mehr im Verzeichnis.
  if (!event.composedPath().includes(verzeichnis) || ziel.closest("nav button[data-rel], nav button[data-anfrage], nav button[data-wunsch], button.mehr:not(#mehr, #menue-ordnen), :not(summary) > button.gruppe-titel, #heim, #zur-website")) {
    zeigeVerzeichnis(false);
  }
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && document.body.classList.contains("verzeichnis-offen")) {
    zeigeVerzeichnis(false);
    verzeichnisAuf.focus();
  }
});
root.querySelector("#heim")!.addEventListener("click", async () => {
  if (await flushCommit()) showStart();
});
for (const [knopf, art] of [["#start-wunsch", "funktion"], ["#start-fehler", "fehler"]] as const) {
  root.querySelector(knopf)!.addEventListener("click", async () => {
    await showWuensche();
    wunschArt.value = art;
    passeWunschFormAn();
    wunschText.focus();
  });
}
startSupportOffen.addEventListener("click", () => void showWuensche());
wunschArt.addEventListener("change", passeWunschFormAn);
try {
  wuenscheNeu.hidden = localStorage.getItem(WUENSCHE_GESEHEN) === "1";
} catch {
  wuenscheNeu.hidden = true;
}
root.querySelector("#wunsch-foto")!.addEventListener("click", () => void nimmFotoAuf());
root.querySelector("#wunsch-datei")!.addEventListener("click", () => wunschDateiInput.click());
for (const input of [wunschFotoInput, wunschDateiInput]) {
  input.addEventListener("change", () => {
    haengeAn(input.files ?? []);
    // Sonst meldet der Browser dieselbe Datei kein zweites Mal.
    input.value = "";
  });
}
// Ein Bildschirmfoto aus der Zwischenablage (Cmd+V) oder aus dem Finder hineingezogen.
wunschForm.addEventListener("paste", (event) => {
  const dateien = [...(event.clipboardData?.files ?? [])];
  if (!dateien.length) return;
  event.preventDefault();
  haengeAn(dateien);
});
wunschForm.addEventListener("dragover", (event) => {
  if (!event.dataTransfer?.types.includes("Files")) return;
  event.preventDefault();
  wunschForm.classList.add("zieht");
});
wunschForm.addEventListener("dragleave", (event) => {
  if (!wunschForm.contains(event.relatedTarget as Node | null)) wunschForm.classList.remove("zieht");
});
wunschForm.addEventListener("drop", (event) => {
  wunschForm.classList.remove("zieht");
  const dateien = [...(event.dataTransfer?.files ?? [])];
  if (!dateien.length) return;
  event.preventDefault();
  haengeAn(dateien);
});
root.querySelector("#kamera-zu")!.addEventListener("click", schliesseKamera);
// Esc schliesst das Fenster selbst. Die Kamera muss trotzdem ausgehen.
kamera.addEventListener("close", schliesseKamera);
root.querySelector("#kamera-los")!.addEventListener("click", () => {
  const breite = kameraBild.videoWidth;
  const hoehe = kameraBild.videoHeight;
  if (!breite || !hoehe) return;
  const flaeche = document.createElement("canvas");
  flaeche.width = breite;
  flaeche.height = hoehe;
  flaeche.getContext("2d")!.drawImage(kameraBild, 0, 0, breite, hoehe);
  flaeche.toBlob(
    (blob) => {
      schliesseKamera();
      if (!blob) return;
      const zeit = new Date().toISOString().slice(0, 19).replaceAll(":", "-").replace("T", "-");
      haengeAn([new File([blob], `foto-${zeit}.jpg`, { type: "image/jpeg" })]);
    },
    "image/jpeg",
    0.9,
  );
});
wunschForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = wunschText.value.trim();
  if (!text) {
    if (wartendeAnhaenge.length) wunschMeldung.textContent = "Bitte in ein, zwei Sätzen dazuschreiben, worum es geht.";
    wunschText.focus();
    return;
  }
  const knopf = wunschForm.querySelector<HTMLButtonElement>('button[type="submit"]')!;
  knopf.disabled = true;
  let anhaenge: Anhang[];
  try {
    anhaenge = await ladeAnhaengeHoch();
  } catch (error) {
    knopf.disabled = false;
    wunschMeldung.textContent = error instanceof Error ? error.message : "Hochladen ging nicht.";
    return;
  }
  wunschMeldung.textContent = "Wird gesendet …";
  const response = await fetch("/api/wuensche", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ art: wunschArt.value, text, seite: "", anhaenge, ...(wunschArt.value === "fehler" ? { geraet: geraet() } : {}) }),
  }).catch(() => null);
  knopf.disabled = false;
  if (!response?.ok) {
    wunschMeldung.textContent = response ? await errorText(response, "Senden ging nicht.") : "Keine Verbindung zum Server.";
    return;
  }
  const wunsch = (await response.json()) as Wunsch;
  wunschText.value = "";
  leereAnhaenge();
  wunschMeldung.textContent =
    wunsch.telegram === "gesendet"
      ? "Gesendet ✓"
      : wunsch.telegram === "aus"
        ? "Gespeichert. Telegram ist hier nicht eingerichtet."
        : "Gespeichert. Telegram hat nicht geklappt, unten nochmals senden.";
  wuenscheFilter = "offen";
  await loadWuensche();
  renderWuensche();
});
root.querySelector("#briefe-neu")!.addEventListener("click", () => void newBrief());
briefeSuche.addEventListener("input", () => renderBriefUebersicht());
// Die ganze Zeile einer Gruppe, Pfeil wie Name: aufklappen und die Übersicht zeigen.
// Steht die Übersicht schon da, klappt derselbe Klick die Gruppe wieder zu.
for (const [gruppe, seite, zeige] of [
  [briefeGruppe, briefeSeite, showBriefe],
  [anfragenGruppe, anfragenSeite, showAnfragen],
  [wuenscheGruppe, wuenscheSeite, showWuensche],
  [papierkorbGruppe, papierkorbSeite, showPapierkorb],
] as const) {
  gruppe.querySelector(":scope > summary")!.addEventListener("click", (event) => {
    event.preventDefault();
    if (gruppe.open && !seite.hidden) {
      gruppe.open = false;
      return;
    }
    void zeige();
    // Auf dem Telefon macht die Schublade der Übersicht Platz. Nur Zuklappen lässt sie offen.
    zeigeVerzeichnis(false);
  });
}
// Neue Anfragen erscheinen ohne Neuladen.
window.setInterval(() => void loadAnfragen(), 60_000);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
  void loadAnfragen();
  // Wer die Redaktion morgens offen liess, wird abends nicht mehr mit «Guten Morgen» begrüsst.
  root.querySelector("#gruss")!.textContent = gruss();
});
mehr.addEventListener("click", () => {
  sichtbar += 10;
  renderBriefe();
});

menueInput.addEventListener("change", () => {
  zeigeMenueName();
  scheduleSave();
});
menueNameInput.addEventListener("input", () => {
  zeigeMenueName();
  scheduleSave();
});
menueOrdnen.addEventListener("click", menueOrdnenBeginnen);
root.querySelector("#ordnen-speichern")!.addEventListener("click", () => void menueOrdnenSpeichern());
root.querySelector("#ordnen-abbrechen")!.addEventListener("click", menueOrdnenBeenden);
root.querySelector("#seite-neu")!.addEventListener("click", () => void neueSeiteAnlegen());
// Ein vorhandenes Bild in den Newsletter setzen, an der Stelle, wo der Cursor steht.
root.querySelector("#bild-aus-medien")!.addEventListener("click", async () => {
  const name = await waehleMedium();
  if (!name || !crepe) return;
  // Ist Text markiert, kommt das Bild dahinter. Sonst ersetzte es die Markierung.
  crepe.editor.action((ctx: { get(key: unknown): { state: EditorState; dispatch(tr: unknown): void } }) => {
    const view = ctx.get(editorViewCtx);
    const { doc, selection, tr } = view.state;
    if (!selection.empty) view.dispatch(tr.setSelection(TextSelection.create(doc, selection.to)));
  });
  crepe.editor.action(insert(`\n\n![1](/media/${name})\n\n`));
});

const allgemeinVerwaltung = allgemeinAnsicht(allgemeinSeite);
const ladeMedien = medienAnsicht(medienSeite, (rel) => void openPage(rel), uploadImage);
const ladeVerlauf = verlaufAnsicht(verlaufSeite, {
  frage: ask,
  oeffne: (rel) => void openPage(rel),
  bereit: async () => flushCommit(),
});

async function showAllgemein(): Promise<void> {
  // Schon offen: nichts neu laden, sonst wären Änderungen weg.
  if (!allgemeinSeite.hidden) return;
  if (!(await flushCommit())) return;
  current = null;
  gewaehlt = null;
  markCurrent();
  zeigeNur(allgemeinSeite);
  merke("allgemein");
  await allgemeinVerwaltung.lade().catch((error: Error) => toast(error.message, undefined, true));
  nachOben();
}

async function showMedien(filter?: MedienFilter): Promise<void> {
  if (!(await flushCommit())) return;
  current = null;
  gewaehlt = null;
  markCurrent();
  zeigeNur(medienSeite);
  merke("medien");
  await ladeMedien(filter).catch((error: Error) => toast(error.message, undefined, true));
  nachOben();
}

async function showVerlauf(): Promise<void> {
  if (!(await flushCommit())) return;
  current = null;
  gewaehlt = null;
  markCurrent();
  zeigeNur(verlaufSeite);
  merke("verlauf");
  await ladeVerlauf().catch((error: Error) => toast(error.message, undefined, true));
  nachOben();
}

async function showCheck(): Promise<void> {
  if (!(await flushCommit())) return;
  current = null;
  gewaehlt = null;
  markCurrent();
  zeigeNur(checkSeite);
  merke("check");
  if (!checkGeladen) checkStand.textContent = "Wird geprüft …";
  await loadCheck();
  nachOben();
}

// Allgemein, Website-Check, Medien und Verlauf klappen nichts auf: Sie öffnen nur ihre Ansicht.
checkLink.addEventListener("click", () => {
  void showCheck();
  zeigeVerzeichnis(false);
});
allgemeinLink.addEventListener("click", () => {
  void showAllgemein();
  zeigeVerzeichnis(false);
});
medienLink.addEventListener("click", () => {
  void showMedien();
  zeigeVerzeichnis(false);
});
verlaufLink.addEventListener("click", () => {
  void showVerlauf();
  zeigeVerzeichnis(false);
});

/** Unsichtbares Dateifeld für «Word importieren». */
const wordInput = document.createElement("input");
wordInput.type = "file";
wordInput.accept = ".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document";
wordInput.hidden = true;
root.append(wordInput);
wordInput.addEventListener("change", () => {
  const file = wordInput.files?.[0];
  wordInput.value = "";
  if (file) void importiereWord(file);
});

/** Eine Word-Datei ersetzt den Text des offenen Entwurfs. Bilder kommen mit. */
async function importiereWord(file: File): Promise<void> {
  if (!current || !crepe) return;
  if (!current.entwurf) {
    await ask({ titel: "Nur in einen Entwurf", text: "Word-Dateien lassen sich nur in einen Entwurf importieren. Für einen neuen Newsletter zuerst «Neuen Newsletter schreiben».", ja: "OK" });
    return;
  }
  if (!/\.docx$/i.test(file.name)) {
    await ask({ titel: "Keine .docx-Datei", text: `«${file.name}» ist keine Word-Datei im Format .docx. Bitte in Word unter «Speichern unter» als «Word-Dokument (.docx)» speichern.`, ja: "OK" });
    return;
  }
  if (forFile(crepe.getMarkdown()).trim()) {
    const ja = await ask({
      titel: "Text ersetzen?",
      text: `Der Entwurf hat schon Text. «${file.name}» ersetzt ihn. Zurück geht es mit Ctrl+Z oder unter «Frühere Fassungen».`,
      ja: "Ersetzen",
      nein: "Abbrechen",
    });
    if (!ja) return;
  }
  const rel = current.rel;
  setSaved("Word-Datei wird gelesen …", "busy");
  const response = await fetch(`/api/import?rel=${encodeURIComponent(rel)}`, { method: "POST", body: file }).catch(() => null);
  if (!response?.ok) {
    setSaved(response ? await errorText(response, "Die Word-Datei liess sich nicht lesen.") : "Keine Verbindung zum Server.", "fehler");
    return;
  }
  const json = (await response.json()) as { markdown: string; thema: string; bilder: string[]; ausgelassen: number };
  if (current?.rel !== rel || !crepe) return;
  // Als normale Änderung: Ctrl+Z holt den alten Text zurück.
  crepe.editor.action(replaceAll(forEditor(json.markdown)));
  if (json.thema && !titelInput.value.trim()) setzeThema(json.thema);
  if (!(await saveNow())) return;
  const bilder = json.bilder.length === 1 ? "1 Bild" : `${json.bilder.length} Bilder`;
  const fehlend = json.ausgelassen
    ? ` · ${json.ausgelassen} ${json.ausgelassen === 1 ? "Bild ist" : "Bilder sind"} in einem Format, das die Website nicht zeigt. Bitte selbst einsetzen.`
    : "";
  setSaved(`Word importiert ✓ · ${bilder}${fehlend}`, fehlend ? "fehler" : "ok");
  haltMeldungBis = Date.now() + (fehlend ? 15_000 : 6000);
}

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/**
 * Beim Ziehen kennt der Browser nur die Art der Datei, nicht den Namen. Ohne Angabe könnte es Word sein.
 * Der Zähler, weil jedes Kind des Editors beim Darüberziehen selbst «enter» und «leave» meldet.
 */
let ziehen = 0;
function wordImZug(event: DragEvent): boolean {
  return [...(event.dataTransfer?.items ?? [])].some((item) => item.kind === "file" && (item.type === DOCX || item.type === ""));
}
function zielAus(): void {
  ziehen = 0;
  delete editorHost.dataset.ziel;
}
editorHost.addEventListener("dragenter", (event) => {
  if (!wordImZug(event)) return;
  ziehen++;
  editorHost.dataset.ziel = current?.entwurf ? "word" : "nein";
});
editorHost.addEventListener("dragleave", () => {
  if (ziehen > 0 && --ziehen === 0) zielAus();
});
window.addEventListener("dragend", zielAus);
window.addEventListener("drop", zielAus);

// Eine .docx auf den Text ziehen importiert sie. Bilder und alles andere behandelt der Editor wie bisher.
editorHost.addEventListener(
  "drop",
  (event) => {
    zielAus();
    const file = [...(event.dataTransfer?.files ?? [])].find((f) => /\.docx$/i.test(f.name));
    if (!file) return;
    event.preventDefault();
    event.stopPropagation();
    void importiereWord(file);
  },
  true,
);

function setzeThema(text: string): void {
  titelInput.value = isBrief(current) ? thema(text) : text.trim();
  fitTitel();
  updateListLabel();
  scheduleSave();
}

/** Was der Assistent sieht und wie er Text einsetzt. */
function lage(): Lage {
  if (!current || !editorBereit() || form.hidden) {
    return {
      ansicht: !anfragenSeite.hidden ? "anfragen"
        : !briefeSeite.hidden ? "briefe"
        : !wuenscheSeite.hidden ? "wuensche"
        : !allgemeinSeite.hidden ? "allgemein"
        : !medienSeite.hidden ? "medien"
        : !verlaufSeite.hidden ? "verlauf"
        : !checkSeite.hidden ? "check"
        : !papierkorbSeite.hidden ? "papierkorb"
        : "start",
    };
  }
  const doc = collect();
  return { ansicht: "blatt", rel: doc.rel, art: doc.art, titel: doc.titel, datum: doc.datum, entwurf: doc.entwurf, body: aktuellerText(), vorlage: doc.vorlage ?? undefined };
}

const info = (await fetch("/api/info").then((response) => response.json()).catch(() => ({}))) as {
  publicUrl?: string;
  assistent?: boolean;
};
publicOrigin = info.publicUrl ?? "";
root.querySelector<HTMLAnchorElement>("#zur-website")!.href = `${publicOrigin}/`;
void mountAssistent(
  {
    lage,
    offen: () => (current && editorBereit() && !form.hidden ? { rel: current.rel, titel: collect().titel } : null),
    markdown: () => (editorBereit() && current ? aktuellerText() : null),
    // Als normale Änderung im Editor: Ctrl+Z macht sie rückgängig, gespeichert wird wie beim Tippen.
    // Felder nehmen nur, was in ihren Aufbau passt.
    setzeText: (markdown) => {
      if (felder) return felder.setze(markdown);
      crepe?.editor.action(replaceAll(forEditor(markdown)));
      return true;
    },
    setzeThema,
    neuerNewsletter: async (text) => {
      // Ein leerer Entwurf, der schon offen ist, wird genommen statt einen zweiten anzulegen.
      const leer = current && isBrief(current) && current.entwurf && crepe && !form.hidden && !collect().body.trim();
      if (!leer) {
        await newBrief();
        if (!current || !isBrief(current) || !current.entwurf) return null;
      }
      setzeThema(text);
      return current!.rel;
    },
    // Während des Schreibens den Zustand ersetzen, nicht ändern: keine hundert Rückgängig-Schritte.
    schreibeLive: (markdown) => {
      if (felder) felder.setze(markdown);
      else crepe?.editor.action(replaceAll(forEditor(markdown), true));
    },
    speichereEntwurf: async (rel, markdown) => {
      if (current?.rel === rel && crepe && !form.hidden) {
        crepe.editor.action(replaceAll(forEditor(markdown), true));
        scheduleSave();
        return true;
      }
      // Patrick ist woanders. Den Entwurf so speichern, wie er auf dem Server steht, nur mit dem neuen Text.
      const doc = (await fetch(`/api/pages?rel=${encodeURIComponent(rel)}`)
        .then((res) => (res.ok ? res.json() : null))
        .catch(() => null)) as Doc | null;
      if (!doc?.entwurf) return false;
      const response = await fetch("/api/pages", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...doc, body: markdown }),
      }).catch(() => null);
      if (!response?.ok) return false;
      await loadList();
      return true;
    },
    zeigeWuensche: () => void showWuensche(),
    frage: ask,
    oeffneNewsletter: (text) => {
      const page = alleBriefe.find((item) => thema(item.titel) === text.trim());
      if (page) void openPage(page.rel);
      return page != null;
    },
    seite: findeSeite,
    adresseAus,
    aktion: fuehreAus,
    editor: editorHost,
  },
  info.assistent === true,
);
/** Die Seite zu einem Verweis des Assistenten, oder warum es keine eindeutige gibt. */
function findeSeite(verweis: string): SeiteKurz | string {
  const kurz = (page: PageSummary): SeiteKurz => ({
    rel: page.rel,
    titel: page.titel,
    brief: isBrief(page),
    nummer: page.nummer,
    entwurf: page.entwurf,
    href: page.href,
    startseite: page.rel === STARTSEITE,
  });
  const text = verweis.trim();
  if (text === "offen") {
    if (!current || form.hidden) return "Es ist gerade keine Seite offen.";
    const page = alleSeiten.find((item) => item.rel === current!.rel);
    return page ? kurz(page) : "Die offene Seite ist nicht mehr in der Liste.";
  }
  const exakt = alleSeiten.find((item) => item.rel === text);
  if (exakt) return kurz(exakt);
  const nummer = text.match(/^\/?(?:newsletter|nr\.?)[\s-]*(\d{1,4})$/i);
  if (nummer) {
    const treffer = alleBriefe.filter((item) => item.nummer === Number(nummer[1]));
    if (treffer.length === 1) return kurz(treffer[0]);
    return treffer.length
      ? `Es gibt ${treffer.length} Newsletter mit der Nummer ${nummer[1]}. Bitte selbst im Verzeichnis wählen.`
      : `Einen Newsletter ${nummer[1]} gibt es nicht.`;
  }
  const pfad = `/${text.replace(/^\s*(https?:\/\/)?[^/]*advocat-finanz\.ch/i, "").replace(/^\/+|\/+$/g, "")}`;
  const page = alleSeiten.find((item) => item.href === pfad);
  return page ? kurz(page) : `Die Seite «${text}» gibt es nicht (mehr).`;
}

/** Führt eine Aktion von einer Karte des Assistenten aus. Der Klick auf der Karte ist die Rückfrage. */
async function fuehreAus(art: AktionArt, rel: string, adresse = ""): Promise<string | null> {
  const nicht = "Hat nicht geklappt. Die Meldung steht in der Redaktion.";
  switch (art) {
    case "oeffnen":
      await openPage(rel);
      return current?.rel === rel ? null : "Die Seite liess sich nicht öffnen.";
    case "veroeffentlichen":
      return (await publish(rel, true)) ? null : nicht;
    case "zurueckziehen":
      return (await unpublish(rel, true)) ? null : nicht;
    case "loeschen":
      return (await deletePage(rel)) ? null : nicht;
    case "kopie":
      return (await copyPage(rel)) ? null : nicht;
    case "adresse": {
      const slug = adresseAus(adresse);
      return slug ? adresseSetzen(rel, slug) : "Keine gültige Adresse.";
    }
  }
}

/** Zeigt die Ansicht zur Adresse: beim Laden und bei «Zurück» oder «Vorwärts» im Browser. */
async function folge(): Promise<void> {
  const wanted = decodeURIComponent(location.hash.slice(1));
  if (wanted === "anfragen") await showAnfragen();
  else if (wanted === "newsletter") await showBriefe();
  else if (wanted === "wuensche") await showWuensche();
  else if (wanted === "allgemein") await showAllgemein();
  else if (wanted === "medien") await showMedien();
  else if (wanted === "verlauf") await showVerlauf();
  else if (wanted === "check") await showCheck();
  else if (wanted === "papierkorb") await showPapierkorb();
  else if (wanted) await openPage(wanted);
  else if (await flushCommit()) showStart();
}
window.addEventListener("popstate", () => void folge());

await loadList();
await loadAnfragen();
await loadWuensche();
startBereit = true;
renderNaechstes();
void loadCheck();
await folge();
void pruefeSetzen();
