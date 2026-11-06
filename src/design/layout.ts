import { Window } from "happy-dom";
import { publicPath, type Art } from "../content/document.ts";
import { mediaSize, mediaVariants } from "../render/media.ts";
import { clip, DEFAULT_DESCRIPTION, DEFAULT_IMAGE } from "./seo.ts";

export interface Teaser {
  href: string;
  titel: string;
  datum: string;
  excerpt: string;
  nummer: number | null;
  /** Lesezeit in Minuten; Liste und Newsletter zeigen dieselbe Zahl. */
  minuten: number;
}

export interface RenderInput {
  rel: string;
  art: Art;
  titel: string;
  datum: string;
  html: string;
  teasers: Teaser[];
  /** 1-basiert, nur für /neuigkeiten. */
  page?: number;
}

export interface PageView {
  title: string;
  here: string;
  main: string;
  /** Für `<meta name="description">` und die Vorschau beim Teilen. */
  description: string;
  /** Vorschaubild, ein Pfad auf der Seite. */
  image: string;
  /** Seine Beschreibung aus dem Markdown, für die Vorschau beim Teilen. */
  imageAlt?: string;
  /** Ein Newsletter ist ein Artikel mit Datum, alles andere eine Seite. */
  article?: { datum: string };
  noindex?: boolean;
}

export const PER_PAGE = 10;

const ADDRESS_LINES: Record<string, string[]> = {
  "Advocat Finanz AG Rosenbergstrasse 50 CH-9000 St.Gallen": [
    "Advocat Finanz AG",
    "Rosenbergstrasse 50",
    "CH-9000 St.Gallen",
  ],
  "Infomaniak Network AG Rue Eugène Marziano 25 CH-1227 Les Acacias (GE)": [
    "Infomaniak Network AG",
    "Rue Eugène Marziano 25",
    "CH-1227 Les Acacias (GE)",
  ],
  "UID: CHE-357.969.124 Handelsregister-Nr: CH-320.3.081.815-5 MWST Nr: CHE-357.969.124 MWST Gerichtsstand: CH-9000 St.Gallen": [
    "UID: CHE-357.969.124",
    "Handelsregister-Nr: CH-320.3.081.815-5",
    "MWST Nr: CHE-357.969.124 MWST",
    "Gerichtsstand: CH-9000 St.Gallen",
  ],
};

const MAPS_LINK = "https://maps.app.goo.gl/poLBfgcPVnj2UWaW9";

const SHORT_MONTHS = ["Jan.", "Feb.", "März", "Apr.", "Mai", "Juni", "Juli", "Aug.", "Sep.", "Okt.", "Nov.", "Dez."];
const LONG_MONTHS = [
  "Januar", "Februar", "März", "April", "Mai", "Juni",
  "Juli", "August", "September", "Oktober", "November", "Dezember",
];

