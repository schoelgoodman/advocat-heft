/**
 * Der Assistent: eine Spalte rechts, auf jeder Ansicht der Redaktion.
 * Er schlägt vor. Einsetzen, Rückgängig und Senden macht Patrick per Knopf.
 * Einzige Ausnahme: Bittet Patrick um einen neuen Newsletter, legt die Redaktion
 * selbst einen Entwurf an und schreibt den Text live hinein. Veröffentlichen bleibt bei Patrick.
 */

export interface Lage {
  ansicht: "start" | "anfragen" | "briefe" | "wuensche" | "blatt";
  rel?: string;
  art?: string;
  titel?: string;
  datum?: string;
  entwurf?: boolean;
  body?: string;
  auswahl?: string;
}

/** Was der Assistent von der Redaktion braucht. */
export interface Anschluss {
  lage(): Lage;
  /** Die offene Seite, oder null. */
  offen(): { rel: string; titel: string } | null;
  /** Der Text der offenen Seite als Markdown, wie er in der Datei steht. */
  markdown(): string | null;
  /** Ersetzt den Text der offenen Seite. Rückgängig mit Ctrl+Z, gespeichert wie getippt. */
  setzeText(markdown: string): void;
  setzeThema(thema: string): void;
  /**
   * Legt einen neuen Newsletter-Entwurf an und öffnet ihn. Ist schon ein leerer Entwurf offen,
   * nimmt sie den. Gibt den Pfad zurück, oder null, wenn es nicht geklappt hat.
   */
  neuerNewsletter(thema: string): Promise<string | null>;
  /** Setzt den Text während des Schreibens, ohne Speichern und ohne Rückgängig-Schritte. */
  schreibeLive(markdown: string): void;
  /** Speichert die offene Seite wie nach dem Tippen. */
  speichere(): void;
  /** Zeigt die Seite «Wünsche». */
  zeigeWuensche(): void;
  /** Öffnet den Newsletter mit diesem Thema, falls es ihn gibt. */
  oeffneNewsletter(thema: string): boolean;
  /** Das Element mit dem Text, um eine Markierung darin zu erkennen. */
  editor: HTMLElement;
}

interface Nachricht {
  rolle: "patrick" | "assistent";
  text: string;
  zeit: string;
  rel?: string;
}

type Teil =
  | { art: "text"; text: string }
  | { art: "ersetzen"; alt: string; neu: string }
  | { art: "text-ganz" | "anfuegen" | "titel"; neu: string }
  | { art: "wunsch"; wunschArt: "design" | "funktion"; text: string }
  | { art: "newsletter"; thema: string; neu: string; fertig: boolean }
  | { art: "wartet" };

const BLOCK = /<vorschlag art="(ersetzen|text|anfuegen|titel)">([\s\S]*?)<\/vorschlag>|<(?:wunsch art="(design|funktion)"|designwunsch)>([\s\S]*?)<\/(?:wunsch|designwunsch)>|<neuer-newsletter thema="([^"]*)">([\s\S]*?)<\/neuer-newsletter>/g;

/** Ein neuer Newsletter, auch halb geschrieben. Das Thema muss schon ganz dastehen. */
const NEUER_NEWSLETTER = /<neuer-newsletter thema="([^"]*)">([\s\S]*?)(<\/neuer-newsletter>|$)/;

/** Der Text eines halb geschriebenen Newsletters, ohne angefangenes Schluss-Tag. */
function newsletterText(antwort: string): { thema: string; text: string; fertig: boolean } | null {
  const match = antwort.match(NEUER_NEWSLETTER);
  if (!match) return null;
  const fertig = match[3] !== "";
  const text = fertig ? match[2] : match[2].replace(/<\/?[a-z-]*$/, "");
  return { thema: match[1].trim(), text: ohneRand(text), fertig };
}

function ohneRand(value: string): string {
  return value.replace(/^\s*\n/, "").replace(/\n\s*$/, "").trim();
}

