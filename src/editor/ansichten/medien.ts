import { fehlerText, h, toast, postJson } from "../dom.ts";

/** Die Übersicht der Bilder und die Auswahl, die jedes Bildfeld öffnet. */

export interface Medium {
  name: string;
  groesse: number;
  fest: boolean;
  verwendet: { titel: string; rel: string; papierkorb: boolean }[];
}

async function lade(): Promise<Medium[]> {
  const response = await fetch("/api/medien", { cache: "no-store" });
  if (!response.ok) throw new Error(await fehlerText(response, "Die Medien liessen sich nicht laden."));
  return ((await response.json()) as { medien: Medium[] }).medien;
}

const vorschau = (name: string, w = 240) => `/api/medien/vorschau?w=${w}&name=${encodeURIComponent(name)}`;

const groesse = (bytes: number) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);

/** Lässt ein vorhandenes Bild wählen, statt es nochmals hochzuladen. Null: abgebrochen. */
export function waehleMedium(): Promise<string | null> {
  return new Promise((resolve) => {
    const inhalt = h("div", { class: "medien-raster" }, h("p", { class: "leise" }, "Lädt …"));
    const suche = h("input", { type: "search", placeholder: "Dateiname suchen", "aria-label": "Dateiname suchen" });
    const schliesse = (wert: string | null) => {
      dialog.close();
      dialog.remove();
      resolve(wert);
    };
    const dialog = h(
      "dialog",
      { class: "medien-wahl" },
      h("div", { class: "medien-kopf" }, h("h2", {}, "Bild wählen"), suche, h("button", { type: "button", onclick: () => schliesse(null) }, "Abbrechen")),
      inhalt,
    );
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      schliesse(null);
    });
    let medien: Medium[] = [];
    const zeichne = () => {
      const treffer = medien.filter((m) => m.name.toLowerCase().includes(suche.value.trim().toLowerCase()));
      inhalt.replaceChildren(
        ...(treffer.length
          ? treffer.map((m) => h(
              "button",
              { type: "button", class: "medium-wahl", onclick: () => schliesse(m.name) },
              h("img", { src: vorschau(m.name), alt: "", loading: "lazy" }),
              h("span", {}, m.name),
            ))
          : [h("p", { class: "leise" }, "Kein passendes Bild.")]),
      );
    };
    suche.addEventListener("input", zeichne);
    document.body.append(dialog);
    dialog.showModal();
    lade().then((liste) => {
      medien = liste;
      zeichne();
    }).catch((error: Error) => inhalt.replaceChildren(h("p", { class: "leise" }, error.message)));
  });
}

export type MedienFilter = "alle" | "frei" | "korb";

/** Braucht nur noch ein Eintrag im Papierkorb das Bild? Dann ist es weder frei noch auf der Website. */
const nurImKorb = (m: Medium) => !m.fest && m.verwendet.length > 0 && m.verwendet.every((v) => v.papierkorb);