export function esc(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function plain(node: { textContent: string | null }): string {
  return (node.textContent ?? "").replace(/\s+/g, " ").trim();
}

export function hyphenate(value: string): string {
  return value.replace(/\s+[–—]\s+/g, " - ");
}

/** Datum aus den ISO-Teilen, ohne Zeitzonenverschiebung. */
export function shortDate(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return "";
  const month = SHORT_MONTHS[Number(match[2]) - 1] ?? "";
  return `${Number(match[3])}. ${month} ${match[1]}`;
}

export function longDate(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return "";
  const month = LONG_MONTHS[Number(match[2]) - 1] ?? "";
  return `${Number(match[3])}. ${month} ${match[1]}`;
}

/** Markdown ohne Bilder, Links und Auszeichnung, als eine Zeile Text. */
function plainMarkdown(markdown: string): string {
  return markdown
    .replace(/!\[[^\]]*]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)]\([^)]*\)/g, "$1")
    .replace(/[*_`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Der Marktbericht, mit dem fast jeder Newsletter beginnt. Für die Vorschau zählt das Thema dahinter. */
const MARKTBERICHT = /^(aktuelles\s+marktgeschehen|markt|rückblick)/i;

/** Wörter ab fünf Buchstaben, klein, für den Vergleich von Titel und Zwischentitel. */
function keyWords(text: string): Set<string> {
  return new Set(text.toLowerCase().split(/[^\p{L}\d]+/u).filter((word) => word.length >= 5));
}

/**
 * Vorschau für die Liste: die ersten Sätze des eigentlichen Themas. Zwischentitel fallen weg,
 * ebenso der Marktbericht am Anfang, ausser er ist selbst das Thema (teilt ein Wort mit dem Titel)
 * oder es kommt danach kein Text mehr.
 */
export function excerptFromMarkdown(markdown: string, titel = "", limit = 490): string {
  const sections: Array<{ heading: string; lines: string[] }> = [{ heading: "", lines: [] }];
  for (const line of markdown.split("\n")) {
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    if (heading) sections.push({ heading: plainMarkdown(heading[1]), lines: [] });
    else sections[sections.length - 1].lines.push(line);
  }
  const withText = sections
    .map((section) => ({ heading: section.heading, text: plainMarkdown(section.lines.join("\n")) }))
    .filter((section) => section.text);
  const titleWords = keyWords(titel.replace(/^newsletter\s*\d+\s*[:–-]\s*/i, ""));
  const isReport = (heading: string) =>
    MARKTBERICHT.test(heading) && ![...keyWords(heading)].some((word) => titleWords.has(word));
  let start = 0;
  while (start < withText.length && isReport(withText[start].heading)) start += 1;
  const rest = start < withText.length ? withText.slice(start) : withText;
  const text = rest.map((section) => section.text).join(" ");
  if (text.length <= limit) return text;
  const cut = text.slice(0, limit);
  const at = cut.lastIndexOf(" ");
  const base = (at > limit * 0.6 ? cut.slice(0, at) : cut).trimEnd();
  return `${base}...`;
}

/** Lesezeit bei rund 200 Wörtern pro Minute, mindestens eine. */
export function minutesFromMarkdown(markdown: string): number {
  const words = plainMarkdown(markdown.replace(/^#{1,6}\s+/gm, "")).split(" ").filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}

/** «Newsletter 34: Edelmetalle …» → Thema und Nummer getrennt, für die Liste. */
export function splitBriefTitle(titel: string, nummer: number | null): { thema: string; nummer: number | null } {
  const match = /^newsletter\s*(\d+)\s*[:–-]\s*(.+)$/i.exec(titel.trim());
  if (!match) return { thema: titel, nummer };
  return { thema: match[2], nummer: nummer ?? Number(match[1]) };
}

/** Zeile unter dem Titel in der Liste, ohne Datum: «Newsletter 34 · 6 Min. Lesezeit». */
function listMeta(teaser: Teaser): string {
  const { nummer } = splitBriefTitle(teaser.titel, teaser.nummer);
  return [nummer ? `Newsletter ${nummer}` : "", `${teaser.minuten} Min. Lesezeit`].filter(Boolean).join(" · ");
}

export function documentTitle(rel: string, titel: string): string {
  if (rel === "kapitel/willkommen.md") return "Advocat Finanz – Vermögen und Recht – ein Leben lang.";
  return `${titel} – Advocat Finanz`;
}

function headingLevel(el: Element): number {
  const match = /^H([1-6])$/.exec(el.tagName);
  return match ? Number(match[1]) : 0;
}

function isImgOnly(el: Element): boolean {
  if (el.tagName !== "P") return false;
  const images = el.querySelectorAll("img");
  if (images.length !== 1) return false;
  const clone = el.cloneNode(true) as Element;
  for (const image of clone.querySelectorAll("img")) image.remove();
  return plain(clone) === "";
}

function imageSrc(el: Element): string {
  const image = el.tagName === "IMG" ? el : el.querySelector("img");
  return image?.getAttribute("src") ?? "";
}

function firstElement(root: ParentNode): HTMLElement | null {
  for (const node of root.childNodes) {
    if (node.nodeType === 1) return node as HTMLElement;
  }
  return null;
}

function soloAnchor(el: Element): HTMLAnchorElement | null {
  if (el.tagName !== "P") return null;
  const anchors = el.querySelectorAll("a");
  if (anchors.length !== 1) return null;
  const anchor = anchors[0] as HTMLAnchorElement;
  if (plain(el) !== plain(anchor)) return null;
  return anchor;
}

/** Bildbreite im Textfluss: Handy fast randlos, sonst die Textspalte. */
const SIZES_PROSA = "(max-width: 820px) calc(100vw - 2.5rem), 760px";
export const SIZES_HERO = "(max-width: 767px) 100vw, min(1120px, 100vw - 7rem)";
const SIZES_CARD = "(max-width: 767px) calc(100vw - 2.5rem), (max-width: 1240px) 33vw, 360px";

/** `srcset` aus den kleineren Fassungen, oder leer: dann lädt der Browser das Original. */
function srcset(src: string): string {
  return mediaVariants(src).map((variant) => `${variant.url} ${variant.width}w`).join(", ");
}

/** Ein Hintergrundbild als echtes <img>, damit der Browser die passende Grösse wählt. */
export function coverImage(className: string, src: string, sizes: string, eager: boolean): string {
  const set = srcset(src);
  const responsive = set ? ` srcset="${esc(set)}" sizes="${sizes}"` : "";
  const loading = eager ? ` fetchpriority="high"` : ` loading="lazy" decoding="async"`;
  return `<img class="${className}" src="${esc(src)}"${responsive} alt=""${loading}>`;
}

/** Ein Eintrag im Archiv. site.js baut Suchtreffer gleich auf; wer hier etwas ändert, ändert dort mit. */
function articleHtml(teaser: Teaser): string {
  const { thema } = splitBriefTitle(teaser.titel, teaser.nummer);
  const excerpt = teaser.excerpt ? `<div class="post-content"><p>${esc(teaser.excerpt)}</p></div>` : "";
  return `<article class="beitrag"><h2 class="entry-title"><a href="${esc(teaser.href)}">${esc(thema)}</a></h2><p class="post-meta"><time datetime="${esc(teaser.datum)}">${esc(shortDate(teaser.datum))}</time> · ${esc(listMeta(teaser))}</p>${excerpt}</article>`;
}

export function cardAnchor(src: string, label: string, href: string): string {
  return `<a class="karte" href="${esc(href)}">${coverImage("karte-bild", src, SIZES_CARD, false)}<span>${esc(label)}</span></a>`;
}

/** Bilder, die fest im Code stehen: Sie dürfen in den Medien nicht gelöscht werden. */
export const FESTE_BILDER = ["Privatperson-scaled.jpg", "Unternehmen-scaled.jpg", "Stiftungen-scaled.jpg"];

function standardCards(): string {
  return `<div class="karten karten-seite">${cardAnchor("/media/Privatperson-scaled.jpg", "Für Privatpersonen", "/privatpersonen")}${cardAnchor("/media/Unternehmen-scaled.jpg", "Für Unternehmen", "/unternehmen-2")}${cardAnchor("/media/Stiftungen-scaled.jpg", "Für Stiftungen", "/stiftungen-2")}</div>`;
}

/** Im Inhalt steht oft „Kontaktieren sie uns“. Auf dem Knopf immer mit grossem Sie. */
export function knopfText(label: string): string {
  return label.replace(/^kontaktieren sie uns/i, "Kontaktieren Sie uns");
}

/** Neben dem Knopf Telefon und Mail: auf dem Handy ein Tipp bis zum Anruf. */
export function bandHtml(heading: string, paragraph: string, label: string, href: string): string {
  const direkt = `<p class="band-direkt"><a href="tel:+41712423030">+41 71 242 30 30</a><a href="mailto:office@advocat-finanz.ch">office@advocat-finanz.ch</a></p>`;
  return `<aside class="band"><div class="band-innen"><h2>${esc(heading)}</h2><p>${esc(paragraph)}</p><div class="aktionen"><a class="btn btn-solid" href="${esc(href)}">${esc(knopfText(label))}</a>${direkt}</div></div></aside>`;
}

function standardBand(): string {
  return bandHtml(
    "Kontaktieren Sie uns.",
    "Gerne stehen wir Ihnen beratend zur Seite und freuen uns auf einen Kontakt.",
    "Kontaktieren sie uns",
    "/kontakt",
  );
}

export function formHtml(): string {
  return `<form class="anfrage" action="/kontakt" method="post" novalidate>
    <div class="feld-reihe">
      <label class="feld"><span>Vorname</span><input name="vorname" autocomplete="given-name" maxlength="100" required aria-describedby="fehler-vorname"><span class="feld-fehler" id="fehler-vorname" hidden></span></label>
      <label class="feld"><span>Name</span><input name="name" autocomplete="family-name" maxlength="100" required aria-describedby="fehler-name"><span class="feld-fehler" id="fehler-name" hidden></span></label>
    </div>
    <label class="feld"><span>E-Mail-Adresse</span><input name="email" type="email" autocomplete="email" maxlength="200" required aria-describedby="fehler-email"><span class="feld-fehler" id="fehler-email" hidden></span></label>
    <label class="feld"><span>Nachricht</span><textarea name="nachricht" rows="7" maxlength="10000" required aria-describedby="fehler-nachricht"></textarea><span class="feld-fehler" id="fehler-nachricht" hidden></span></label>
    <label class="feld-falle" aria-hidden="true">Website<input name="website" tabindex="-1" autocomplete="off"></label>
    <div class="anfrage-fuss">
      <p class="anfrage-hinweis">Ihre Angaben verwenden wir nur, um Ihre Anfrage zu beantworten. Mehr dazu im <a href="/datenschutz">Datenschutz</a>.</p>
      <button class="btn btn-solid" type="submit">Nachricht senden</button>
    </div>
    <p class="form-fehler" role="alert" hidden>Bitte füllen Sie alle Felder aus.</p>
    <p class="form-danke" role="status" hidden>Vielen Dank. Wir haben Ihre Nachricht erhalten und melden uns bei Ihnen.</p>
  </form>`;
}

/** Die Karte lädt erst auf Klick (site.js), damit ohne Zustimmung nichts an Google geht. */
export function kartePlatzhalter(href: string): string {
  return `<div class="karte-frame karte-platzhalter" data-src="${esc(href)}" data-title="Advocat Finanz AG auf der Karte"><p>Die Karte stammt von Google Maps. Erst wenn Sie sie laden, werden Daten an Google übertragen.</p><p><button type="button" class="btn btn-ghost karte-laden">Karte laden</button></p><p><a href="${MAPS_LINK}">In Google Maps öffnen</a></p></div>`;
}

function repair(root: HTMLElement, doc: Document): void {
  for (const paragraph of [...root.querySelectorAll("p")]) {
    const value = plain(paragraph);
    const lines = ADDRESS_LINES[value];
    if (lines) {
      paragraph.innerHTML = lines.map((line) => esc(line)).join("<br>");
      continue;
    }
    if (value === "Vertreten durch: Patrick Rütsche") {
      paragraph.innerHTML = "Vertreten durch:<br>Patrick Rütsche";
      continue;
    }
    if (value === "+41 71 242 30 30" && !paragraph.querySelector("a")) {
      paragraph.innerHTML = `<a href="tel:+41712423030">+41 71 242 30 30</a>`;
      continue;
    }
    if (value === "office@advocat-finanz.ch" && !paragraph.querySelector("a")) {
      paragraph.innerHTML = `<a href="mailto:office@advocat-finanz.ch">office@advocat-finanz.ch</a>`;
      continue;
    }
    const anchor = soloAnchor(paragraph);
    const href = anchor?.getAttribute("href") ?? "";
    if (anchor && /google\.com\/maps\/embed|\/maps\/embed/.test(href)) {
      const holder = doc.createElement("div");
      holder.innerHTML = kartePlatzhalter(href);
      paragraph.replaceWith(holder.firstElementChild!);
    }
  }
}

/** Ein Newsletter als Karte; der Titellink deckt die ganze Karte ab. */
export function teaserCard(teaser: Teaser): string {
  return `<article class="teaser"><p class="post-meta"><time datetime="${esc(teaser.datum)}">${esc(shortDate(teaser.datum))}</time></p><h3 class="teaser-titel"><a href="${esc(teaser.href)}">${esc(teaser.titel)}</a></h3>${teaser.excerpt ? `<p class="teaser-text">${esc(teaser.excerpt)}</p>` : ""}<span class="teaser-mehr" aria-hidden="true">Weiterlesen →</span></article>`;
}

/** Die ersten richtigen Absätze, ohne Formular, Adressen und Knöpfe. */
export function describe(root: HTMLElement): string {
  let text = "";
  for (const paragraph of root.querySelectorAll("p")) {
    if (paragraph.closest("form, .band, .aktionen, .karten")) continue;
    const clone = paragraph.cloneNode(true) as HTMLElement;
    for (const br of clone.querySelectorAll("br")) br.replaceWith(" ");
    const value = plain(clone);
    if (value.length < 40) continue;
    text = text ? `${text} ${value}` : value;
    if (text.length >= 140) break;
  }
  return text ? clip(text) : "";
}

/** Lesezeit bei rund 200 Wörtern pro Minute, mindestens eine. */
function readingMinutes(root: HTMLElement): number {
  const words = plain(root).split(" ").filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}

/** Am Ende eines Newsletters: der vorherige und der nächste. Die Liste ist neueste zuerst. */
function briefNav(input: RenderInput): string {
  const here = publicPath(input.rel);
  const index = input.teasers.findIndex((teaser) => teaser.href === here);
  if (index === -1) return "";
  const link = (teaser: Teaser | undefined, className: string, label: string) =>
    teaser
      ? `<a class="${className}" href="${esc(teaser.href)}"><span class="brief-nav-label">${label}</span><span class="brief-nav-titel">${esc(teaser.titel)}</span></a>`
      : "<span></span>";
  return `<nav class="brief-nav" aria-label="Weitere Newsletter">${link(input.teasers[index + 1], "brief-nav-zurueck", "← Vorheriger Newsletter")}${link(input.teasers[index - 1], "brief-nav-weiter", "Nächster Newsletter →")}</nav>`;
}

const NEUIGKEITEN = "kapitel/neuigkeiten.md";

/** Die Seiten des Archivs hängen an der Adresse von Neuigkeiten, auch wenn Patrick sie umbenennt. */
export function pageHref(page: number): string {
  const archiv = publicPath(NEUIGKEITEN);
  return page <= 1 ? archiv : `${archiv}/page/${page}`;
}

/** intro: die Einleitung der Seite Neuigkeiten, als HTML. */
export function archiveHtml(input: Pick<RenderInput, "titel" | "teasers" | "page">, intro: string): string {
  const page = Math.max(1, input.page ?? 1);
  const pages = Math.max(1, Math.ceil(input.teasers.length / PER_PAGE));
  const slice = input.teasers.slice((page - 1) * PER_PAGE, page * PER_PAGE);
  const counts = new Map<string, number>();
  for (const teaser of input.teasers) {
    const year = teaser.datum.slice(0, 4);
    counts.set(year, (counts.get(year) ?? 0) + 1);
  }
  const years = [...counts].sort(([a], [b]) => b.localeCompare(a));
  const jahre = years.map(([year, count]) =>
    `<li><a href="/neuigkeiten?jahr=${year}" data-jahr="${year}"><span>${year}</span><span class="anzahl"><span class="unsichtbar">, </span>${count}<span class="unsichtbar"> ${count === 1 ? "Beitrag" : "Beiträge"}</span></span></a></li>`,
  ).join("");
  const numbers = Array.from({ length: pages }, (_, index) => index + 1).map((n) =>
    n === page
      ? `<span class="seitenzahl" aria-current="page">${n}</span>`
      : `<a class="seitenzahl" href="${pageHref(n)}" aria-label="Seite ${n}">${n}</a>`,
  ).join("");
  const newer = page > 1 ? `<a class="neuer" href="${pageHref(page - 1)}">← Neuere</a>` : "";
  const older = page < pages ? `<a class="aelter" href="${pageHref(page + 1)}">Ältere →</a>` : "";
  const index = JSON.stringify(
    input.teasers.map((teaser) => ({
      href: teaser.href,
      titel: teaser.titel,
      thema: splitBriefTitle(teaser.titel, teaser.nummer).thema,
      datum: teaser.datum,
      datumAnzeige: shortDate(teaser.datum),
      meta: listMeta(teaser),
      excerpt: teaser.excerpt,
    })),
  ).replaceAll("<", "\\u003c");
  const seite = page > 1 ? `<span class="unsichtbar"> – Seite ${page}</span>` : "";
  return `<div class="archiv">
    <header class="archiv-kopf"><h1>${esc(input.titel)}${seite}</h1>${intro ? `<div class="archiv-intro">${intro}</div>` : ""}</header>
    <p class="filter-status" hidden></p>
    <div class="beitraege">${slice.map(articleHtml).join("")}</div>
    ${pages > 1 ? `<nav class="blaettern" aria-label="Seiten">${newer}${numbers}${older}</nav>` : ""}
    <aside class="seite">
      <form class="suche" action="/neuigkeiten" method="get" role="search">
        <input type="search" name="s" placeholder="Beiträge durchsuchen" aria-label="Suchen">
        <button type="submit">Suchen</button>
      </form>
      <nav class="jahre-nav" aria-labelledby="jahre-titel">
        <h2 id="jahre-titel">Nach Jahr</h2>
        <ul class="jahre">${jahre}</ul>
      </nav>
    </aside>
  </div>
  <script type="application/json" id="suchindex">${index}</script>`;
}

/** Ladehinweise und Masse für Bilder im Text. Titel- und Kartenbilder setzt das Layout selbst. */
export function bilderAufbereiten(root: HTMLElement): void {
  for (const image of root.querySelectorAll("img")) {
    if (/\b(held-bild|held-baum|karte-bild)\b/.test(image.getAttribute("class") ?? "")) continue;
    image.setAttribute("loading", "lazy");
    image.setAttribute("decoding", "async");
    // Der Editor schrieb früher das Grössenverhältnis («1.00») als Beschreibung und Patricks
    // Bildbeschreibung als Titel. Dann gilt der Titel; die Datei wird beim nächsten Speichern richtig.
    const alt = image.getAttribute("alt") ?? "";
    if (/^\d+(\.\d+)?$/.test(alt.trim())) {
      image.setAttribute("alt", image.getAttribute("title")?.trim() ?? "");
      image.removeAttribute("title");
    }
    if (!image.getAttribute("alt")) image.setAttribute("alt", "");
    if (image.getAttribute("title") === "") image.removeAttribute("title");
    const masse = image.hasAttribute("width") ? null : mediaSize(image.getAttribute("src") ?? "");
    if (masse) {
      image.setAttribute("width", String(masse.width));
      image.setAttribute("height", String(masse.height));
    }
    const set = srcset(image.getAttribute("src") ?? "");
    if (set) {
      image.setAttribute("srcset", set);
      image.setAttribute("sizes", SIZES_PROSA);
    }
  }
}

/** Führt fertiges HTML einmal durch das DOM: Bilder aufbereiten, einheitlich ausgeben. */
export function imDom<T>(html: string, arbeit: (root: HTMLElement) => T): T {
  const window = new Window({ url: "https://advocat.local/" });
  try {
    const doc = window.document as unknown as Document;
    const root = doc.createElement("div");
    doc.body.appendChild(root);
    root.innerHTML = html.replaceAll("%22", "&quot;");
    return arbeit(root);
  } finally {
    window.happyDOM.close();
  }
}

/** Seiten aus Text: Newsletter, das Rechtliche und feste Seiten, die nicht in eine Vorlage passen. */
export function renderDocument(input: RenderInput): PageView {
  const view: PageView = {
    title: documentTitle(input.rel, input.titel),
    here: publicPath(input.rel),
    main: "",
    description: DEFAULT_DESCRIPTION,
    image: DEFAULT_IMAGE,
  };
  return imDom(input.html, (root) => {
    const doc = root.ownerDocument;
    repair(root, doc);
    bilderAufbereiten(root);
    const firstImage = root.querySelector("img");
    const firstSrc = firstImage?.getAttribute("src");
    if (firstImage && firstSrc && !/\.svg$/i.test(firstSrc)) {
      view.image = firstSrc;
      view.imageAlt = firstImage.getAttribute("alt") ?? "";
    }
    view.description = describe(root) || DEFAULT_DESCRIPTION;
    if (input.art === "brief") {
      view.article = { datum: input.datum };
      const minuten = input.teasers.find((teaser) => teaser.href === view.here)?.minuten ?? readingMinutes(root);
      view.main = `<article class="beitrag einzel"><p class="zurueck"><a href="/neuigkeiten">← Alle Neuigkeiten</a></p><h1>${esc(input.titel)}</h1><p class="post-meta"><time datetime="${esc(input.datum)}">${esc(longDate(input.datum))}</time> · ${minuten} Min. Lesezeit</p><div class="prosa">${root.innerHTML}</div>${briefNav(input)}</article>${standardCards()}${standardBand()}`;
      return view;
    }
    const heading = firstElement(root);
    if (input.art === "recht" && heading && headingLevel(heading) === 2 && plain(heading).toLowerCase() === input.titel.toLowerCase()) {
      const title = doc.createElement("h1");
      title.textContent = plain(heading);
      heading.replaceWith(title);
    }
    view.main = `<div class="inhalt prosa">${root.innerHTML}</div>`;
    return view;
  });
}
