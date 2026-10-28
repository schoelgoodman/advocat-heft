import fs from "node:fs/promises";
import path from "node:path";
import { Window } from "happy-dom";
import mammoth from "mammoth";
import { contentDir } from "../paths.ts";

/**
 * Word-Datei (.docx) zu Markdown für die Redaktion. mammoth liest Word und gibt
 * schlichtes HTML. Davon bleibt nur, was die Website kennt: Zwischentitel, Absätze,
 * Listen, Zitate, fett, kursiv, Links und Bilder. Farben, Schriften und Tabellen fallen weg.
 */

export interface WordImport {
  markdown: string;
  /** Die erste Überschrift, als Vorschlag fürs Thema. */
  thema: string;
  /** Neu gespeicherte Bilder, relativ zum Inhalt (media/…). */
  bilder: string[];
  /** Bilder in Formaten, die ein Browser nicht zeigt (EMF, WMF, TIFF). */
  ausgelassen: number;
}

const BILD_ENDUNG: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/svg+xml": ".svg",
};

function inline(node: Node): string {
  let out = "";
  for (const child of node.childNodes) {
    if (child.nodeType === 3) {
      // Zeichen, die Markdown sonst als Auszeichnung liest.
      out += (child.textContent ?? "").replace(/\s+/g, " ").replace(/([\\*_`[\]])/g, "\\$1");
      continue;
    }
    if (child.nodeType !== 1) continue;
    const el = child as Element;
    const tag = el.tagName.toLowerCase();
    const innen = inline(el);
    if (tag === "strong" || tag === "b") out += umschliesse(innen, "**");
    else if (tag === "em" || tag === "i") out += umschliesse(innen, "*");
    else if (tag === "a") {
      const href = el.getAttribute("href") ?? "";
      out += /^(https?:|mailto:)/.test(href) && innen.trim() ? `[${innen.trim()}](${href})` : innen;
    } else if (tag === "br") out += "  \n";
    else if (tag === "img") {
      const src = el.getAttribute("src") ?? "";
      if (src) out += `![${(el.getAttribute("alt") ?? "").replace(/[[\]]/g, "")}](${src})`;
    } else out += innen;
  }
  return out;
}

/** Fett oder kursiv. Leerzeichen am Rand gehören vor und hinter die Sterne, sonst liest Markdown sie nicht. */
function umschliesse(text: string, zeichen: string): string {
  const match = text.match(/^(\s*)([\s\S]*?)(\s*)$/)!;
  return match[2] ? `${match[1]}${zeichen}${match[2]}${zeichen}${match[3]}` : text;
}

/** Ein Absatz, der ganz fett und kurz ist, ist in Word oft ein Zwischentitel ohne Formatvorlage. */
function fetterTitel(text: string): string | null {
  const match = text.match(/^\*\*([^*]+)\*\*$/);
  if (!match || match[1].length > 120 || /[.,;:]$/.test(match[1].trim())) return null;
  return match[1].trim();
}

/** Von Hand gesetzte Aufzählungszeichen, wie Word sie beim Einfügen oft hinterlässt. */
const HANDPUNKT = /^[•·▪◦‣–-]\s+/;

function blocks(parent: Element, out: string[], tiefe = 0): void {
  for (const child of parent.children) {
    const tag = child.tagName.toLowerCase();
    if (/^h[1-6]$/.test(tag)) {
      const text = inline(child).trim();
      // Die Newsletter haben eine Ebene Zwischentitel. Alles wird zu «###».
      if (text) out.push(`### ${text.replace(/^\*\*(.*)\*\*$/, "$1")}`);
    } else if (tag === "p") {
      const text = inline(child).trim();
      if (!text) continue;
      const titel = fetterTitel(text);
      if (titel) out.push(`### ${titel}`);
      else if (HANDPUNKT.test(text)) {
        // Aufeinanderfolgende Handpunkte werden eine Liste.
        const punkt = `- ${text.replace(HANDPUNKT, "")}`;
        const davor = out.at(-1);
        if (davor != null && /^- /.test(davor) && !davor.includes("\n\n")) out[out.length - 1] = `${davor}\n${punkt}`;
        else out.push(punkt);
      } else out.push(text);
    } else if (tag === "ul" || tag === "ol") {
      const punkte: string[] = [];
      let n = 1;
      for (const li of child.children) {
        if (li.tagName.toLowerCase() !== "li") continue;
        const kopie = li.cloneNode(true) as Element;
        const unter = [...kopie.children].filter((c) => /^(ul|ol)$/i.test(c.tagName));
        for (const liste of unter) liste.remove();
        const zeichen = tag === "ol" ? `${n++}.` : "-";
        punkte.push(`${"   ".repeat(tiefe)}${zeichen} ${inline(kopie).trim()}`);
        for (const liste of [...li.children].filter((c) => /^(ul|ol)$/i.test(c.tagName))) {
          const innen: string[] = [];
          const huelle = li.ownerDocument.createElement("div");
          huelle.append(liste.cloneNode(true));
          blocks(huelle, innen, tiefe + 1);
          punkte.push(...innen);
        }
      }
      if (punkte.length) out.push(punkte.join("\n"));
    } else if (tag === "blockquote") {
      const innen: string[] = [];
      blocks(child, innen, tiefe);
      if (innen.length) out.push(innen.join("\n\n").split("\n").map((zeile) => `> ${zeile}`).join("\n"));
    } else if (tag === "table") {
      // Tabellen kennt die Website nicht. Jede Zeile wird ein Absatz, Zellen mit „ · “ getrennt.
      for (const row of child.querySelectorAll("tr")) {
        const zellen = [...row.querySelectorAll("td, th")].map((cell) => inline(cell).trim()).filter(Boolean);
        if (zellen.length) out.push(zellen.join(" · "));
      }
    } else {
      blocks(child, out, tiefe);
    }
  }
}

export async function importWord(bytes: Buffer): Promise<WordImport> {
  const bilder: string[] = [];
  let ausgelassen = 0;
  const stamp = Date.now().toString(36);
  const result = await mammoth.convertToHtml(
    { buffer: bytes },
    {
      convertImage: mammoth.images.imgElement(async (image) => {
        const ext = BILD_ENDUNG[image.contentType];
        if (!ext) {
          ausgelassen += 1;
          return { src: "" };
        }
        const name = `word-${stamp}-${bilder.length + 1}${ext}`;
        const file = path.join(contentDir(), "media", name);
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(file, await image.readAsBuffer());
        bilder.push(`media/${name}`);
        return { src: `../media/${name}` };
      }),
    },
  );

  const window = new Window();
  const document = window.document;
  document.body.innerHTML = result.value;
  const out: string[] = [];
  blocks(document.body as unknown as Element, out);
  await window.happyDOM.close();

  // Die erste Überschrift ist meist das Thema. Sie kommt ins Titelfeld, nicht in den Text.
  let thema = "";
  if (out[0]?.startsWith("### ")) thema = out.shift()!.slice(4).replace(/\\([\\*_`[\]])/g, "$1").trim();
  return { markdown: out.join("\n\n").trim(), thema, bilder, ausgelassen };
}
