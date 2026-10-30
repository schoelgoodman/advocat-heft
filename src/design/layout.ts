import { Window } from "happy-dom";
import { publicPath, type Art } from "../content/document.ts";
import { mediaVariants } from "../render/media.ts";
import { clip, DEFAULT_DESCRIPTION, DEFAULT_IMAGE } from "./seo.ts";

export interface Teaser {
  href: string;
  titel: string;
  datum: string;
  excerpt: string;
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

const PER_PAGE = 10;

const CARD_HREF: Record<string, string> = {
  "für privatpersonen": "/privatpersonen",
  "für unternehmen": "/unternehmen-2",
  "für stiftungen": "/stiftungen-2",
};

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

function esc(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function plain(node: { textContent: string | null }): string {
  return (node.textContent ?? "").replace(/\s+/g, " ").trim();
}

function hyphenate(value: string): string {
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

export function excerptFromMarkdown(markdown: string, limit = 490): string {
  const text = markdown
    .replace(/!\[[^\]]*]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= limit) return text;
  const cut = text.slice(0, limit);
  const at = cut.lastIndexOf(" ");
  const base = (at > limit * 0.6 ? cut.slice(0, at) : cut).trimEnd();
  return `${base}...`;
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
const SIZES_HERO = "(max-width: 767px) 100vw, min(1120px, 100vw - 7rem)";
const SIZES_CARD = "(max-width: 767px) calc(100vw - 2.5rem), (max-width: 1240px) 33vw, 360px";

/** `srcset` aus den kleineren Fassungen, oder leer: dann lädt der Browser das Original. */
function srcset(src: string): string {
  return mediaVariants(src).map((variant) => `${variant.url} ${variant.width}w`).join(", ");
}

/** Ein Hintergrundbild als echtes <img>, damit der Browser die passende Grösse wählt. */
function coverImage(className: string, src: string, sizes: string, eager: boolean): string {
  const set = srcset(src);
  const responsive = set ? ` srcset="${esc(set)}" sizes="${sizes}"` : "";
  const loading = eager ? ` fetchpriority="high"` : ` loading="lazy" decoding="async"`;
  return `<img class="${className}" src="${esc(src)}"${responsive} alt=""${loading}>`;
}

function articleHtml(teaser: Teaser): string {
  const excerpt = teaser.excerpt ? `<div class="post-content"><p>${esc(teaser.excerpt)}</p></div>` : "";
  return `<article class="beitrag"><h2 class="entry-title"><a href="${esc(teaser.href)}">${esc(teaser.titel)}</a></h2><p class="post-meta"><time datetime="${esc(teaser.datum)}">${esc(shortDate(teaser.datum))}</time></p>${excerpt}</article>`;
}

function cardAnchor(src: string, label: string, href: string): string {
  return `<a class="karte" href="${esc(href)}">${coverImage("karte-bild", src, SIZES_CARD, false)}<span>${esc(label)}</span></a>`;
}

function standardCards(): string {
  return `<div class="karten karten-seite">${cardAnchor("/media/Privatperson-scaled.jpg", "Für Privatpersonen", "/privatpersonen")}${cardAnchor("/media/Unternehmen-scaled.jpg", "Für Unternehmen", "/unternehmen-2")}${cardAnchor("/media/Stiftungen-scaled.jpg", "Für Stiftungen", "/stiftungen-2")}</div>`;
}

/** Im Inhalt steht oft „Kontaktieren sie uns“. Auf dem Knopf immer mit grossem Sie. */
function knopfText(label: string): string {
  return label.replace(/^kontaktieren sie uns/i, "Kontaktieren Sie uns");
}

/** Neben dem Knopf Telefon und Mail: auf dem Handy ein Tipp bis zum Anruf. */
function bandHtml(heading: string, paragraph: string, label: string, href: string): string {
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

function formHtml(): string {
  return `<form class="anfrage" action="/kontakt" method="post" novalidate>
    <div class="feld-reihe">
      <label class="feld"><span>Vorname</span><input name="vorname" autocomplete="given-name" maxlength="100" required></label>
      <label class="feld"><span>Name</span><input name="name" autocomplete="family-name" maxlength="100" required></label>
    </div>
    <label class="feld"><span>E-Mail-Adresse</span><input name="email" type="email" autocomplete="email" maxlength="200" required></label>
    <label class="feld"><span>Nachricht</span><textarea name="nachricht" rows="7" maxlength="10000" required></textarea></label>
    <label class="feld-falle" aria-hidden="true">Website<input name="website" tabindex="-1" autocomplete="off"></label>
    <div class="anfrage-fuss">
      <button class="btn btn-solid" type="submit">Nachricht senden</button>
    </div>
    <p class="form-fehler" role="alert" hidden>Bitte füllen Sie alle Felder aus.</p>
    <p class="form-danke" role="status" hidden>Vielen Dank. Wir haben Ihre Nachricht erhalten und melden uns bei Ihnen.</p>
  </form>`;
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
      // Die Karte lädt erst auf Klick (site.js), damit ohne Zustimmung nichts an Google geht.
      const holder = doc.createElement("div");
      holder.className = "karte-frame karte-platzhalter";
      holder.setAttribute("data-src", href);
      holder.setAttribute("data-title", "Advocat Finanz AG auf der Karte");
      holder.innerHTML = `<p>Die Karte stammt von Google Maps. Erst wenn Sie sie laden, werden Daten an Google übertragen.</p><p><button type="button" class="btn btn-ghost karte-laden">Karte laden</button></p><p><a href="${MAPS_LINK}">In Google Maps öffnen</a></p>`;
      paragraph.replaceWith(holder);
    }
  }
}

function takeHero(root: HTMLElement, input: RenderInput): string {
  if (input.art === "brief" || input.art === "recht") return "";
  if (input.rel === "kapitel/neuigkeiten.md") {
    const image = firstElement(root);
    if (image && isImgOnly(image)) image.remove();
    const heading = firstElement(root);
    if (heading && headingLevel(heading) && /^neuigkeiten$/i.test(plain(heading))) heading.remove();
    return "";
  }
  const image = firstElement(root);
  if (!image || !isImgOnly(image)) return "";
  const src = imageSrc(image);
  image.remove();

  if (input.rel === "kapitel/willkommen.md") {
    let tree = "";
    let title = "Advocat Finanz";
    let sub = "Vermögen und recht - ein leben lang";
    const signet = firstElement(root);
    if (signet && isImgOnly(signet)) {
      const alt = signet.querySelector("img")?.getAttribute("alt") || "Advocat Finanz Webclip";
      tree = `<img class="held-baum" src="${esc(imageSrc(signet))}" alt="${esc(alt)}" width="256" height="256">`;
      signet.remove();
    }
    const titleNode = firstElement(root);
    if (titleNode && headingLevel(titleNode)) {
      title = plain(titleNode);
      titleNode.remove();
    }
    const subNode = firstElement(root);
    if (subNode && headingLevel(subNode)) {
      sub = hyphenate(plain(subNode));
      subNode.remove();
    }
    return `<section class="held held-start">${coverImage("held-bild", src, SIZES_HERO, true)}<div class="held-innen">${tree}<h1 class="held-titel">${esc(title)}</h1><p class="held-untertitel">${esc(sub)}</p></div></section>`;
  }

  let title = input.titel;
  const heading = firstElement(root);
  if (heading && headingLevel(heading) && plain(heading).toLowerCase() === input.titel.toLowerCase()) {
    title = plain(heading);
    heading.remove();
  }
  return `<section class="held held-seite">${coverImage("held-bild", src, SIZES_HERO, true)}<h1>${esc(title)}</h1></section>`;
}

function extractCards(root: HTMLElement, home: boolean): void {
  const kids = [...root.children] as HTMLElement[];
  let index = 0;
  while (index < kids.length - 1) {
    const cards: string[] = [];
    let cursor = index;
    while (cursor < kids.length - 1) {
      const image = kids[cursor];
      const heading = kids[cursor + 1];
      if (!image.isConnected || !isImgOnly(image) || headingLevel(heading) !== 3) break;
      const href = CARD_HREF[plain(heading).toLowerCase()];
      if (!href) break;
      cards.push(cardAnchor(imageSrc(image), plain(heading), href));
      cursor += 2;
    }
    if (!cards.length) {
      index += 1;
      continue;
    }
    const box = root.ownerDocument.createElement("div");
    box.className = home ? "karten karten-home" : "karten karten-seite";
    box.innerHTML = cards.join("");
    kids[index].replaceWith(box);
    for (let removeAt = index + 1; removeAt < cursor; removeAt += 1) kids[removeAt].remove();
    index = cursor;
  }
}

function isBandHeading(el: Element): boolean {
  return headingLevel(el) > 0 && /^kontaktieren sie uns\.?$/i.test(plain(el));
}

function isCta(el: Element | null): el is HTMLElement {
  return !!el && el.tagName === "P" && /^kontaktieren sie uns\.?$/i.test(plain(el));
}

function extractBand(root: HTMLElement): void {
  for (const el of [...root.children]) {
    if (!el.isConnected || !isBandHeading(el)) continue;
    const paragraph = el.nextElementSibling as HTMLElement | null;
    const after = paragraph?.nextElementSibling as HTMLElement | null;
    const sentence = paragraph && paragraph.tagName === "P" && !isCta(paragraph)
      ? plain(paragraph)
      : "Gerne stehen wir Ihnen beratend zur Seite und freuen uns auf einen Kontakt.";
    const cta = isCta(paragraph) ? paragraph : isCta(after) ? after : null;
    const anchor = cta ? soloAnchor(cta) : null;
    const label = cta ? plain(cta) : "Kontaktieren sie uns";
    const href = anchor?.getAttribute("href") || "/kontakt";
    const aside = root.ownerDocument.createElement("aside");
    aside.className = "band";
    aside.innerHTML = bandHtml(plain(el), sentence, label, href).replace(/^<aside class="band">|<\/aside>$/g, "");
    el.replaceWith(aside);
    if (paragraph && paragraph !== cta && paragraph.tagName === "P") paragraph.remove();
    cta?.remove();
  }
}

function isBlock(el: Element): boolean {
  return el.classList.contains("band") || el.classList.contains("karten") || el.classList.contains("abschnitt");
}

function isLeistungen(el: Element): boolean {
  return headingLevel(el) > 0 && /^leistungen:?$/i.test(plain(el));
}

function demote(el: HTMLElement, tag: string): HTMLElement {
  const next = el.ownerDocument.createElement(tag);
  next.innerHTML = el.innerHTML;
  el.replaceWith(next);
  return next;
}

function column(doc: Document, className: string, nodes: Element[]): HTMLElement {
  const box = doc.createElement("div");
  box.className = `${className} prosa`;
  box.append(...nodes);
  return box;
}

/** Setzt den Abschnitt an die Stelle des ersten Knotens. */
function section(doc: Document, tinted: boolean, nodes: Element[]): void {
  const anchor = doc.createElement("div");
  nodes[0].before(anchor);
  const box = doc.createElement("section");
  box.className = tinted ? "abschnitt abschnitt-ton" : "abschnitt";
  const inner = doc.createElement("div");
  inner.className = "abschnitt-innen";
  inner.append(...nodes);
  box.append(inner);
  anchor.replaceWith(box);
}

/** Text links (2/3), „Leistungen:“ rechts (1/3), wie die Angebotsseiten oben. Folgezeilen teilen einen Grund. */
function leistungsSpalten(root: HTMLElement): void {
  const doc = root.ownerDocument;
  const rows: HTMLElement[] = [];
  for (const heading of [...root.children]) {
    if (!heading.isConnected || !isLeistungen(heading)) continue;
    const main: Element[] = [];
    let cursor = heading.previousElementSibling;
    while (cursor && headingLevel(cursor) !== 2 && !isBlock(cursor)) {
      main.unshift(cursor);
      cursor = cursor.previousElementSibling;
    }
    while (cursor && headingLevel(cursor) > 0 && !isLeistungen(cursor)) {
      main.unshift(cursor);
      cursor = cursor.previousElementSibling;
    }
    if (!main.length) continue;
    const side: Element[] = [];
    let follow = heading.nextElementSibling;
    while (follow && !(headingLevel(follow) > 0 && headingLevel(follow) <= 2) && !isBlock(follow)) {
      side.push(follow);
      follow = follow.nextElementSibling;
    }
    const row = doc.createElement("div");
    row.className = "spalten spalten-2-1";
    main[0].before(row);
    row.append(column(doc, "spalte", main), column(doc, "spalte spalte-seite", [demote(heading as HTMLElement, "h3"), ...side]));
    rows.push(row);
  }
  // Direkt aufeinanderfolgende Zeilen in einen Abschnitt.
  let group: HTMLElement[] = [];
  const close = () => {
    if (!group.length) return;
    section(doc, true, group);
    group = [];
  };
  for (const row of rows) {
    if (group.length && group[group.length - 1].nextElementSibling !== row) close();
    group.push(row);
  }
  close();
}

/** Sprungmenü unter dem Titelbild: je Leistungsabschnitt (Text links, Leistungen rechts) ein Link. */
function sprungMenu(root: HTMLElement): string {
  const links: string[] = [];
  for (const heading of root.querySelectorAll(".spalten-2-1 > .spalte:first-child > h2:first-child")) {
    const id = heading.getAttribute("id");
    if (id) links.push(`<a href="#${esc(id)}">${esc(plain(heading))}</a>`);
  }
  if (links.length < 2) return "";
  return `<nav class="sprung" aria-label="Auf dieser Seite"><div class="sprung-innen">${links.join("")}</div></nav>`;
}

function headingNamed(root: HTMLElement, pattern: RegExp): HTMLElement | null {
  return ([...root.children] as HTMLElement[]).find((el) => headingLevel(el) === 2 && pattern.test(plain(el))) ?? null;
}

function takeUntil(start: Element | null, stop: (el: Element) => boolean): Element[] {
  const nodes: Element[] = [];
  let cursor = start;
  while (cursor && !stop(cursor) && !isBlock(cursor)) {
    nodes.push(cursor);
    cursor = cursor.nextElementSibling;
  }
  return nodes;
}

/** Über uns: Porträt (1/3) neben dem Werdegang (2/3), Partner nebeneinander (1/2 · 1/2). */
function ueberUnsSpalten(root: HTMLElement): void {
  const doc = root.ownerDocument;
  const sparring = headingNamed(root, /^ihr sparringpartner$/i);
  const partner = headingNamed(root, /^unsere partnerunternehmen$/i);

  if (sparring) {
    const body = takeUntil(sparring.nextElementSibling, (el) => el === partner);
    const portrait = body[0] && isImgOnly(body[0]) ? body[0] : null;
    const split = body.findIndex((el, index) => index > 1 && headingLevel(el) === 2);
    if (portrait && split > 0) {
      const row = doc.createElement("div");
      row.className = "spalten spalten-1-2";
      row.append(column(doc, "spalte spalte-profil", body.slice(0, split)), column(doc, "spalte", body.slice(split)));
      sparring.before(row);
      section(doc, true, [sparring, row]);
    }
  }

  if (partner) {
    const body = takeUntil(partner.nextElementSibling, () => false);
    const groups: Element[][] = [];
    for (const el of body) {
      const open = groups[groups.length - 1];
      if (headingLevel(el) === 2 && (!open || isImgOnly(open[open.length - 1]))) groups.push([el]);
      else if (open) open.push(el);
    }
    if (groups.length > 1) {
      const row = doc.createElement("div");
      row.className = "spalten spalten-1-1";
      for (const group of groups) {
        // Zweite Überschrift ist der Untertitel des Partners.
        const sub = group[1];
        if (sub && headingLevel(sub) === 2) group[1] = demote(sub as HTMLElement, "h3");
        row.append(column(doc, "spalte", group));
      }
      partner.before(row);
      section(doc, false, [partner, row]);
    }
  }
}

function styleSoloLinks(root: HTMLElement): void {
  for (const paragraph of [...root.querySelectorAll("p")]) {
    if (paragraph.closest(".band")) continue;
    const anchor = soloAnchor(paragraph);
    if (!anchor) continue;
    const label = plain(anchor).toLowerCase();
    if (label === "zu unserem angebot" || label === "mehr neuigkeiten" || label === "hier zu unserem angebot") {
      paragraph.classList.add("aktionen");
      anchor.classList.add("btn", "btn-ghost");
    } else if (label === "kontaktieren sie uns") {
      paragraph.classList.add("aktionen");
      anchor.classList.add("btn", "btn-solid");
      anchor.textContent = knopfText(plain(anchor));
    }
  }
}

function accordion(root: HTMLElement): void {
  const kids = [...root.children] as HTMLElement[];
  const next: Node[] = [];
  let openedInSection = false;
  let index = 0;
  while (index < kids.length) {
    const el = kids[index];
    const level = headingLevel(el);
    if (level === 2) openedInSection = false;
    if (level === 3) {
      const details = root.ownerDocument.createElement("details");
      details.className = "frage";
      if (!openedInSection) {
        details.open = true;
        openedInSection = true;
      }
      const summary = root.ownerDocument.createElement("summary");
      summary.textContent = plain(el);
      const answer = root.ownerDocument.createElement("div");
      answer.className = "antwort";
      index += 1;
      while (index < kids.length) {
        const follow = kids[index];
        const followLevel = headingLevel(follow);
        if (followLevel === 2 || followLevel === 3) break;
        if (follow.classList.contains("band") || follow.classList.contains("karten")) break;
        answer.appendChild(follow);
        index += 1;
      }
      details.append(summary, answer);
      next.push(details);
      continue;
    }
    next.push(el);
    index += 1;
  }
  root.replaceChildren(...next);
}

function layoutImpressum(root: HTMLElement): string {
  const kids = [...root.children] as HTMLElement[];
  const images = kids.map((el, index) => (isImgOnly(el) ? index : -1)).filter((index) => index >= 0);
  if (images.length < 3) return `<div class="inhalt prosa">${root.innerHTML}</div>`;
  const [logo, wordpress, host] = images;
  const row = (left: HTMLElement[], right: HTMLElement[]) =>
    `<div class="impressum-reihe"><div class="impressum-links prosa">${left.map((el) => el.outerHTML).join("")}</div><div class="impressum-rechts prosa">${right.map((el) => el.outerHTML).join("")}</div></div>`;
  return [
    row(kids.slice(0, logo + 1), kids.slice(logo + 1, wordpress)),
    row([kids[wordpress]], kids.slice(wordpress + 1, host)),
    row([kids[host]], kids.slice(host + 1)),
  ].join("\n");
}

function layoutKontakt(root: HTMLElement): string {
  const frame = root.querySelector(".karte-frame");
  frame?.remove();
  const kids = [...root.children] as HTMLElement[];
  const split = kids.findIndex((el) => headingLevel(el) > 0 && /^unser standort$/i.test(plain(el)));
  const introNodes = split === -1 ? kids : kids.slice(0, split);
  const addressNodes = split === -1 ? [] : kids.slice(split);
  const doc = root.ownerDocument;
  const intro = doc.createElement("div");
  intro.className = "kontakt-intro";
  intro.append(...introNodes);
  const form = doc.createElement("div");
  form.innerHTML = formHtml();
  const address = doc.createElement("div");
  address.className = "adresse prosa";
  address.append(...addressNodes);
  const grid = doc.createElement("div");
  grid.className = "kontakt-grid";
  const fields = form.firstElementChild;
  if (fields) grid.append(fields, address);
  const wrap = doc.createElement("div");
  wrap.className = "inhalt";
  wrap.append(intro, grid);
  const map = frame
    ? `<div class="karte-voll">${frame.outerHTML}</div>`
    : "";
  return `${wrap.outerHTML}${map}`;
}

/** Ein Newsletter als Karte; der Titellink deckt die ganze Karte ab. */
function teaserCard(teaser: Teaser): string {
  return `<article class="teaser"><p class="post-meta"><time datetime="${esc(teaser.datum)}">${esc(shortDate(teaser.datum))}</time></p><h3 class="teaser-titel"><a href="${esc(teaser.href)}">${esc(teaser.titel)}</a></h3>${teaser.excerpt ? `<p class="teaser-text">${esc(teaser.excerpt)}</p>` : ""}<span class="teaser-mehr" aria-hidden="true">Weiterlesen →</span></article>`;
}

/** «Unsere Neuigkeiten»: die drei neuesten als Kartenreihe in voller Breite, «Mehr Neuigkeiten» darunter. */
function insertTeasers(root: HTMLElement, teasers: Teaser[]): void {
  for (const heading of root.querySelectorAll("h1,h2,h3")) {
    if (!/^unsere neuigkeiten$/i.test(plain(heading))) continue;
    const doc = root.ownerDocument;
    const next = heading.nextElementSibling;
    const more = next?.classList.contains("aktionen") ? next : null;
    const grid = doc.createElement("div");
    grid.className = "teaser-raster";
    grid.innerHTML = teasers.slice(0, 3).map(teaserCard).join("");
    const title = doc.createElement("h2");
    title.textContent = plain(heading);
    const nodes: Element[] = [title, grid];
    if (more) nodes.push(more);
    heading.replaceWith(title);
    section(doc, false, nodes);
    title.closest(".abschnitt")?.classList.add("neuigkeiten-start");
    break;
  }
  for (const heading of root.querySelectorAll("h1,h2")) {
    if (/herzlich willkommen/i.test(plain(heading))) heading.textContent = hyphenate(plain(heading));
  }
}

function serializeFlow(root: HTMLElement): string {
  const doc = root.ownerDocument;
  const parts: string[] = [];
  let bucket = doc.createElement("div");
  bucket.className = "inhalt prosa";
  const flush = (extra = "") => {
    if (![...bucket.childNodes].some((node) => node.nodeType !== 3 || (node.textContent ?? "").trim())) return;
    if (extra) bucket.classList.add(extra);
    parts.push(bucket.outerHTML);
    bucket = doc.createElement("div");
    bucket.className = "inhalt prosa";
  };
  for (const node of [...root.childNodes]) {
    if (node.nodeType === 3 && !(node.textContent ?? "").trim()) continue;
    if (!node.isConnected) continue;
    if (node.nodeType === 1) {
      const el = node as HTMLElement;
      if (isBlock(el)) {
        const home = el.classList.contains("karten-home");
        flush(home ? "inhalt-intro" : "");
        if (home) {
          // «Zu unserem Angebot» gehört zu den Karten, nicht allein in den weissen Raum darunter.
          const next = el.nextElementSibling;
          const more = next?.classList.contains("aktionen") ? next : null;
          more?.remove();
          parts.push(`<section class="karten-band">${el.outerHTML}${more ? more.outerHTML : ""}</section>`);
        } else parts.push(el.outerHTML);
        continue;
      }
    }
    bucket.appendChild(node);
  }
  flush();
  return parts.join("\n");
}

/** Die ersten richtigen Absätze, ohne Formular, Adressen und Knöpfe. */
function describe(root: HTMLElement): string {
  let text = "";
  for (const paragraph of root.querySelectorAll("p")) {
    if (paragraph.closest("form, .band, .aktionen, .karten")) continue;
    // Der Satz unter „Kontaktieren Sie uns.“ wird später das Band und steht auf jeder Seite.
    const before = paragraph.previousElementSibling;
    if (before && isBandHeading(before)) continue;
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

function pageHref(page: number): string {
  return page <= 1 ? "/neuigkeiten" : `/neuigkeiten/page/${page}`;
}

function archiveHtml(input: RenderInput): string {
  const page = Math.max(1, input.page ?? 1);
  const pages = Math.max(1, Math.ceil(input.teasers.length / PER_PAGE));
  const slice = input.teasers.slice((page - 1) * PER_PAGE, page * PER_PAGE);
  const recent = input.teasers.slice(0, 5).map((teaser) =>
    `<li><a href="${esc(teaser.href)}">${esc(teaser.titel)}</a></li>`,
  ).join("");
  const numbers = Array.from({ length: pages }, (_, index) => index + 1).map((n) =>
    n === page
      ? `<span class="seitenzahl" aria-current="page">${n}</span>`
      : `<a class="seitenzahl" href="${pageHref(n)}" aria-label="Seite ${n}">${n}</a>`,
  ).join("");
  const newer = page > 1 ? `<a class="neuer" href="${pageHref(page - 1)}">← Neuere</a>` : "";
  const older = page < pages ? `<a class="aelter" href="${pageHref(page + 1)}">Ältere →</a>` : "";
  const index = JSON.stringify(
    input.teasers.map((teaser) => ({ ...teaser, datumAnzeige: shortDate(teaser.datum) })),
  ).replaceAll("<", "\\u003c");
  return `<div class="archiv">
    <div class="beitraege">${slice.map(articleHtml).join("")}</div>
    ${pages > 1 ? `<nav class="blaettern" aria-label="Seiten">${newer}${numbers}${older}</nav>` : ""}
    <aside class="seite">
      <form class="suche" action="/neuigkeiten" method="get" role="search">
        <input type="search" name="s" placeholder="Beiträge durchsuchen" aria-label="Suchen">
        <button type="submit">Suchen</button>
      </form>
      <section>
        <h2>Neueste Beiträge</h2>
        <ul>${recent}</ul>
      </section>
    </aside>
  </div>
  <script type="application/json" id="suchindex">${index}</script>`;
}

function hereFor(input: RenderInput): string {
  if (input.rel === "kapitel/neuigkeiten.md" && (input.page ?? 1) > 1) return pageHref(input.page ?? 1);
  return publicPath(input.rel);
}

export function renderDocument(input: RenderInput): PageView {
  const view: PageView = {
    title: documentTitle(input.rel, input.titel),
    here: hereFor(input),
    main: "",
    description: DEFAULT_DESCRIPTION,
    image: DEFAULT_IMAGE,
  };
  const window = new Window({ url: "https://advocat.local/" });
  try {
    // Die Helfer sind gegen die Browser-Typen geschrieben. happy-dom verhält sich gleich, hat aber eigene Typen.
    const doc = window.document as unknown as Document;
    const root = doc.createElement("div");
    doc.body.appendChild(root);
    root.innerHTML = input.html.replaceAll("%22", "&quot;");
    repair(root, doc);
    for (const image of root.querySelectorAll("img")) {
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
      const set = srcset(image.getAttribute("src") ?? "");
      if (set) {
        image.setAttribute("srcset", set);
        image.setAttribute("sizes", SIZES_PROSA);
      }
    }
    const firstImage = root.querySelector("img");
    const firstSrc = firstImage?.getAttribute("src");
    if (firstImage && firstSrc && !/\.svg$/i.test(firstSrc)) {
      view.image = firstSrc;
      view.imageAlt = firstImage.getAttribute("alt") ?? "";
    }
    view.description = describe(root) || DEFAULT_DESCRIPTION;
    const hero = takeHero(root, input);
    if (input.art === "brief") {
      view.article = { datum: input.datum };
      view.main = `<article class="beitrag einzel"><p class="zurueck"><a href="/neuigkeiten">← Alle Neuigkeiten</a></p><h1>${esc(input.titel)}</h1><p class="post-meta"><time datetime="${esc(input.datum)}">${esc(longDate(input.datum))}</time> · ${readingMinutes(root)} Min. Lesezeit</p><div class="prosa">${root.innerHTML}</div>${briefNav(input)}</article>${standardCards()}${standardBand()}`;
      return view;
    }
    if (input.rel === "kapitel/neuigkeiten.md") {
      extractBand(root);
      const band = root.querySelector(".band");
      const page = Math.max(1, input.page ?? 1);
      // Das Archiv zeigt keinen Titel, wie das Original. Für Suchmaschinen und Screenreader steht er trotzdem da.
      const titel = page > 1 ? `${input.titel} – Seite ${page}` : input.titel;
      if (page > 1) view.title = documentTitle(input.rel, titel);
      if (view.description === DEFAULT_DESCRIPTION && input.teasers.length) {
        view.description = clip(`Newsletter von Advocat Finanz: ${input.teasers.slice((page - 1) * PER_PAGE, page * PER_PAGE).map((teaser) => teaser.titel).join(" · ")}`);
      }
      view.main = `<h1 class="unsichtbar">${esc(titel)}</h1>${archiveHtml(input)}${band ? band.outerHTML : standardBand()}`;
      return view;
    }
    if (input.art === "recht") {
      const heading = firstElement(root);
      if (heading && headingLevel(heading) === 2 && plain(heading).toLowerCase() === input.titel.toLowerCase()) {
        const title = doc.createElement("h1");
        title.textContent = plain(heading);
        heading.replaceWith(title);
      }
    }
    if (input.rel === "recht/impressum.md") {
      view.main = `${hero}${layoutImpressum(root)}`;
      return view;
    }
    extractCards(root, input.rel === "kapitel/willkommen.md");
    extractBand(root);
    styleSoloLinks(root);
    leistungsSpalten(root);
    if (input.rel === "kapitel/ueber-uns.md") ueberUnsSpalten(root);
    if (input.rel === "kapitel/faq.md") accordion(root);
    if (input.rel === "kapitel/willkommen.md") insertTeasers(root, input.teasers);
    if (input.rel === "kapitel/kontakt.md") {
      view.main = `${hero}${layoutKontakt(root)}`;
      return view;
    }
    view.main = `${hero}${sprungMenu(root)}${serializeFlow(root)}`;
    return view;
  } finally {
    window.happyDOM.close();
  }
}