/** Zerlegt eine Antwort in Gespräch und Vorschläge. Ein halb geschriebener Vorschlag wird zu „wartet“. */
function zerlege(antwort: string, fertig: boolean): Teil[] {
  const teile: Teil[] = [];
  let rest = antwort;
  if (!fertig) {
    const offen = Math.max(rest.lastIndexOf("<vorschlag"), rest.lastIndexOf("<wunsch"), rest.lastIndexOf("<designwunsch"), rest.lastIndexOf("<neuer-newsletter"));
    const zu = Math.max(rest.lastIndexOf("</vorschlag>"), rest.lastIndexOf("</wunsch>"), rest.lastIndexOf("</designwunsch>"), rest.lastIndexOf("</neuer-newsletter>"));
    let schnitt = offen > zu ? offen : -1;
    // Ein angefangenes Tag am Ende („<vors“) nicht als Text zeigen.
    const halb = rest.match(/<\/?[a-z]*$/);
    if (schnitt < 0 && halb?.index != null) schnitt = halb.index;
    if (schnitt >= 0) rest = rest.slice(0, schnitt);
    if (offen > zu) {
      const vorher = zerlege(rest, true);
      // Ein Newsletter im Entstehen zeigt sich als Karte, die mitwächst.
      const neu = newsletterText(antwort.slice(offen));
      if (neu) return [...vorher, { art: "newsletter", thema: neu.thema, neu: neu.text, fertig: false }];
      return [...vorher, { art: "wartet" }];
    }
  }
  let last = 0;
  for (const match of rest.matchAll(BLOCK)) {
    const davor = rest.slice(last, match.index);
    if (davor.trim()) teile.push({ art: "text", text: davor.trim() });
    last = match.index + match[0].length;
    if (match[4] != null) {
      // Ältere Antworten im Verlauf kennen nur <designwunsch>.
      teile.push({ art: "wunsch", wunschArt: match[3] === "funktion" ? "funktion" : "design", text: ohneRand(match[4]) });
      continue;
    }
    if (match[5] != null) {
      teile.push({ art: "newsletter", thema: match[5].trim(), neu: ohneRand(match[6] ?? ""), fertig: true });
      continue;
    }
    const art = match[1];
    const inhalt = match[2] ?? "";
    if (art === "ersetzen") {
      const paar = inhalt.match(/<alt>([\s\S]*?)<\/alt>\s*<neu>([\s\S]*?)<\/neu>/);
      if (paar) teile.push({ art: "ersetzen", alt: ohneRand(paar[1]), neu: ohneRand(paar[2]) });
      continue;
    }
    teile.push({ art: art === "text" ? "text-ganz" : (art as "anfuegen" | "titel"), neu: ohneRand(inhalt) });
  }
  const danach = rest.slice(last);
  if (danach.trim()) teile.push({ art: "text", text: danach.trim() });
  return teile;
}

function esc(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function inline(value: string): string {
  return esc(value)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\s][^*]*?)\*/g, "$1<em>$2</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
}

/** Genug Markdown für Antworten: Absätze, Listen, Zwischentitel, Zitate, fett, kursiv, Links. Zeile für Zeile, damit eine Liste auch direkt unter einem Satz erkannt wird. */
function markdownHtml(value: string): string {
  const html: string[] = [];
  let art: "p" | "ul" | "ol" | "blockquote" | null = null;
  let zeilen: string[] = [];
  const schliesse = () => {
    if (!art) return;
    if (art === "ul" || art === "ol") html.push(`<${art}>${zeilen.map((z) => `<li>${inline(z)}</li>`).join("")}</${art}>`);
    else html.push(`<${art}>${zeilen.map(inline).join("<br>")}</${art}>`);
    art = null;
    zeilen = [];
  };
  for (const zeile of value.split("\n")) {
    const titel = zeile.match(/^#{1,6}\s+(.+)$/);
    const punkt = zeile.match(/^\s*[-*•]\s+(.+)$/);
    const nummer = zeile.match(/^\s*\d+[.)]\s+(.+)$/);
    const zitat = zeile.match(/^>\s?(.*)$/);
    const neu = !zeile.trim() ? null : titel ? "h" : punkt ? "ul" : nummer ? "ol" : zitat ? "blockquote" : "p";
    if (neu === "h" || neu !== art) schliesse();
    if (neu === null) continue;
    if (neu === "h") {
      html.push(`<p class="zwischentitel">${inline(titel![1])}</p>`);
      continue;
    }
    art = neu;
    zeilen.push((punkt ?? nummer ?? zitat)?.[1] ?? zeile);
  }
  schliesse();
  return html.join("");
}