/** Die Seite «Medien». `oeffne` springt zur Seite, die ein Bild braucht. Zurück kommt das Laden, auf Wunsch gleich mit einem Filter. */
export function medienAnsicht(host: HTMLElement, oeffne: (rel: string) => void, hochladen: (datei: File) => Promise<string>): (zeige?: MedienFilter) => Promise<void> {
  let medien: Medium[] = [];
  let filter: MedienFilter = "alle";
  const suche = h("input", { type: "search", class: "suche", placeholder: "Dateiname suchen", "aria-label": "Dateiname suchen" });
  const kacheln = h("div", { class: "chips", role: "group", "aria-label": "Filter" });
  const raster = h("ul", { class: "medien-liste" });
  const text = h("p", { class: "leise" });
  const datei = h("input", { type: "file", accept: "image/png,image/jpeg,image/webp,image/gif,image/svg+xml", multiple: true, hidden: true });

  const laden = async (zeige?: MedienFilter) => {
    if (zeige) filter = zeige;
    medien = await lade();
    zeichne();
  };

  datei.addEventListener("change", async () => {
    const gewaehlt = [...(datei.files ?? [])];
    datei.value = "";
    for (const [i, f] of gewaehlt.entries()) {
      toast(gewaehlt.length > 1 ? `Lädt hoch: ${i + 1} von ${gewaehlt.length} …` : "Lädt hoch …");
      await hochladen(f).catch((error: Error) => toast(`${f.name}: ${error.message}`, undefined, true));
    }
    await fetch("/api/commit", { method: "POST" }).catch(() => null);
    await laden();
    if (gewaehlt.length) toast(gewaehlt.length > 1 ? `${gewaehlt.length} Bilder hochgeladen.` : "Hochgeladen.");
  });

  const loesche = async (m: Medium) => {
    const response = await fetch(`/api/medien?name=${encodeURIComponent(m.name)}`, { method: "DELETE" }).catch(() => null);
    if (!response?.ok) {
      toast(response ? await fehlerText(response, "Löschen ging nicht.") : "Keine Verbindung zum Server.", undefined, true);
      return;
    }
    const { rev } = (await response.json()) as { rev: string | null };
    await laden();
    toast(`«${m.name}» gelöscht.`, rev ? {
      label: "Rückgängig",
      aus: () => {
        void postJson("/api/medien/zurueck", { name: m.name, rev }).then(async (antwort) => {
          if (!antwort.ok) toast(await fehlerText(antwort, "Zurückholen ging nicht."), undefined, true);
          await laden();
        });
      },
    } : undefined);
  };

  const karte = (m: Medium) => {
    const gebraucht = m.verwendet.filter((v) => !v.papierkorb);
    const imKorb = m.verwendet.filter((v) => v.papierkorb);
    return h(
      "li",
      { class: "medium" },
      h("a", { href: `/media/${encodeURIComponent(m.name)}`, target: "_blank", rel: "noopener", "aria-label": `${m.name} ansehen` }, h("img", { src: vorschau(m.name), alt: "", loading: "lazy" })),
      h("span", { class: "medium-name" }, m.name),
      h("small", { class: "leise" }, groesse(m.groesse)),
      m.fest ? h("small", { class: "leise" }, "Fest auf der Website") : null,
      gebraucht.length
        ? h("small", { class: "medium-wo" }, "In: ", ...gebraucht.flatMap((v, i) => [i ? ", " : "", h("a", { href: `#${v.rel}`, onclick: (event: Event) => { event.preventDefault(); oeffne(v.rel); } }, v.titel)]))
        : null,
      imKorb.length
        ? h("small", { class: "leise" }, nurImKorb(m)
          ? `Nur noch im Papierkorb: ${imKorb.map((v) => v.titel).join(", ")}. Löschbar, sobald ${imKorb.length === 1 ? "der Eintrag dort endgültig gelöscht ist" : "die Einträge dort endgültig gelöscht sind"}.`
          : `Im Papierkorb: ${imKorb.map((v) => v.titel).join(", ")}`)
        : null,
      m.verwendet.length || m.fest
        ? null
        : h("div", { class: "medium-frei" }, h("small", { class: "leise" }, "Nicht verwendet"), h("button", { type: "button", class: "leise gefahr", onclick: () => void loesche(m) }, "Löschen")),
    );
  };

  function zeichne(): void {
    const frei = medien.filter((m) => !m.verwendet.length && !m.fest);
    const korb = medien.filter(nurImKorb);
    const chips: [MedienFilter, string][] = [["alle", `Alle (${medien.length})`], ["frei", `Nicht verwendet (${frei.length})`], ["korb", `Nur im Papierkorb (${korb.length})`]];
    kacheln.replaceChildren(...chips.map(([wert, label]) => h("button", {
      type: "button",
      class: filter === wert ? "haupt" : "",
      "aria-pressed": String(filter === wert),
      onclick: () => {
        filter = wert;
        zeichne();
      },
    }, label)));
    const treffer = (filter === "frei" ? frei : filter === "korb" ? korb : medien).filter((m) => m.name.toLowerCase().includes(suche.value.trim().toLowerCase()));
    text.textContent = treffer.length ? "" : "Kein passendes Bild.";
    raster.replaceChildren(...treffer.map(karte));
  }

  suche.addEventListener("input", zeichne);
  host.replaceChildren(
    h("div", { class: "seitenkopf" }, h("h1", {}, "Medien"), h("button", { type: "button", class: "haupt", onclick: () => datei.click() }, "Bilder hochladen"), datei),
    h("p", { class: "leise einleitung" }, "Alle Bilder und wo sie gebraucht werden. Löschen geht nur, wenn nichts ein Bild braucht, auch nichts im Papierkorb."),
    h("div", { class: "medien-werkzeuge" }, kacheln, suche),
    text,
    raster,
  );
  return laden;
}
