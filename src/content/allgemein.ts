/**
 * Die allgemeinen Angaben: Firma, Adresse, Telefon, E-Mail, Handelsregister und der Kontakt am
 * Schluss der Newsletter. Sie stehen in `content/allgemein.json`, Patrick ändert sie unter
 * «Verwaltung», «Allgemein». Fuss, Kontaktseite, Band, Formular und die Angaben für Google lesen
 * sie von hier. Läuft auch im Browser: keine Node-Importe.
 */

export const ALLGEMEIN_DATEI = "allgemein.json";

export interface Allgemein {
  firma: string;
  strasse: string;
  plz: string;
  ort: string;
  telefon: string;
  email: string;
  /** Link zu Google Maps für «In Google Maps öffnen» und die Adresse im Fuss. Leer: kein Link. */
  karte: string;
  uid: string;
  handelsregister: string;
  mwst: string;
  gerichtsstand: string;
  vertreten: string;
  /** Kontakt am Schluss der Newsletter, und die Vorgabe für neue Seiten. */
  band: { titel: string; text: string };
}

/** Bis die Datei da ist: die Angaben, wie sie vorher fest im Code standen. */
export const ALLGEMEIN_GRUND: Allgemein = {
  firma: "Advocat Finanz AG",
  strasse: "Rosenbergstrasse 50",
  plz: "9000",
  ort: "St.Gallen",
  telefon: "+41 71 242 30 30",
  email: "office@advocat-finanz.ch",
  karte: "https://maps.app.goo.gl/poLBfgcPVnj2UWaW9",
  uid: "CHE-357.969.124",
  handelsregister: "CH-320.3.081.815-5",
  mwst: "CHE-357.969.124 MWST",
  gerichtsstand: "CH-9000 St.Gallen",
  vertreten: "Patrick Rütsche",
  band: {
    titel: "Kontaktieren Sie uns.",
    text: "Gerne stehen wir Ihnen beratend zur Seite und freuen uns auf einen Kontakt.",
  },
};

const LAENGE = 300;
const zeile = (wert: unknown, sonst: string) => (typeof wert === "string" ? wert.replace(/\s+/g, " ").trim().slice(0, LAENGE) : sonst);

/** Was aus der Datei oder dem Browser kommt, als vollständige Angaben. Fehlt etwas: die Vorgabe. */
export function allgemeinAus(roh: unknown): Allgemein {
  const r = (roh && typeof roh === "object" ? roh : {}) as Record<string, unknown>;
  const band = (r.band && typeof r.band === "object" ? r.band : {}) as Record<string, unknown>;
  const g = ALLGEMEIN_GRUND;
  return {
    firma: zeile(r.firma, g.firma),
    strasse: zeile(r.strasse, g.strasse),
    plz: zeile(r.plz, g.plz),
    ort: zeile(r.ort, g.ort),
    telefon: zeile(r.telefon, g.telefon),
    email: zeile(r.email, g.email),
    karte: zeile(r.karte, g.karte),
    uid: zeile(r.uid, g.uid),
    handelsregister: zeile(r.handelsregister, g.handelsregister),
    mwst: zeile(r.mwst, g.mwst),
    gerichtsstand: zeile(r.gerichtsstand, g.gerichtsstand),
    vertreten: zeile(r.vertreten, g.vertreten),
    band: { titel: zeile(band.titel, g.band.titel), text: zeile(band.text, g.band.text) },
  };
}

export type AllgemeinFehler = Record<string, string>;

/** Was nicht stimmt, je Feld (Pfad wie «band.titel»). Leer: alles gut. */
export function pruefeAllgemein(a: Allgemein): AllgemeinFehler {
  const fehler: AllgemeinFehler = {};
  const pflicht = (pfad: string, wert: string, meldung: string) => {
    if (!wert.trim()) fehler[pfad] = meldung;
  };
  pflicht("firma", a.firma, "Bitte den Namen der Firma eingeben.");
  pflicht("strasse", a.strasse, "Bitte Strasse und Hausnummer eingeben.");
  if (!/^\d{4}$/.test(a.plz)) fehler.plz = "Bitte eine vierstellige Postleitzahl eingeben.";
  pflicht("ort", a.ort, "Bitte den Ort eingeben.");
  if (!/^\+?[\d\s()/-]+$/.test(a.telefon) || a.telefon.replace(/\D/g, "").length < 9) {
    fehler.telefon = "Bitte eine Telefonnummer eingeben, zum Beispiel +41 71 242 30 30.";
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a.email)) fehler.email = "Bitte eine gültige E-Mail-Adresse eingeben.";
  if (a.karte && !/^https:\/\/\S+$/.test(a.karte)) fehler.karte = "Bitte einen Link eingeben, der mit https:// beginnt, oder das Feld leer lassen.";
  pflicht("band.titel", a.band.titel, "Bitte einen Titel eingeben.");
  pflicht("band.text", a.band.text, "Bitte einen Satz eingeben.");
  return fehler;
}

