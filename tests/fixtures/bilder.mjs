/**
 * Zeichnet die Bilder des erfundenen Inhalts neu: Farbverläufe und Balken, keine Fotos.
 * node tests/fixtures/bilder.mjs. Nur nötig, wenn ein Bild dazukommt; die Dateien liegen im Repo.
 * Die Namen sind die, die Inhalt und Code erwarten (FESTE_BILDER in src/design/layout.ts).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ordner = path.join(path.dirname(fileURLToPath(import.meta.url)), "content/media");
fs.mkdirSync(ordner, { recursive: true });

const verlauf = (breite, hoehe, von, bis, kreis) => Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${breite}" height="${hoehe}">
    <defs><linearGradient id="v" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${von}"/><stop offset="1" stop-color="${bis}"/></linearGradient></defs>
    <rect width="100%" height="100%" fill="url(#v)"/>
    <circle cx="${breite * 0.72}" cy="${hoehe * 0.42}" r="${hoehe * 0.28}" fill="${kreis}" fill-opacity="0.35"/>
  </svg>`,
);

const balken = (breite, hoehe, farbe, werte) => Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${breite}" height="${hoehe}">
    <rect width="100%" height="100%" fill="#f4f1ea"/>
    ${werte.map((wert, i) => `<rect x="${40 + i * ((breite - 80) / werte.length)}" y="${hoehe - 30 - wert}" width="${(breite - 80) / werte.length - 24}" height="${wert}" fill="${farbe}"/>`).join("")}
    <rect x="40" y="${hoehe - 30}" width="${breite - 80}" height="2" fill="#333"/>
  </svg>`,
);

const schild = (breite, hoehe, grund, farbe) => Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${breite}" height="${hoehe}">
    <rect width="100%" height="100%" fill="${grund}"/>
    <rect x="${breite * 0.1}" y="${hoehe * 0.3}" width="${breite * 0.8}" height="${hoehe * 0.4}" rx="${hoehe * 0.1}" fill="${farbe}"/>
  </svg>`,
);

const foto = (name, svg) => sharp(svg).jpeg({ quality: 62, mozjpeg: true }).toFile(path.join(ordner, name));
const grafik = (name, svg) => sharp(svg).png({ palette: true, colours: 16, compressionLevel: 9 }).toFile(path.join(ordner, name));

// Titelbilder der festen Seiten.
const titelbilder = {
  "Start-scaled.jpg": ["#1f3d36", "#9db8a1", "#f2e8c9"],
  "About-scaled.jpg": ["#2b3a55", "#a9b7cf", "#f0e3d0"],
  "Angebot-scaled.jpg": ["#4a3b2a", "#c9b79a", "#f5efe2"],
  "Kontakt-scaled.jpg": ["#263238", "#90a4ae", "#eceff1"],
  "Neuigkeiten-scaled.jpg": ["#3b2f4a", "#b7a9cf", "#efe6f5"],
  "Privatperson-scaled.jpg": ["#5a2e2e", "#d1a3a3", "#f6e9e9"],
  "Unternehmen-scaled.jpg": ["#2e4a5a", "#a3c1d1", "#e9f2f6"],
  "Stiftungen-scaled.jpg": ["#3d4a2e", "#bccfa3", "#eff6e9"],
};
for (const [name, [von, bis, kreis]] of Object.entries(titelbilder)) await foto(name, verlauf(1200, 675, von, bis, kreis));
await foto("Portrait.jpg", verlauf(600, 750, "#55606b", "#c7ced6", "#f3e2d2"));

// Die Grafik am Anfang einiger Newsletter.
for (const [nr, werte] of Object.entries({ 7: [60, 90, 40, 120, 80, 100], 8: [100, 70, 110, 50, 90, 130], 9: [40, 60, 80, 100, 120, 140], 10: [130, 110, 90, 100, 60, 80] })) {
  await grafik(`Marktperformance-Newsletter${String(nr).padStart(2, "0")}-1024x220.png`, balken(1024, 220, "#1f3d36", werte));
}

// Logos der erfundenen Partner, das Signet der Startseite und zwei Bilder, die niemand braucht.
await grafik("logo_muster-treuhand.png", schild(400, 120, "#ffffff", "#2b3a55"));
await grafik("logo_beispiel-kanzlei.png", schild(400, 120, "#ffffff", "#5a2e2e"));
await grafik("webclip.png", schild(180, 180, "#1f3d36", "#f2e8c9"));
await grafik("unbenutzt-1.png", balken(640, 200, "#8a6d3b", [50, 80, 110]));
await grafik("unbenutzt-2.png", schild(320, 200, "#eceff1", "#90a4ae"));

for (const name of fs.readdirSync(ordner).sort()) console.log(String(fs.statSync(path.join(ordner, name)).size).padStart(7), name);
