import { fehlerText, h, postJson, toast } from "../dom.ts";

/** Alle Änderungen am Inhalt, die neueste zuerst. Zurück kommt immer nur eine Seite oder ein Bild. */

interface Eintrag {
  rev: string;
  date: string;
  message: string;
  dateien: { status: string; pfad: string }[];
}

const wann = new Intl.DateTimeFormat("de-CH", { dateStyle: "medium", timeStyle: "short" });
const istSeite = (pfad: string) => /^(briefe|kapitel|recht)\/.+\.md$/.test(pfad);

export interface VerlaufAnschluss {
  frage(optionen: { titel: string; text: string; ja: string; nein?: string; gefahr?: boolean }): Promise<boolean>;
  oeffne(rel: string): void;
  /** Vor dem Zurückholen: Offene Änderungen müssen gesichert sein. */
  bereit(): Promise<boolean>;
}

export function verlaufAnsicht(host: HTMLElement, anschluss: VerlaufAnschluss): () => Promise<void> {
  const liste = h("ol", { class: "aenderungen" });
  const mehr = h("div", { class: "aenderungen-mehr" });
  let geladen = 0;
  /** Die jeweils neueste Fassung einer Seite ist ihr jetziger Stand: Da gibt es nichts zurückzuholen. */
  const gesehen = new Set<string>();

  const holeZurueck = async (eintrag: Eintrag, rel: string) => {
    const ja = await anschluss.frage({
      titel: "Diesen Stand zurückholen?",
      text: `Die Seite bekommt den Stand vom ${wann.format(new Date(eintrag.date))}. Was heute dort steht, bleibt als frühere Fassung erhalten, der Rest der Website bleibt, wie er ist.`,
      ja: "Zurückholen",
      nein: "Abbrechen",
    });
    if (!ja || !(await anschluss.bereit())) return;
    const antwort = await postJson("/api/restore", { rel, rev: eintrag.rev, path: rel });
    if (!antwort.ok) {
      toast(await fehlerText(antwort, "Zurückholen ging nicht."), undefined, true);
      return;
    }
    toast("Zurückgeholt.");
    await lade();
  };

  const holeBildZurueck = async (eintrag: Eintrag, pfad: string) => {
    const antwort = await postJson("/api/medien/zurueck", { name: pfad.slice("media/".length), rev: eintrag.rev });
    toast(antwort.ok ? "Bild zurückgeholt." : await fehlerText(antwort, "Zurückholen ging nicht."), undefined, !antwort.ok);
    if (antwort.ok) await lade();
  };

  const zeile = (eintrag: Eintrag) => {
    const seiten = eintrag.dateien.filter((d) => istSeite(d.pfad) && d.status !== "D");
    const einzig = seiten.length === 1 ? seiten[0].pfad : null;
    const aktuell = einzig != null && !gesehen.has(einzig);
    for (const seite of seiten) gesehen.add(seite.pfad);
    // Ein gelöschtes Bild, das später wiederkam, gibt es schon: Dann nichts anbieten.
    const geloescht = eintrag.dateien.find((d) => d.status === "D" && d.pfad.startsWith("media/") && !gesehen.has(d.pfad));
    for (const datei of eintrag.dateien) if (datei.pfad.startsWith("media/")) gesehen.add(datei.pfad);
    return h(
      "li",
      {},
      h("div", {}, h("strong", {}, eintrag.message), h("small", { class: "leise" }, wann.format(new Date(eintrag.date)))),
      h(
        "div",
        { class: "aktionen" },
        einzig ? h("button", { type: "button", class: "leise", onclick: () => anschluss.oeffne(einzig) }, "Seite öffnen") : null,
        einzig && aktuell ? h("span", { class: "leise" }, "aktueller Stand") : null,
        einzig && !aktuell ? h("button", { type: "button", onclick: () => void holeZurueck(eintrag, einzig) }, "Diesen Stand zurückholen") : null,
        geloescht ? h("button", { type: "button", onclick: () => void holeBildZurueck(eintrag, geloescht.pfad) }, "Bild zurückholen") : null,
      ),
    );
  };

  const hole = async () => {
    const antwort = await fetch(`/api/verlauf?skip=${geladen}`, { cache: "no-store" });
    if (!antwort.ok) throw new Error(await fehlerText(antwort, "Der Verlauf liess sich nicht laden."));
    const { eintraege, mehr: weitere } = (await antwort.json()) as { eintraege: Eintrag[]; mehr: boolean };
    liste.append(...eintraege.map(zeile));
    geladen += eintraege.length;
    mehr.replaceChildren(weitere ? h("button", { type: "button", onclick: () => void hole() }, "Ältere anzeigen") : "");
  };

  async function lade(): Promise<void> {
    geladen = 0;
    gesehen.clear();
    liste.replaceChildren();
    await hole();
  }

  host.replaceChildren(
    h("h1", {}, "Verlauf"),
    h("p", { class: "leise einleitung" }, "Jede Änderung an der Website, die neueste zuerst. Zurückholen betrifft immer nur eine Seite."),
    liste,
    mehr,
  );
  return lade;
}
