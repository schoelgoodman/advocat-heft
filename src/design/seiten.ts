import { publicPath, type ContentDocument } from "../content/document.ts";
import type { AbschnitteFelder, Band, Felder, Karte, Knopf, KontaktFelder, NeuigkeitenFelder, StartFelder, UeberUnsFelder, UebersichtFelder, Vorlage } from "../content/seiten.ts";
import { angebote, istAngebot } from "./angebote.ts";
import { archiveHtml, bandHtml, bilderAufbereiten, cardAnchor, coverImage, describe, documentTitle, esc, formHtml, hyphenate, imDom, kartePlatzhalter, pageHref, PER_PAGE, SIZES_HERO, teaserCard, type PageView, type Teaser } from "./layout.ts";
import { clip, DEFAULT_DESCRIPTION, DEFAULT_IMAGE } from "./seo.ts";

/**
 * Die festen Seiten aus ihren Feldern. Der Aufbau steht hier und nirgends sonst: Keine Überschrift
 * und kein Text entscheidet mehr über die Gestaltung.
 */

export interface SeitenInput extends Pick<ContentDocument, "rel" | "titel" | "datum"> {
  vorlage: Vorlage;
  felder: Felder;
  teasers: Teaser[];
  page?: number;
}

type Html = (markdown: string) => Promise<string>;

/** Wie der Text zu HTML wird, wenn er nur aus einem Feld kommt; leer bleibt leer. */
const feldHtml = (html: Html) => (text: string) => (text.trim() ? html(text) : Promise.resolve(""));