/** «CH-9000 St.Gallen», wie in der Adresse. */
export function ortZeile(a: Pick<Allgemein, "plz" | "ort">): string {
  return `CH-${a.plz} ${a.ort}`;
}

/** Die Adresse, eine Angabe je Zeile. */
export function adressZeilen(a: Allgemein): string[] {
  return [a.firma, a.strasse, ortZeile(a)];
}

/** Für `tel:`: nur Ziffern mit Landesvorwahl. «071 …» wird zu «+4171 …». */
export function telefonLink(telefon: string): string {
  const ziffern = telefon.replace(/[^\d+]/g, "");
  if (ziffern.startsWith("+")) return `+${ziffern.slice(1).replace(/\+/g, "")}`;
  if (ziffern.startsWith("00")) return `+${ziffern.slice(2)}`;
  if (ziffern.startsWith("0")) return `+41${ziffern.slice(1)}`;
  return `+${ziffern}`;
}

const regexText = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Was sich in den Texten der Rechtsseiten und der Kontaktseite mitändert: der ganze Adressblock,
 * dann die einzelnen Angaben. Postleitzahl und Ort allein nicht: «St.Gallen» steht auch beim
 * Gerichtsstand und im Text, das ist nicht dasselbe wie die Adresse.
 */
function stuecke(a: Allgemein): string[] {
  return [adressZeilen(a).join("\n"), a.firma, a.strasse, a.telefon, a.email, a.uid, a.handelsregister, a.mwst, a.gerichtsstand, a.vertreten];
}

/**
 * Ersetzt in einem Text die alten Angaben durch die neuen. Nur ganze Angaben: Erst werden alle
 * alten, die längsten zuerst, durch Platzhalter ersetzt, dann die Platzhalter durch die neuen. So
 * bleibt die UID in «CHE-… MWST» stehen, wenn sich nur die UID ändert, und nichts wird zweimal ersetzt.
 * Der Adressblock passt auch, wenn die Zeilen mit einem harten Umbruch (Backslash, zwei Leerzeichen) enden.
 */
export function ersetzeAngaben(text: string, alt: Allgemein, neu: Allgemein): string {
  const vorher = stuecke(alt);
  const nachher = stuecke(neu);
  const paare = vorher
    .map((wert, i) => ({ alt: wert, neu: nachher[i] }))
    .filter((paar, i) => paar.alt.trim() && vorher.indexOf(paar.alt) === i)
    .sort((a, b) => b.alt.length - a.alt.length);
  if (!paare.some((paar) => paar.alt !== paar.neu) || text.includes("\u0000")) return text;
  const ersatz: string[] = [];
  const marke = (neu: string) => `\u0000${ersatz.push(neu) - 1}\u0000`;
  let ergebnis = text;
  for (const paar of paare) {
    const zeilen = paar.alt.split("\n");
    if (zeilen.length > 1) {
      // Die Umbrüche bleiben, wie sie im Text stehen.
      const muster = new RegExp(zeilen.map(regexText).join(String.raw`(\\?[ \t]*\r?\n)`), "g");
      ergebnis = ergebnis.replace(muster, (...treffer: string[]) => {
        const trenner = treffer.slice(1, zeilen.length);
        return marke(paar.neu.split("\n").map((z, n) => (n ? (trenner[n - 1] ?? trenner.at(-1) ?? "\n") : "") + z).join(""));
      });
      continue;
    }
    // Nicht mitten in einem Wort oder einer längeren Nummer.
    const muster = new RegExp(String.raw`(?<![\p{L}\p{N}])${regexText(paar.alt)}(?![\p{L}\p{N}])`, "gu");
    ergebnis = ergebnis.replace(muster, () => marke(paar.neu));
  }
  return ergebnis.replace(/\u0000(\d+)\u0000/g, (_ganz, nr: string) => ersatz[Number(nr)]);
}

/** Die Angaben beim letzten Laden des Inhalts (load.ts). Vorher: die Vorgabe. */
let aktuell: Allgemein = ALLGEMEIN_GRUND;

export function merkeAllgemein(a: Allgemein): void {
  aktuell = a;
}

export function allgemein(): Allgemein {
  return aktuell;
}
