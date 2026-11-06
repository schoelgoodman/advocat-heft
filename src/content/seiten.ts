/**
 * Die festen Seiten als Felder, je nach Vorlage. Gespeichert werden die Felder (document.ts). Die
 * Textform hier (`lies`, `schreibe`) braucht es für zwei Dinge: alte Fassungen, die noch Markdown
 * sind, und den Assistenten, der eine Seite als Text liest und Vorschläge als Text macht.
 * Läuft auch im Browser: keine Node-Importe.
 */

export interface Bild {
  src: string;
  alt: string;
}
export interface Knopf {
  text: string;
  ziel: string;
}
export interface Band {
  titel: string;
  text: string;
  knopf: Knopf;
}
export interface Karte {
  bild: string;
  titel: string;
  ziel: string;
}
export interface Abschnitt {
  titel: string;
  untertitel: string;
  /** Absätze und Aufzählungen, durch Leerzeilen getrennt. */
  text: string;
  /** Ein Eintrag je Punkt. Ein Punkt kann mehrere Zeilen haben. */
  leistungen: string[];
}

export interface AbschnitteFelder {
  bild: Bild;
  einstieg: { titel: string; text: string; knopf: Knopf | null };
  abschnitte: Abschnitt[];
  band: Band;
}
export interface UebersichtFelder {
  bild: Bild;
  text: string;
  karten: Karte[];
  band: Band;
}
export interface StartFelder {
  bild: Bild;
  signet: string;
  titel: string;
  untertitel: string;
  einstieg: { titel: string; text: string };
  karten: Karte[];
  kartenKnopf: Knopf;
  neuigkeiten: { titel: string; knopf: Knopf };
  band: Band;
}
export interface UeberUnsFelder {
  bild: Bild;
  einstieg: { titel: string; text: string; knopf: Knopf | null };
  sparring: { titel: string; portrait: Bild; name: string; angaben: string; stationen: { titel: string; text: string }[] };
  partner: { titel: string; firmen: { name: string; untertitel: string; text: string; logo: Bild; link: string }[] };
  band: Band;
}
export interface KontaktFelder {
  bild: Bild;
  einstieg: { titel: string; text: string };
  standort: { titel: string; text: string };
  adresse: { titel: string; zeilen: string };
  email: { titel: string; wert: string };
  telefon: { titel: string; wert: string };
  karte: string;
}
export interface NeuigkeitenFelder {
  bild: Bild;
  text: string;
  band: Band;
}

export interface FelderVon {
  abschnitte: AbschnitteFelder;
  uebersicht: UebersichtFelder;
  start: StartFelder;
  "ueber-uns": UeberUnsFelder;
  kontakt: KontaktFelder;
  neuigkeiten: NeuigkeitenFelder;
}
export type Vorlage = keyof FelderVon;
export type Felder = FelderVon[Vorlage];

/** Welche Seite welche Vorlage hat, bevor sie in Feldern gespeichert ist. */
export const VORLAGE_VON: Record<string, Vorlage> = {
  "kapitel/willkommen.md": "start",
  "kapitel/angebot.md": "uebersicht",
  "kapitel/privatpersonen.md": "abschnitte",
  "kapitel/unternehmen.md": "abschnitte",
  "kapitel/stiftungen.md": "abschnitte",
  "kapitel/ueber-uns.md": "ueber-uns",
  "kapitel/kontakt.md": "kontakt",
  "kapitel/neuigkeiten.md": "neuigkeiten",
};

/** Davon gibt es je eine: Sie hängen an Funktionen der Website (Formular, Archiv, Startseite). */
export const EINMALIG: readonly Vorlage[] = ["start", "kontakt", "neuigkeiten"];

export const LEISTUNGEN = "Leistungen:";
export const STANDARD_BAND: Band = {
  titel: "Kontaktieren Sie uns.",
  text: "Gerne stehen wir Ihnen beratend zur Seite und freuen uns auf einen Kontakt.",
  knopf: { text: "Kontaktieren Sie uns", ziel: "/kontakt" },
};