function knopf(label: string, className: string, onClick: () => void): HTMLButtonElement {
  const element = document.createElement("button");
  element.type = "button";
  element.className = className;
  element.textContent = label;
  element.addEventListener("click", onClick);
  return element;
}

const BEISPIELE = [
  "Mir fehlt etwas in der Redaktion.",
  "Wie schreibe ich einen neuen Newsletter?",
  "Schlag mir drei Themen für den nächsten Newsletter vor.",
  "Mach die markierte Stelle kürzer und klarer.",
  "Prüf den Text auf Rechtschreibung.",
];

const svg = (inhalt: string) =>
  `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inhalt}</svg>`;

const ICON = {
  funke: svg('<path d="M12 3.5l1.9 5.1 5.1 1.9-5.1 1.9L12 17.5l-1.9-5.1L5 10.5l5.1-1.9z"/><path d="M18.5 16.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z"/>'),
  neu: svg('<path d="M12 20h8"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/>'),
  zu: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  senden: svg('<path d="M12 19V5M5.5 11.5L12 5l6.5 6.5"/>'),
  stopp: '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><rect x="5" y="5" width="14" height="14" rx="2.5" fill="currentColor"/></svg>',
  schnell: svg('<path d="M13 3L5 13.5h6L10 21l8-10.5h-6z"/>'),
  gruendlich: svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>'),
  markierung: svg('<path d="M4 7h16M4 12h10M4 17h7"/>'),
};

const DENKEN_KEY = "assistent-denken";

type Denken = "low" | "high";

function gemerktesDenken(): Denken {
  try {
    return localStorage.getItem(DENKEN_KEY) === "high" ? "high" : "low";
  } catch {
    return "low";
  }
}