const mediaPfad = (src: string) => src.replace(/^(\.\.\/)+media\//, "/media/");

/** Anker für Überschriften. Dieselbe Überschrift zweimal bekommt eine Nummer, damit Sprünge eindeutig sind. */
function ankerGeber(start: string[] = []): (text: string) => string {
  const gezaehlt = new Map<string, number>();
  const geber = (text: string) => {
    const id = text.trim().toLowerCase().replace(/\s+/g, "-");
    const n = (gezaehlt.get(id) ?? 0) + 1;
    gezaehlt.set(id, n);
    return n === 1 ? id : `${id}-#${n}`;
  };
  for (const text of start) geber(text);
  return geber;
}

const titelMitAnker = (anker: (text: string) => string, text: string) => `<h2 id="${esc(anker(text))}">${esc(text)}</h2>`;
const knopfSolid = (knopf: Knopf) => `<p class="aktionen"><a href="${esc(knopf.ziel)}" class="btn btn-solid">${esc(knopf.text)}</a></p>`;
const knopfLeise = (knopf: Knopf) => `<p class="aktionen"><a href="${esc(knopf.ziel)}" class="btn btn-ghost">${esc(knopf.text)}</a></p>`;
const band = (b: Band) => bandHtml(b.titel, b.text, b.knopf.text, b.knopf.ziel);
const karten = (liste: Karte[], art: "home" | "seite") =>
  `<div class="karten karten-${art}">${liste.map((karte) => cardAnchor(mediaPfad(karte.bild), karte.titel, karte.ziel)).join("")}</div>`;
const held = (src: string, titel: string) =>
  `<section class="held held-seite">${coverImage("held-bild", mediaPfad(src), SIZES_HERO, true)}<h1>${esc(titel)}</h1></section>`;
const inhalt = (html: string, klasse = "") => (html ? `<div class="inhalt prosa${klasse}">${html}</div>` : "");
const abschnitt = (html: string, klasse: string) => `<section class="abschnitt${klasse}"><div class="abschnitt-innen">${html}</div></section>`;

interface Gesetzt {
  main: string;
  /** Der Text der Seite in ihrer Reihenfolge. Daraus entsteht die Beschreibung für Google. */
  fliesstext: string;
}

async function setzeAbschnitte(input: SeitenInput, a: AbschnitteFelder, html: Html): Promise<Gesetzt> {
  const text = feldHtml(html);
  const anker = ankerGeber([input.titel]);
  const einstiegText = await text(a.einstieg.text);
  const teile: string[] = [];
  const reihen: string[] = [];
  const sprung: string[] = [];
  let fliesstext = einstiegText;
  let puffer = titelMitAnker(anker, a.einstieg.titel) + einstiegText + (a.einstieg.knopf ? knopfSolid(a.einstieg.knopf) : "");
  const leerePuffer = () => {
    if (puffer) teile.push(inhalt(puffer));
    puffer = "";
  };
  const schliesseReihen = () => {
    if (reihen.length) teile.push(abschnitt(reihen.join(""), " abschnitt-ton"));
    reihen.length = 0;
  };
  for (const eintrag of a.abschnitte) {
    const id = anker(eintrag.titel);
    const untertitel = eintrag.untertitel ? titelMitAnker(anker, eintrag.untertitel) : "";
    const inhaltText = await text(eintrag.text);
    fliesstext += inhaltText;
    const kopf = `<h2 id="${esc(id)}">${esc(eintrag.titel)}</h2>${untertitel}${inhaltText}`;
    const punkte = eintrag.leistungen.filter((punkt) => punkt.trim());
    if (!punkte.length) {
      schliesseReihen();
      puffer += kopf;
      continue;
    }
    anker("Leistungen:");
    leerePuffer();
    sprung.push(`<li><a href="#${esc(id)}"><span class="sprung-nr" aria-hidden="true">${String(sprung.length + 1).padStart(2, "0")}</span>${esc(eintrag.titel)}</a></li>`);
    const liste = await html(punkte.map((punkt) => `- ${punkt.trim()}`).join("\n"));
    reihen.push(`<div class="spalten spalten-2-1"><div class="spalte prosa">${kopf}</div><div class="spalte spalte-seite prosa"><h3>Leistungen:</h3>${liste}</div></div>`);
  }
  schliesseReihen();
  leerePuffer();
  const here = publicPath(input.rel);
  if (istAngebot(here)) {
    const links = angebote().filter((angebot) => angebot.href !== here)
      .map(({ href, name }) => `<li><a href="${href}">Für ${esc(name)}<span class="weitere-pfeil" aria-hidden="true">→</span></a></li>`)
      .join("");
    teile.push(`<nav class="weitere" aria-labelledby="weitere-titel"><p class="sprung-titel" id="weitere-titel">Weitere Angebote</p><ul class="sprung-liste">${links}</ul></nav>`);
  }
  teile.push(band(a.band));
  const menue = sprung.length >= 2
    ? `<nav class="sprung" aria-labelledby="sprung-titel"><p class="sprung-titel" id="sprung-titel">Auf dieser Seite</p><ol class="sprung-liste">${sprung.join("")}</ol></nav>`
    : "";
  return { main: `${held(a.bild.src, input.titel)}${menue}${teile.join("\n")}`, fliesstext };
}

async function setzeUebersicht(input: SeitenInput, a: UebersichtFelder, html: Html): Promise<Gesetzt> {
  const text = await feldHtml(html)(a.text);
  return { main: `${held(a.bild.src, input.titel)}${[inhalt(text), karten(a.karten, "seite"), band(a.band)].filter(Boolean).join("\n")}`, fliesstext: text };
}

async function setzeStart(input: SeitenInput, a: StartFelder, html: Html): Promise<Gesetzt> {
  const text = await feldHtml(html)(a.einstieg.text);
  const anker = ankerGeber([a.titel, a.untertitel]);
  const kopf = `<section class="held held-start">${coverImage("held-bild", mediaPfad(a.bild.src), SIZES_HERO, true)}<div class="held-innen"><img class="held-baum" src="${esc(mediaPfad(a.signet))}" alt="" width="256" height="256"><h1 class="held-titel">${esc(a.titel)}</h1><p class="held-untertitel">${esc(hyphenate(a.untertitel))}</p></div></section>`;
  const einstiegTitel = `<h2 id="${esc(anker(a.einstieg.titel))}">${esc(hyphenate(a.einstieg.titel))}</h2>`;
  const neu = abschnitt(`<h2>${esc(a.neuigkeiten.titel)}</h2><div class="teaser-raster">${input.teasers.slice(0, 3).map(teaserCard).join("")}</div>${knopfLeise(a.neuigkeiten.knopf)}`, " neuigkeiten-start");
  const teile = [
    inhalt(einstiegTitel + text, " inhalt-intro"),
    `<section class="karten-band">${karten(a.karten, "home")}${knopfLeise(a.kartenKnopf)}</section>`,
    neu,
    band(a.band),
  ];
  return { main: `${kopf}${teile.join("\n")}`, fliesstext: text };
}

async function setzeUeberUns(input: SeitenInput, a: UeberUnsFelder, html: Html): Promise<Gesetzt> {
  const text = feldHtml(html);
  const anker = ankerGeber([input.titel]);
  const einstiegText = await text(a.einstieg.text);
  const einstieg = inhalt(titelMitAnker(anker, a.einstieg.titel) + einstiegText + (a.einstieg.knopf ? knopfSolid(a.einstieg.knopf) : ""));
  let fliesstext = einstiegText;

  const sparringTitel = titelMitAnker(anker, a.sparring.titel);
  const portrait = await html(`![${a.sparring.portrait.alt}](${a.sparring.portrait.src})`);
  const nameTitel = titelMitAnker(anker, a.sparring.name);
  const angaben = await text(a.sparring.angaben);
  fliesstext += angaben;
  let stationen = "";
  for (const station of a.sparring.stationen) {
    const stationText = await text(station.text);
    fliesstext += stationText;
    stationen += titelMitAnker(anker, station.titel) + stationText;
  }
  const sparring = abschnitt(`${sparringTitel}<div class="spalten spalten-1-2"><div class="spalte spalte-profil prosa">${portrait}${nameTitel}${angaben}</div><div class="spalte prosa">${stationen}</div></div>`, " abschnitt-ton");

  const partnerTitel = titelMitAnker(anker, a.partner.titel);
  let firmen = "";
  for (const firma of a.partner.firmen) {
    const firmaText = await text(firma.text);
    fliesstext += firmaText;
    const logo = await html(`[![${firma.logo.alt}](${firma.logo.src})](${firma.link})`);
    firmen += `<div class="spalte prosa">${titelMitAnker(anker, firma.name)}<h3>${esc(firma.untertitel)}</h3>${firmaText}${logo}</div>`;
  }
  const partner = abschnitt(`${partnerTitel}<div class="spalten spalten-1-1">${firmen}</div>`, "");
  return { main: `${held(a.bild.src, input.titel)}${[einstieg, sparring, partner, band(a.band)].join("\n")}`, fliesstext };
}

async function setzeKontakt(input: SeitenInput, a: KontaktFelder, html: Html): Promise<Gesetzt> {
  const text = feldHtml(html);
  const anker = ankerGeber([input.titel]);
  const einstieg = titelMitAnker(anker, a.einstieg.titel) + await text(a.einstieg.text);
  const standortText = await text(a.standort.text);
  const zeilen = a.adresse.zeilen.split("\n").map((zeile) => zeile.trim()).filter(Boolean).map(esc).join("<br>");
  const mail = a.email.wert.trim();
  const telefon = a.telefon.wert.trim();
  const adresse = [
    titelMitAnker(anker, a.standort.titel), standortText,
    titelMitAnker(anker, a.adresse.titel), `<p>${zeilen}</p>`,
    titelMitAnker(anker, a.email.titel), `<p><a href="mailto:${esc(mail)}">${esc(mail)}</a></p>`,
    titelMitAnker(anker, a.telefon.titel), `<p><a href="tel:+${telefon.replace(/\D/g, "")}">${esc(telefon)}</a></p>`,
  ].join("");
  const karte = a.karte ? `<div class="karte-voll">${kartePlatzhalter(a.karte)}</div>` : "";
  return {
    main: `${held(a.bild.src, input.titel)}<div class="inhalt"><div class="kontakt-intro">${einstieg}</div><div class="kontakt-grid">${formHtml()}<div class="adresse prosa">${adresse}</div></div></div>${karte}`,
    fliesstext: einstieg + standortText + `<p>${zeilen}</p>`,
  };
}

/** Das Archiv ist schon fertiges HTML mit dem Suchindex darin; es geht nicht mehr durch das DOM. */
async function setzeNeuigkeiten(input: SeitenInput, a: NeuigkeitenFelder, html: Html): Promise<PageView> {
  const intro = await feldHtml(html)(a.text);
  const page = Math.max(1, input.page ?? 1);
  const titel = page > 1 ? `${input.titel} – Seite ${page}` : input.titel;
  let description = imDom(intro, (root) => describe(root));
  if (!description && input.teasers.length) {
    description = clip(`Newsletter von Advocat Finanz: ${input.teasers.slice((page - 1) * PER_PAGE, page * PER_PAGE).map((teaser) => teaser.titel).join(" · ")}`);
  }
  return {
    title: documentTitle(input.rel, titel),
    here: pageHref(page),
    main: `${archiveHtml(input, intro)}${band(a.band)}`,
    description: description || DEFAULT_DESCRIPTION,
    image: mediaPfad(a.bild.src),
    imageAlt: a.bild.alt,
  };
}

export async function renderSeite(input: SeitenInput, html: Html): Promise<PageView> {
  if (input.vorlage === "neuigkeiten") return setzeNeuigkeiten(input, input.felder as NeuigkeitenFelder, html);
  const setzer = {
    abschnitte: () => setzeAbschnitte(input, input.felder as AbschnitteFelder, html),
    uebersicht: () => setzeUebersicht(input, input.felder as UebersichtFelder, html),
    start: () => setzeStart(input, input.felder as StartFelder, html),
    "ueber-uns": () => setzeUeberUns(input, input.felder as UeberUnsFelder, html),
    kontakt: () => setzeKontakt(input, input.felder as KontaktFelder, html),
  }[input.vorlage];
  const { main, fliesstext } = await setzer();
  const bild = mediaPfad((input.felder as AbschnitteFelder).bild.src);
  return {
    title: documentTitle(input.rel, input.titel),
    here: publicPath(input.rel),
    // Die Bilder im Text bekommen hier Masse und Grössen, wie auf den Seiten aus Text.
    main: imDom(main, (root) => {
      bilderAufbereiten(root);
      return root.innerHTML;
    }),
    description: imDom(fliesstext, (root) => describe(root)) || DEFAULT_DESCRIPTION,
    image: /\.svg$/i.test(bild) ? DEFAULT_IMAGE : bild,
    imageAlt: (input.felder as AbschnitteFelder).bild.alt,
  };
}