const BILD = /^!\[([^\]]*)\]\((\S+)\)$/;
const LINK = /^\[([^\]]+)\]\(([^)\s]+)\)$/;
const BILDLINK = /^\[!\[([^\]]*)\]\((\S+)\)\]\(([^)\s]+)\)$/;
const TITEL = /^## (.+)$/;
const KLEIN = /^### (.+)$/;

/** Im alten Text steht oft «Kontaktieren sie uns». Auf dem Knopf immer mit grossem Sie. */
function knopfText(label: string): string {
  return label.replace(/^kontaktieren sie uns/i, "Kontaktieren Sie uns");
}

function bloecke(markdown: string): string[] {
  return markdown.split(/\n\s*\n/).map((block) => block.trim()).filter(Boolean);
}

/** Nur was ein Textfeld kann: Absätze und Aufzählungen, keine Titel, Bilder oder Knöpfe. */
function istText(block: string): boolean {
  return !/^(#|!\[|\[!\[|>|\d+\. |\* )/m.test(block) && !LINK.test(block);
}

/** Läuft einmal über die Blöcke einer Seite. Passt etwas nicht, gibt der Aufrufer null zurück. */
class Leser {
  private b: string[];
  private i = 0;
  constructor(markdown: string) {
    this.b = bloecke(markdown);
  }
  get rest(): number {
    return this.b.length - this.i;
  }
  titel(): string | null {
    const m = this.b[this.i]?.match(TITEL);
    if (!m) return null;
    this.i += 1;
    return m[1];
  }
  klein(): string | null {
    const m = this.b[this.i]?.match(KLEIN);
    if (!m) return null;
    this.i += 1;
    return m[1];
  }
  guckTitel(): string | null {
    return this.b[this.i]?.match(TITEL)?.[1] ?? null;
  }
  bild(): Bild | null {
    const m = this.b[this.i]?.match(BILD);
    if (!m) return null;
    this.i += 1;
    return { alt: m[1], src: m[2] };
  }
  knopf(): Knopf | null {
    const m = this.b[this.i]?.match(LINK);
    if (!m) return null;
    this.i += 1;
    return { text: knopfText(m[1]), ziel: m[2] };
  }
  bildLink(): (Bild & { link: string }) | null {
    const m = this.b[this.i]?.match(BILDLINK);
    if (!m) return null;
    this.i += 1;
    return { alt: m[1], src: m[2], link: m[3] };
  }
  /** Textblöcke bis zum nächsten Titel, höchstens bis `bis` Blöcke vor dem Ende. */
  text(bis = 0): string {
    const start = this.i;
    while (this.i < this.b.length - bis && !TITEL.test(this.b[this.i]) && istText(this.b[this.i])) this.i += 1;
    return this.b.slice(start, this.i).join("\n\n");
  }
  block(): string | null {
    const block = this.b[this.i];
    if (block === undefined) return null;
    this.i += 1;
    return block;
  }
  band(): Band | null {
    const titel = this.titel();
    const text = this.block();
    const knopf = this.knopf();
    if (!titel || !text || !knopf || !istText(text)) return null;
    return { titel, text, knopf };
  }
  karten(): Karte[] | null {
    const karten: Karte[] = [];
    while (this.b[this.i]?.match(BILD) && this.b[this.i + 1]?.match(KLEIN)) {
      const bild = this.bild()!;
      const titel = this.klein()!;
      karten.push({ bild: bild.src, titel, ziel: ZIEL_ALT[titel.toLowerCase()] ?? "" });
    }
    return karten.length && karten.every((karte) => karte.ziel) ? karten : null;
  }
}

/** Die Karten standen früher ohne Ziel im Text; das Layout kannte es aus dem Titel. */
const ZIEL_ALT: Record<string, string> = {
  "für privatpersonen": "/privatpersonen",
  "für unternehmen": "/unternehmen-2",
  "für stiftungen": "/stiftungen-2",
};

const bildZeile = (bild: Bild) => `![${bild.alt}](${bild.src})`;
const knopfZeile = (knopf: Knopf) => `[${knopf.text}](${knopf.ziel})`;
const titelZeile = (titel: string) => `## ${titel}`;
const bandZeilen = (band: Band) => [titelZeile(band.titel), band.text, knopfZeile(band.knopf)];
const kartenZeilen = (karten: Karte[], ) => karten.flatMap((karte) => [`![](${karte.bild})`, `### ${karte.titel}`]);
const zusammen = (teile: string[]) => bloecke(teile.join("\n\n")).join("\n\n");

const abschnitte = {
  name: "Seite mit Abschnitten",
  schreibe(seitenTitel: string, a: AbschnitteFelder): string {
    const teile = [bildZeile(a.bild), titelZeile(seitenTitel), titelZeile(a.einstieg.titel), a.einstieg.text];
    if (a.einstieg.knopf) teile.push(knopfZeile(a.einstieg.knopf));
    for (const abschnitt of a.abschnitte) {
      teile.push(titelZeile(abschnitt.titel));
      if (abschnitt.untertitel) teile.push(titelZeile(abschnitt.untertitel));
      teile.push(abschnitt.text);
      const liste = abschnitt.leistungen.filter((punkt) => punkt.trim());
      if (liste.length) teile.push(titelZeile(LEISTUNGEN), liste.map((punkt) => `- ${punkt.trim()}`).join("\n"));
    }
    return zusammen([...teile, ...bandZeilen(a.band)]);
  },
  lies(seitenTitel: string, markdown: string): AbschnitteFelder | null {
    const l = new Leser(markdown);
    const bild = l.bild();
    if (!bild || l.titel() !== seitenTitel) return null;
    const einstiegTitel = l.titel();
    if (!einstiegTitel) return null;
    const einstiegText = l.text(3);
    const knopf = l.rest > 3 ? l.knopf() : null;
    const liste: Abschnitt[] = [];
    // Die letzten drei Blöcke sind das Band: Titel, Satz, Knopf.
    while (l.rest > 3) {
      const titel = l.titel();
      if (!titel || titel === LEISTUNGEN) return null;
      let untertitel = "";
      const zweiter = l.guckTitel();
      if (zweiter && zweiter !== LEISTUNGEN && l.rest > 3) untertitel = l.titel() ?? "";
      const text = l.text(3);
      let leistungen: string[] = [];
      if (l.guckTitel() === LEISTUNGEN) {
        l.titel();
        const punkte = l.block();
        if (!punkte?.startsWith("- ")) return null;
        leistungen = punkte.split(/\n(?=- )/).map((punkt) => punkt.slice(2));
      }
      liste.push({ titel, untertitel, text, leistungen });
    }
    const band = l.band();
    if (!band || l.rest) return null;
    return { bild, einstieg: { titel: einstiegTitel, text: einstiegText, knopf }, abschnitte: liste, band };
  },
  pruefe(a: AbschnitteFelder, fehler: Fehler): void {
    pflicht(fehler, "einstieg.titel", a.einstieg.titel, "Bitte eine Überschrift eingeben.");
    nurText(fehler, "einstieg.text", a.einstieg.text);
    a.abschnitte.forEach((abschnitt, nr) => {
      pflicht(fehler, `abschnitte.${nr}.titel`, abschnitt.titel, "Bitte einen Titel eingeben.");
      if (abschnitt.titel.trim() === LEISTUNGEN) fehler[`abschnitte.${nr}.titel`] = "Dieser Titel ist für die Spalte rechts reserviert.";
      nurText(fehler, `abschnitte.${nr}.text`, abschnitt.text);
    });
    pruefeBand(fehler, a.band);
  },
};

const uebersicht = {
  name: "Übersicht mit Karten",
  schreibe(seitenTitel: string, a: UebersichtFelder): string {
    return zusammen([bildZeile(a.bild), titelZeile(seitenTitel), a.text, ...kartenZeilen(a.karten), ...bandZeilen(a.band)]);
  },
  lies(seitenTitel: string, markdown: string): UebersichtFelder | null {
    const l = new Leser(markdown);
    const bild = l.bild();
    if (!bild || l.titel() !== seitenTitel) return null;
    const text = l.text();
    const karten = l.karten();
    const band = l.band();
    if (!karten || !band || l.rest) return null;
    return { bild, text, karten, band };
  },
  pruefe(a: UebersichtFelder, fehler: Fehler): void {
    nurText(fehler, "text", a.text);
    pruefeKarten(fehler, a.karten);
    pruefeBand(fehler, a.band);
  },
};

const start = {
  name: "Startseite",
  schreibe(_seitenTitel: string, a: StartFelder): string {
    return zusammen([
      bildZeile(a.bild),
      `![Advocat Finanz Webclip](${a.signet})`,
      titelZeile(a.titel),
      titelZeile(a.untertitel),
      titelZeile(a.einstieg.titel),
      a.einstieg.text,
      ...kartenZeilen(a.karten),
      knopfZeile(a.kartenKnopf),
      titelZeile(a.neuigkeiten.titel),
      knopfZeile(a.neuigkeiten.knopf),
      ...bandZeilen(a.band),
    ]);
  },
  lies(_seitenTitel: string, markdown: string): StartFelder | null {
    const l = new Leser(markdown);
    const bild = l.bild();
    const signet = l.bild();
    const titel = l.titel();
    const untertitel = l.titel();
    const einstiegTitel = l.titel();
    if (!bild || !signet || !titel || !untertitel || !einstiegTitel) return null;
    const text = l.text();
    const karten = l.karten();
    const kartenKnopf = l.knopf();
    const neuTitel = l.titel();
    const neuKnopf = l.knopf();
    const band = l.band();
    if (!karten || !kartenKnopf || !neuTitel || !neuKnopf || !band || l.rest) return null;
    return { bild, signet: signet.src, titel, untertitel, einstieg: { titel: einstiegTitel, text }, karten, kartenKnopf, neuigkeiten: { titel: neuTitel, knopf: neuKnopf }, band };
  },
  pruefe(a: StartFelder, fehler: Fehler): void {
    pflicht(fehler, "titel", a.titel, "Bitte einen Titel eingeben.");
    pflicht(fehler, "untertitel", a.untertitel, "Bitte einen Untertitel eingeben.");
    pflicht(fehler, "einstieg.titel", a.einstieg.titel, "Bitte eine Überschrift eingeben.");
    nurText(fehler, "einstieg.text", a.einstieg.text);
    pruefeKarten(fehler, a.karten);
    pruefeKnopf(fehler, "kartenKnopf", a.kartenKnopf);
    pflicht(fehler, "neuigkeiten.titel", a.neuigkeiten.titel, "Bitte einen Titel eingeben.");
    pruefeKnopf(fehler, "neuigkeiten.knopf", a.neuigkeiten.knopf);
    pruefeBand(fehler, a.band);
  },
};

const ueberUns = {
  name: "Über uns",
  schreibe(seitenTitel: string, a: UeberUnsFelder): string {
    const teile = [bildZeile(a.bild), titelZeile(seitenTitel), titelZeile(a.einstieg.titel), a.einstieg.text];
    if (a.einstieg.knopf) teile.push(knopfZeile(a.einstieg.knopf));
    teile.push(titelZeile(a.sparring.titel), bildZeile(a.sparring.portrait), titelZeile(a.sparring.name), a.sparring.angaben);
    for (const station of a.sparring.stationen) teile.push(titelZeile(station.titel), station.text);
    teile.push(titelZeile(a.partner.titel));
    for (const firma of a.partner.firmen) {
      teile.push(titelZeile(firma.name), titelZeile(firma.untertitel), firma.text, `[![${firma.logo.alt}](${firma.logo.src})](${firma.link})`);
    }
    return zusammen([...teile, ...bandZeilen(a.band)]);
  },
  lies(seitenTitel: string, markdown: string): UeberUnsFelder | null {
    const l = new Leser(markdown);
    const bild = l.bild();
    if (!bild || l.titel() !== seitenTitel) return null;
    const einstiegTitel = l.titel();
    if (!einstiegTitel) return null;
    const einstiegText = l.text();
    const knopf = l.knopf();
    const sparringTitel = l.titel();
    const portrait = l.bild();
    const name = l.titel();
    if (!sparringTitel || !portrait || !name) return null;
    const angaben = l.text();
    // Stationen, bis zwei Titel aufeinander folgen: Der erste ist dann «Unsere Partnerunternehmen».
    const stationen: { titel: string; text: string }[] = [];
    let partnerTitel: string | null = null;
    for (;;) {
      const titel = l.titel();
      if (!titel) return null;
      const text = l.text();
      if (!text) {
        partnerTitel = titel;
        break;
      }
      stationen.push({ titel, text });
    }
    const firmen: UeberUnsFelder["partner"]["firmen"] = [];
    while (l.rest > 3) {
      const firma = l.titel();
      const untertitel = l.titel();
      if (!firma || !untertitel) return null;
      const text = l.text();
      const logo = l.bildLink();
      if (!logo) return null;
      firmen.push({ name: firma, untertitel, text, logo: { src: logo.src, alt: logo.alt }, link: logo.link });
    }
    const band = l.band();
    if (!band || l.rest) return null;
    return { bild, einstieg: { titel: einstiegTitel, text: einstiegText, knopf }, sparring: { titel: sparringTitel, portrait, name, angaben, stationen }, partner: { titel: partnerTitel, firmen }, band };
  },
  pruefe(a: UeberUnsFelder, fehler: Fehler): void {
    pflicht(fehler, "einstieg.titel", a.einstieg.titel, "Bitte eine Überschrift eingeben.");
    nurText(fehler, "einstieg.text", a.einstieg.text);
    pflicht(fehler, "sparring.titel", a.sparring.titel, "Bitte einen Titel eingeben.");
    pflicht(fehler, "sparring.name", a.sparring.name, "Bitte einen Namen eingeben.");
    nurText(fehler, "sparring.angaben", a.sparring.angaben);
    a.sparring.stationen.forEach((station, nr) => {
      pflicht(fehler, `sparring.stationen.${nr}.titel`, station.titel, "Bitte einen Titel eingeben.");
      pflicht(fehler, `sparring.stationen.${nr}.text`, station.text, "Bitte einen Text eingeben.");
      nurText(fehler, `sparring.stationen.${nr}.text`, station.text);
    });
    pflicht(fehler, "partner.titel", a.partner.titel, "Bitte einen Titel eingeben.");
    a.partner.firmen.forEach((firma, nr) => {
      pflicht(fehler, `partner.firmen.${nr}.name`, firma.name, "Bitte einen Namen eingeben.");
      pflicht(fehler, `partner.firmen.${nr}.untertitel`, firma.untertitel, "Bitte eine Zeile eingeben.");
      nurText(fehler, `partner.firmen.${nr}.text`, firma.text);
      pflicht(fehler, `partner.firmen.${nr}.link`, firma.link, "Bitte eine Webadresse eingeben.");
    });
    pruefeBand(fehler, a.band);
  },
};

const kontakt = {
  name: "Kontakt",
  schreibe(seitenTitel: string, a: KontaktFelder): string {
    return zusammen([
      bildZeile(a.bild),
      titelZeile(seitenTitel),
      titelZeile(a.einstieg.titel),
      a.einstieg.text,
      titelZeile(a.standort.titel),
      a.standort.text,
      titelZeile(a.adresse.titel),
      a.adresse.zeilen,
      titelZeile(a.email.titel),
      a.email.wert,
      titelZeile(a.telefon.titel),
      a.telefon.wert,
      `[Karte](${a.karte})`,
    ]);
  },
  lies(seitenTitel: string, markdown: string): KontaktFelder | null {
    const l = new Leser(markdown);
    const bild = l.bild();
    if (!bild || l.titel() !== seitenTitel) return null;
    const paar = () => {
      const titel = l.titel();
      const text = l.text();
      return titel && text ? { titel, text } : null;
    };
    const einstieg = paar();
    const standort = paar();
    const adresse = paar();
    const email = paar();
    const telefon = paar();
    const karte = l.knopf();
    if (!einstieg || !standort || !adresse || !email || !telefon || !karte || l.rest) return null;
    return {
      bild,
      einstieg,
      standort,
      adresse: { titel: adresse.titel, zeilen: adresse.text },
      email: { titel: email.titel, wert: email.text },
      telefon: { titel: telefon.titel, wert: telefon.text },
      karte: karte.ziel,
    };
  },
  pruefe(a: KontaktFelder, fehler: Fehler): void {
    pflicht(fehler, "einstieg.titel", a.einstieg.titel, "Bitte eine Überschrift eingeben.");
    pflicht(fehler, "einstieg.text", a.einstieg.text, "Bitte einen Text eingeben.");
    nurText(fehler, "einstieg.text", a.einstieg.text);
    pflicht(fehler, "standort.titel", a.standort.titel, "Bitte einen Titel eingeben.");
    pflicht(fehler, "standort.text", a.standort.text, "Bitte einen Text eingeben.");
    pflicht(fehler, "adresse.titel", a.adresse.titel, "Bitte einen Titel eingeben.");
    pflicht(fehler, "adresse.zeilen", a.adresse.zeilen, "Bitte die Adresse eingeben.");
    pflicht(fehler, "email.titel", a.email.titel, "Bitte einen Titel eingeben.");
    if (!/^\S+@\S+\.\S+$/.test(a.email.wert.trim())) fehler["email.wert"] = "Bitte eine gültige E-Mail-Adresse eingeben.";
    pflicht(fehler, "telefon.titel", a.telefon.titel, "Bitte einen Titel eingeben.");
    pflicht(fehler, "telefon.wert", a.telefon.wert, "Bitte eine Telefonnummer eingeben.");
  },
};

const neuigkeiten = {
  name: "Neuigkeiten",
  schreibe(seitenTitel: string, a: NeuigkeitenFelder): string {
    return zusammen([bildZeile(a.bild), titelZeile(seitenTitel), a.text, ...bandZeilen(a.band)]);
  },
  lies(seitenTitel: string, markdown: string): NeuigkeitenFelder | null {
    const l = new Leser(markdown);
    const bild = l.bild();
    if (!bild || l.titel() !== seitenTitel) return null;
    const text = l.text();
    const band = l.band();
    if (!band || l.rest) return null;
    return { bild, text, band };
  },
  pruefe(a: NeuigkeitenFelder, fehler: Fehler): void {
    nurText(fehler, "text", a.text);
    pruefeBand(fehler, a.band);
  },
};

export type Fehler = Record<string, string>;

function pflicht(fehler: Fehler, pfad: string, wert: string, meldung: string): void {
  if (!wert.trim()) fehler[pfad] = meldung;
}
function nurText(fehler: Fehler, pfad: string, wert: string): void {
  if (!bloecke(wert).every(istText)) fehler[pfad] = "Hier gehen nur Absätze und Aufzählungen, keine Titel, Bilder oder Zeilen, die nur aus einem Link bestehen.";
}
function pruefeKnopf(fehler: Fehler, pfad: string, knopf: Knopf): void {
  pflicht(fehler, `${pfad}.text`, knopf.text, "Bitte eine Beschriftung eingeben.");
  pflicht(fehler, `${pfad}.ziel`, knopf.ziel, "Bitte ein Ziel eingeben.");
}
function pruefeBand(fehler: Fehler, band: Band): void {
  pflicht(fehler, "band.titel", band.titel, "Bitte einen Titel eingeben.");
  pflicht(fehler, "band.text", band.text, "Bitte einen Satz eingeben.");
  nurText(fehler, "band.text", band.text);
  pruefeKnopf(fehler, "band.knopf", band.knopf);
}
function pruefeKarten(fehler: Fehler, karten: Karte[]): void {
  karten.forEach((karte, nr) => {
    pflicht(fehler, `karten.${nr}.titel`, karte.titel, "Bitte einen Titel eingeben.");
    pflicht(fehler, `karten.${nr}.ziel`, karte.ziel, "Bitte ein Ziel eingeben.");
  });
}

/* eslint-disable-next-line @typescript-eslint/no-explicit-any */
const VORLAGEN: Record<Vorlage, { name: string; lies(t: string, m: string): any; schreibe(t: string, a: any): string; pruefe(a: any, f: Fehler): void }> = {
  abschnitte,
  uebersicht,
  start,
  "ueber-uns": ueberUns,
  kontakt,
  neuigkeiten,
};

export function istVorlage(wert: unknown): wert is Vorlage {
  return typeof wert === "string" && Object.hasOwn(VORLAGEN, wert);
}

export function vorlageName(vorlage: Vorlage): string {
  return VORLAGEN[vorlage].name;
}

/** Die Seite als Text, wie sie der Assistent liest und der Fassungsvergleich vergleicht. */
export function alsText(vorlage: Vorlage, seitenTitel: string, felder: Felder): string {
  return VORLAGEN[vorlage].schreibe(seitenTitel, felder);
}

function angeglichen(markdown: string): string {
  return markdown.trim().replace(/\[kontaktieren sie uns/gi, "[Kontaktieren Sie uns").replace(/\r\n/g, "\n");
}

/** Text zu Feldern, oder null, wenn er nicht verlustfrei in die Vorlage passt. */
export function ausText(vorlage: Vorlage, seitenTitel: string, markdown: string): Felder | null {
  const felder = VORLAGEN[vorlage].lies(seitenTitel, markdown.trim()) as Felder | null;
  if (!felder) return null;
  return VORLAGEN[vorlage].schreibe(seitenTitel, felder) === bloecke(angeglichen(markdown)).join("\n\n") ? felder : null;
}

/** Wege, die aus einem Feld in einen Link oder ein Bild werden. Kein javascript: und keine fremden Dateien. */
const ZIEL = /^(\/(?!\/)|#|https?:\/\/|mailto:|tel:)/;
const MEDIA = /^\.\.\/media\/[^/\\\s]+$/;
const KARTE = /^https:\/\/www\.google\.com\/maps\/embed\?/;

function pruefeWege(wert: unknown, pfad: string, fehler: Fehler): void {
  if (Array.isArray(wert)) wert.forEach((x, i) => pruefeWege(x, pfad ? `${pfad}.${i}` : String(i), fehler));
  else if (wert && typeof wert === "object") {
    for (const [name, x] of Object.entries(wert)) pruefeWege(x, pfad ? `${pfad}.${name}` : name, fehler);
  } else if (typeof wert === "string" && wert) {
    const feld = pfad.split(".").at(-1);
    if ((feld === "ziel" || feld === "link") && !ZIEL.test(wert.trim())) fehler[pfad] = "Bitte eine Webadresse (https://…) oder eine Seite dieser Website (/…) eingeben.";
    if ((feld === "src" || feld === "signet" || (feld === "bild" && typeof wert === "string")) && !MEDIA.test(wert)) fehler[pfad] = "Dieses Bild liegt nicht in den Medien.";
    if (feld === "karte" && !KARTE.test(wert)) fehler[pfad] = "Bitte den Einbettungs-Link von Google Maps eingeben (https://www.google.com/maps/embed?…).";
  }
}

/** Was in den Feldern nicht stimmt, je Feld. `_`: Es betrifft nicht ein einzelnes Feld. Leer: alles gut. */
export function pruefeFelder(vorlage: Vorlage, seitenTitel: string, felder: Felder): Fehler {
  const fehler: Fehler = {};
  try {
    VORLAGEN[vorlage].pruefe(felder, fehler);
    pruefeWege(felder, "", fehler);
    if (!seitenTitel.trim()) fehler.titel = "Bitte einen Titel eingeben.";
    if (!Object.keys(fehler).length && !ausText(vorlage, seitenTitel, alsText(vorlage, seitenTitel, felder))) {
      fehler._ = "Die Seite lässt sich so nicht speichern. Bitte die Felder prüfen.";
    }
  } catch {
    fehler._ = "Die Felder dieser Seite sind unvollständig.";
  }
  return fehler;
}

/** Eine neue Seite: alles, was es zum Veröffentlichen braucht, mit dem Bild, das schon da ist. */
export function neueSeite(bild: string): AbschnitteFelder {
  return {
    bild: { src: bild, alt: "" },
    einstieg: { titel: "Worum es geht", text: "", knopf: { text: "Kontaktieren Sie uns", ziel: "/kontakt" } },
    abschnitte: [],
    band: structuredClone(STANDARD_BAND),
  };
}

/** Die Textstücke einer Seite ohne Markdown, wie der Fassungsvergleich sie braucht. */
export function klartextBloecke(markdown: string): string[] {
  return bloecke(markdown)
    .flatMap((block) => (block.startsWith("- ") ? block.split(/\n(?=- )/).map((punkt) => punkt.slice(2)) : [block]))
    .map((block) => block
      .replace(/^\[?!\[[^\]]*\]\([^)]*\)(\]\([^)]*\))?$/, "")
      .replace(/^#+ /, "")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\*\*/g, "")
      .replace(/\s+/g, " ")
      .trim())
    .filter(Boolean);
}