export async function mountAssistent(anschluss: Anschluss, bereit: boolean): Promise<void> {
  // Kein <aside>: dessen Regeln gehören dem Verzeichnis links.
  const spalte = document.createElement("section");
  spalte.className = "assistent";
  spalte.setAttribute("aria-label", "Assistent");
  spalte.innerHTML = `
    <header>
      <span class="zeichen" aria-hidden="true">${ICON.funke}</span>
      <div class="name">
        <h2>Assistent</h2>
        <p>Hilft beim Schreiben und mit der Redaktion</p>
      </div>
      <button type="button" class="symbol" data-neu title="Neues Gespräch" aria-label="Neues Gespräch">${ICON.neu}</button>
      <button type="button" class="symbol" data-zu title="Assistent schliessen" aria-label="Assistent schliessen">${ICON.zu}</button>
    </header>
    <ol class="verlauf" aria-live="polite"></ol>
    <form class="eingabe">
      <p class="markiert" hidden>${ICON.markierung}<span></span><button type="button" class="symbol klein" title="Markierung nicht mitschicken" aria-label="Markierung nicht mitschicken">${ICON.zu}</button></p>
      <div class="feld">
        <textarea rows="1" placeholder="Nachricht an den Assistenten …"></textarea>
        <button type="submit" class="senden" title="Senden" aria-label="Senden">${ICON.senden}</button>
      </div>
      <div class="unten">
        <div class="denken" role="radiogroup" aria-label="Wie gründlich der Assistent nachdenkt">
          <button type="button" role="radio" data-denken="low" title="Denkt kurz nach. Die Antwort beginnt nach wenigen Sekunden.">${ICON.schnell}Schnell</button>
          <button type="button" role="radio" data-denken="high" title="Denkt gründlich nach. Besser für schwierige Texte, dauert bis zu einer Minute.">${ICON.gruendlich}Gründlich</button>
        </div>
        <p class="hinweis" title="Shift+Enter für eine neue Zeile">Enter sendet</p>
      </div>
    </form>
  `;
  const auf = document.createElement("button");
  auf.type = "button";
  auf.className = "assistent-auf";
  auf.innerHTML = `${ICON.funke}<span>Assistent</span>`;
  auf.addEventListener("click", () => zeige(true));
  document.body.append(spalte, auf);

  const verlaufListe = spalte.querySelector<HTMLOListElement>(".verlauf")!;
  const formular = spalte.querySelector<HTMLFormElement>(".eingabe")!;
  const eingabe = spalte.querySelector<HTMLTextAreaElement>("textarea")!;
  const senden = spalte.querySelector<HTMLButtonElement>('button[type="submit"]')!;
  const markiert = spalte.querySelector<HTMLElement>(".markiert")!;
  const markiertText = markiert.querySelector<HTMLElement>("span")!;

  let denken: Denken = gemerktesDenken();
  const denkKnoepfe = [...spalte.querySelectorAll<HTMLButtonElement>("[data-denken]")];
  function zeigeDenken(): void {
    for (const knopf of denkKnoepfe) knopf.setAttribute("aria-checked", String(knopf.dataset.denken === denken));
  }
  for (const knopf of denkKnoepfe) {
    knopf.addEventListener("click", () => {
      denken = knopf.dataset.denken === "high" ? "high" : "low";
      try {
        localStorage.setItem(DENKEN_KEY, denken);
      } catch {
        // Ohne Speicher gilt die Wahl bis zum Neuladen.
      }
      zeigeDenken();
    });
  }
  zeigeDenken();

  let verlauf: Nachricht[] = [];
  let laeuft: AbortController | null = null;
  let auswahl = "";
  /** Die Markierung gilt nur für die Seite, auf der sie gemacht wurde. */
  let auswahlRel = "";

  function zeige(offen: boolean): void {
    document.body.classList.toggle("mit-assistent", offen);
    spalte.hidden = !offen;
    auf.hidden = offen;
    if (offen) eingabe.focus();
  }
  spalte.querySelector("[data-zu]")!.addEventListener("click", () => zeige(false));
  // Beim Öffnen der Redaktion ist der Assistent immer da. Zugeklappt bleibt er nur bis zum Neuladen.
  zeige(true);

  // Klickt Patrick ins Eingabefeld, ist die Markierung im Text weg. Darum hier merken.
  document.addEventListener("selectionchange", () => {
    const sel = document.getSelection();
    if (!sel || sel.rangeCount === 0 || !anschluss.editor.contains(sel.anchorNode)) return;
    auswahl = sel.isCollapsed ? "" : sel.toString().trim().slice(0, 4000);
    auswahlRel = anschluss.offen()?.rel ?? "";
    zeigeAuswahl();
  });
  function aktuelleAuswahl(): string {
    return auswahl && anschluss.offen()?.rel === auswahlRel ? auswahl : "";
  }
  function zeigeAuswahl(): void {
    markiert.hidden = !aktuelleAuswahl();
    markiertText.textContent = `Markiert: «${auswahl.length > 90 ? `${auswahl.slice(0, 90)} …` : auswahl}»`;
  }
  markiert.querySelector("button")!.addEventListener("click", () => {
    auswahl = "";
    zeigeAuswahl();
  });

  function scrollAnsEnde(): void {
    verlaufListe.scrollTop = verlaufListe.scrollHeight;
  }

  function leer(): HTMLElement {
    const item = document.createElement("li");
    item.className = "willkommen";
    if (!bereit) {
      item.innerHTML = `
        <span class="zeichen gross" aria-hidden="true">${ICON.funke}</span>
        <h3>Noch nicht eingerichtet</h3>
        <p>Es fehlt der Schlüssel für xAI (<code>XAI_API_KEY</code>). Nach dem Eintragen den Server neu starten.</p>`;
      return item;
    }
    item.innerHTML = `
      <span class="zeichen gross" aria-hidden="true">${ICON.funke}</span>
      <h3>Hallo Patrick</h3>
      <p>Ich helfe dir mit der Redaktion und beim Schreiben. Ich sehe die offene Seite und die früheren Newsletter. Änderungen schlage ich vor, einsetzen tust du sie mit «Übernehmen».</p>
      <p>Fehlt dir etwas in der Redaktion oder soll die Website anders aussehen? Sag es mir, ich schreibe daraus einen Wunsch an die Betreuung.</p>`;
    const liste = document.createElement("div");
    liste.className = "beispiele";
    for (const beispiel of BEISPIELE) {
      liste.append(knopf(beispiel, "", () => {
        eingabe.value = beispiel;
        void frage();
      }));
    }
    item.append(liste);
    return item;
  }

  function karte(titel: string, inhalt: string, knoepfe: HTMLElement[]): HTMLElement {
    const element = document.createElement("div");
    element.className = "vorschlag";
    const kopf = document.createElement("p");
    kopf.className = "kopf";
    kopf.textContent = titel;
    const text = document.createElement("div");
    text.className = "inhalt";
    text.innerHTML = inhalt;
    const leiste = document.createElement("div");
    leiste.className = "aktionen";
    leiste.append(...knoepfe);
    const meldung = document.createElement("p");
    meldung.className = "meldung";
    meldung.hidden = true;
    element.append(kopf, text, leiste, meldung);
    return element;
  }

  function melde(element: HTMLElement, text: string): void {
    const meldung = element.querySelector<HTMLElement>(".meldung")!;
    meldung.textContent = text;
    meldung.hidden = !text;
  }

  async function kopiere(element: HTMLElement, text: string): Promise<void> {
    await navigator.clipboard.writeText(text).then(
      () => melde(element, "Kopiert."),
      () => melde(element, "Kopieren ging nicht. Bitte von Hand markieren."),
    );
  }

  /** Ein Textvorschlag mit Übernehmen, Rückgängig und Kopieren. */
  function vorschlagKarte(teil: Exclude<Extract<Teil, { neu: string }>, { art: "newsletter" }>, rel: string | undefined): HTMLElement {
    const titel = {
      ersetzen: "Vorschlag · Stelle ersetzen",
      "text-ganz": "Vorschlag · ganzer Text",
      anfuegen: "Vorschlag · unten anfügen",
      titel: "Vorschlag · Thema",
    }[teil.art];
    let vorher: string | null = null;
    const uebernehmen = knopf("Übernehmen", "haupt", () => {
      const offen = anschluss.offen();
      if (!offen || offen.rel !== rel) {
        melde(element, "Die Seite zu diesem Vorschlag ist nicht mehr offen.");
        return;
      }
      if (teil.art === "titel") {
        anschluss.setzeThema(teil.neu);
      } else {
        const jetzt = anschluss.markdown() ?? "";
        let neu: string;
        if (teil.art === "ersetzen") {
          if (!jetzt.includes(teil.alt)) {
            melde(element, "Die Stelle steht nicht mehr so im Text. Bitte kopieren und selbst einsetzen.");
            return;
          }
          neu = jetzt.replace(teil.alt, () => teil.neu);
        } else if (teil.art === "anfuegen") {
          neu = `${jetzt.trimEnd()}\n\n${teil.neu}`;
        } else {
          neu = teil.neu;
        }
        vorher = jetzt;
        anschluss.setzeText(neu);
      }
      uebernehmen.disabled = true;
      uebernehmen.textContent = "Übernommen ✓";
      rueckgaengig.hidden = teil.art === "titel";
      melde(element, "");
    });
    const rueckgaengig = knopf("Rückgängig", "leise", () => {
      if (vorher == null || anschluss.offen()?.rel !== rel) return;
      anschluss.setzeText(vorher);
      vorher = null;
      rueckgaengig.hidden = true;
      uebernehmen.disabled = false;
      uebernehmen.textContent = "Übernehmen";
    });
    rueckgaengig.hidden = true;
    const kopieren = knopf("Kopieren", "leise", () => void kopiere(element, teil.neu));
    const inhalt = teil.art === "titel" ? `<p class="zwischentitel">${esc(teil.neu)}</p>` : markdownHtml(teil.neu);
    const alt = teil.art === "ersetzen"
      ? `<p class="alt">Statt: «${esc(teil.alt.length > 140 ? `${teil.alt.slice(0, 140)} …` : teil.alt)}»</p>`
      : "";
    const element = karte(titel, alt + inhalt, rel ? [uebernehmen, rueckgaengig, kopieren] : [kopieren]);
    return element;
  }

  /** Wünsche, die schon gesendet sind, erkannt am Anfang des ursprünglichen Textes. */
  const gesendet = new Set<string>();

  const WUNSCH_TITEL = { design: "Wunsch · Aussehen der Website", funktion: "Wunsch · Funktion der Redaktion" };

  /** Ein Wunsch an die Betreuung. Patrick kann Art und Text ändern, bevor er ihn sendet. */
  function wunschKarte(teil: Extract<Teil, { art: "wunsch" }>): HTMLElement {
    const quelle = teil.text.slice(0, 200);
    const element = karte(WUNSCH_TITEL[teil.wunschArt], "", []);
    element.classList.add("wunsch");
    const kopf = element.querySelector<HTMLElement>(".kopf")!;
    const inhalt = element.querySelector<HTMLElement>(".inhalt")!;
    const art = document.createElement("select");
    art.setAttribute("aria-label", "Art des Wunsches");
    art.innerHTML = `<option value="funktion">Funktion der Redaktion</option><option value="design">Aussehen der Website</option>`;
    art.value = teil.wunschArt;
    art.addEventListener("change", () => {
      kopf.textContent = WUNSCH_TITEL[art.value as "design" | "funktion"];
    });
    const feld = document.createElement("textarea");
    feld.value = teil.text;
    feld.setAttribute("aria-label", "Text des Wunsches");
    const passe = () => {
      feld.style.height = "auto";
      feld.style.height = `${Math.min(feld.scrollHeight + 2, 360)}px`;
    };
    feld.addEventListener("input", passe);
    requestAnimationFrame(passe);
    inhalt.append(art, feld);

    const ansehen = knopf("Unter «Wünsche» ansehen", "leise", () => anschluss.zeigeWuensche());
    const senden = knopf("Wunsch senden", "haupt", async () => {
      if (!feld.value.trim()) return;
      senden.disabled = true;
      const response = await fetch("/api/wuensche", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ art: art.value, text: feld.value, seite: anschluss.offen()?.titel ?? "", quelle }),
      }).catch(() => null);
      if (!response?.ok) {
        senden.disabled = false;
        const json = (await response?.json().catch(() => ({}))) as { error?: string } | undefined;
        melde(element, json?.error ?? "Senden ging nicht. Verbindung prüfen.");
        return;
      }
      const wunsch = (await response.json()) as { telegram: string };
      gesendet.add(quelle);
      zeigeGesendet();
      melde(
        element,
        wunsch.telegram === "gesendet"
          ? "Per Telegram an die Betreuung der Website gegangen."
          : wunsch.telegram === "aus"
            ? "Gespeichert. Telegram ist hier nicht eingerichtet, der Wunsch steht unter «Wünsche»."
            : "Gespeichert, aber Telegram hat nicht geklappt. Unter «Wünsche» lässt er sich nochmals senden.",
      );
    });
    const zeigeGesendet = () => {
      senden.disabled = true;
      senden.textContent = "Gesendet ✓";
      art.disabled = true;
      feld.readOnly = true;
      ansehen.hidden = false;
    };
    ansehen.hidden = true;
    element.querySelector(".aktionen")!.append(senden, ansehen);
    if (gesendet.has(quelle)) zeigeGesendet();
    return element;
  }

  /** Der neue Newsletter: wächst beim Schreiben mit, danach ein Knopf zum Öffnen. */
  function newsletterKarte(teil: Extract<Teil, { art: "newsletter" }>): HTMLElement {
    const woerter = teil.neu.split(/\s+/).filter(Boolean).length;
    const oeffnen = knopf("Öffnen", "haupt", () => {
      if (!anschluss.oeffneNewsletter(teil.thema)) melde(element, "Diesen Entwurf gibt es nicht mehr.");
    });
    const kopieren = knopf("Text kopieren", "leise", () => void kopiere(element, teil.neu));
    const element = karte(
      teil.fertig ? "Neuer Newsletter · Entwurf" : "Neuer Newsletter · wird geschrieben …",
      `<p class="zwischentitel">${esc(teil.thema)}</p><p class="alt">${woerter} Wörter${teil.fertig ? " · steht als Entwurf in der Redaktion, veröffentlichen tust du ihn selbst." : ""}</p>`,
      teil.fertig ? [oeffnen, kopieren] : [],
    );
    element.classList.add("newsletter");
    if (!teil.fertig) element.classList.add("schreibt");
    return element;
  }

  function antwortInhalt(item: HTMLElement, text: string, rel: string | undefined, fertig: boolean): void {
    const teile = zerlege(text, fertig);
    item.replaceChildren(
      ...teile.map((teil) => {
        if (teil.art === "text") {
          const block = document.createElement("div");
          block.className = "text";
          block.innerHTML = markdownHtml(teil.text);
          return block;
        }
        if (teil.art === "wartet") {
          const block = document.createElement("p");
          block.className = "wartet";
          block.textContent = "Schreibt einen Vorschlag …";
          return block;
        }
        if (teil.art === "wunsch") return wunschKarte(teil);
        if (teil.art === "newsletter") return newsletterKarte(teil);
        return vorschlagKarte(teil, rel);
      }),
    );
  }

  function nachrichtItem(nachricht: Nachricht): HTMLElement {
    const item = document.createElement("li");
    // Nicht „assistent“: so heisst schon die Spalte.
    item.className = nachricht.rolle === "patrick" ? "patrick" : "antwort";
    if (nachricht.rolle === "patrick") item.textContent = nachricht.text;
    else antwortInhalt(item, nachricht.text, nachricht.rel, true);
    return item;
  }

  function zeichne(): void {
    verlaufListe.replaceChildren(...(verlauf.length ? verlauf.map(nachrichtItem) : [leer()]));
    scrollAnsEnde();
  }

  function sperre(an: boolean): void {
    senden.innerHTML = an ? ICON.stopp : ICON.senden;
    senden.title = an ? "Antwort abbrechen" : "Senden";
    senden.setAttribute("aria-label", senden.title);
    senden.classList.toggle("stopp", an);
    pruefeSenden();
  }

  /** Das Feld wächst mit dem Text bis zu einer Grenze, danach scrollt es. */
  function passeAn(): void {
    eingabe.style.height = "auto";
    eingabe.style.height = `${Math.min(eingabe.scrollHeight, 220)}px`;
  }

  function pruefeSenden(): void {
    senden.disabled = !bereit || (!laeuft && !eingabe.value.trim());
  }

  async function frage(): Promise<void> {
    const text = eingabe.value.trim();
    if (!text || laeuft || !bereit) return;
    const lage = { ...anschluss.lage(), auswahl: aktuelleAuswahl() };
    const rel = lage.rel;
    eingabe.value = "";
    passeAn();
    if (!verlauf.length) verlaufListe.replaceChildren();
    const patrick: Nachricht = { rolle: "patrick", text, zeit: new Date().toISOString(), rel };
    verlauf.push(patrick);
    verlaufListe.append(nachrichtItem(patrick));
    const item = document.createElement("li");
    item.className = "antwort denkt";
    item.innerHTML = `<span class="tippt" aria-label="Denkt nach"><i></i><i></i><i></i></span>${
      denken === "high" ? `<span class="denkt-lange">Denkt gründlich nach, das kann bis zu einer Minute dauern.</span>` : ""
    }`;
    verlaufListe.append(item);
    scrollAnsEnde();

    laeuft = new AbortController();
    sperre(true);
    let antwort = "";
    let fehler = "";
    // Ein neuer Newsletter wird einmal angelegt, dann bei jedem Stück nachgeführt.
    let entwurf: Promise<string | null> | null = null;
    let liveTimer: number | null = null;
    const schreibe = () => {
      liveTimer = null;
      const neu = newsletterText(antwort);
      if (neu && entwurf) void entwurf.then((ziel) => ziel && anschluss.offen()?.rel === ziel && anschluss.schreibeLive(neu.text));
    };
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ nachricht: text, lage, denken }),
        signal: laeuft.signal,
      });
      if (!response.ok || !response.body) {
        const json = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(json.error ?? "Der Assistent antwortet nicht.");
      }
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        let end: number;
        while ((end = buffer.indexOf("\n\n")) >= 0) {
          const zeile = buffer.slice(0, end).replace(/^data: /, "");
          buffer = buffer.slice(end + 2);
          const event = JSON.parse(zeile) as { text?: string; fertig?: boolean; fehler?: string };
          if (event.text) {
            antwort += event.text;
            item.classList.remove("denkt");
            const unten = verlaufListe.scrollHeight - verlaufListe.scrollTop - verlaufListe.clientHeight < 60;
            antwortInhalt(item, antwort, rel, false);
            if (unten) scrollAnsEnde();
            const neu = newsletterText(antwort);
            if (neu && !entwurf) entwurf = anschluss.neuerNewsletter(neu.thema);
            if (neu && liveTimer == null) liveTimer = window.setTimeout(schreibe, 250);
          }
          if (event.fehler) fehler = event.fehler;
        }
      }
    } catch (error) {
      fehler = laeuft?.signal.aborted ? "Abgebrochen." : error instanceof Error ? error.message : "Fehler";
    }
    if (liveTimer != null) window.clearTimeout(liveTimer);
    if (entwurf) {
      // Zum Schluss der ganze Text, dann wie getippt speichern.
      const ziel = await entwurf;
      const neu = newsletterText(antwort);
      if (ziel && neu && anschluss.offen()?.rel === ziel) {
        anschluss.schreibeLive(neu.text);
        anschluss.speichere();
      }
      if (!ziel && !fehler) fehler = "Der neue Newsletter liess sich nicht anlegen.";
    }
    laeuft = null;
    sperre(false);
    item.classList.remove("denkt");
    if (antwort.trim()) {
      verlauf.push({ rolle: "assistent", text: antwort, zeit: new Date().toISOString(), rel });
      antwortInhalt(item, antwort, rel, true);
    } else {
      item.replaceChildren();
    }
    if (fehler) {
      const hinweis = document.createElement("p");
      hinweis.className = "fehler";
      hinweis.textContent = fehler;
      item.append(hinweis);
    }
    scrollAnsEnde();
    eingabe.focus();
  }

  formular.addEventListener("submit", (event) => {
    event.preventDefault();
    if (laeuft) laeuft.abort();
    else void frage();
  });
  eingabe.addEventListener("input", () => {
    passeAn();
    pruefeSenden();
  });
  eingabe.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
    event.preventDefault();
    if (!laeuft) void frage();
  });
  spalte.querySelector("[data-neu]")!.addEventListener("click", async () => {
    if (laeuft) laeuft.abort();
    await fetch("/api/chat", { method: "DELETE" }).catch(() => null);
    verlauf = [];
    zeichne();
    eingabe.focus();
  });

  if (!bereit) eingabe.disabled = true;
  pruefeSenden();
  const wuensche = (await fetch("/api/wuensche", { cache: "no-store" })
    .then((res) => res.json())
    .catch(() => ({ wuensche: [] }))) as { wuensche: { quelle?: string }[] };
  for (const wunsch of wuensche.wuensche ?? []) if (wunsch.quelle) gesendet.add(wunsch.quelle);
  const json = (await fetch("/api/chat", { cache: "no-store" })
    .then((res) => res.json())
    .catch(() => ({ verlauf: [] }))) as { verlauf: Nachricht[] };
  verlauf = json.verlauf ?? [];
  zeichne();
}
