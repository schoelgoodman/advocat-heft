import { publicPath, type ContentDocument } from "../content/document.ts";
import type { RegisterLink } from "../content/load.ts";

function esc(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function formatDatum(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return "";
  return new Intl.DateTimeFormat("de-CH", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/Zurich",
  }).format(new Date(`${iso}T12:00:00+01:00`));
}

function kicker(doc: ContentDocument): string {
  const datum = formatDatum(doc.datum);
  if (doc.art === "brief") {
    const nummer = doc.nummer != null ? `Nr. ${doc.nummer}` : "Brief";
    return datum ? `${nummer} · ${datum}` : nummer;
  }
  if (doc.art === "recht") return datum ? `Recht · ${datum}` : "Recht";
  return datum ? `Kapitel · ${datum}` : "Kapitel";
}

function tree(): string {
  return `<svg class="signet" viewBox="0 0 32 40" aria-hidden="true">
    <path d="M16 38 V18" fill="none" stroke="currentColor" stroke-width="1.4"/>
    <circle cx="16" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="1.4"/>
    <path d="M16 16 v6 M12 22 h8" fill="none" stroke="currentColor" stroke-width="1.2"/>
  </svg>`;
}

export function heftPage(options: {
  doc: ContentDocument;
  bodyHtml: string;
  register: RegisterLink[];
  briefs: ContentDocument[];
  currentHref: string;
}): string {
  const { doc, bodyHtml, register, briefs, currentHref } = options;
  const nav = register
    .map((link) => {
      const current = link.href === currentHref ? ' aria-current="page"' : "";
      return `<a href="${esc(link.href)}"${current}>${esc(link.label)}</a>`;
    })
    .join("");
  const legal = [
    ["impressum", "Impressum"],
    ["datenschutz", "Datenschutz"],
    ["disclaimer", "Disclaimer"],
  ]
    .map(([slug, label]) => `<a href="/${slug}">${label}</a>`)
    .join("");
  const archive =
    doc.rel === "kapitel/neuigkeiten.md"
      ? `<section class="archiv"><h2>Ausgaben</h2><ol>${briefs
          .map((brief) => {
            const datum = formatDatum(brief.datum);
            const nr = brief.nummer != null ? `Nr. ${brief.nummer}` : "Brief";
            return `<li><a href="${esc(publicPath(brief.rel))}"><span>${esc(nr)}</span> ${esc(brief.titel)}</a><time>${esc(datum)}</time></li>`;
          })
          .join("")}</ol></section>`
      : "";

  return `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(doc.titel)} · Advocat Finanz</title>
  <link rel="stylesheet" href="/heft.css">
</head>
<body>
  <div class="heft">
    <aside class="register">
      <a class="wortmarke" href="/">Advocat Finanz</a>
      <p class="anspruch">Vermögen und Recht, ein Leben lang</p>
      <nav>${nav}</nav>
      ${tree()}
    </aside>
    <article>
      <header>
        <p class="kicker">${esc(kicker(doc))}</p>
        <h1>${esc(doc.titel)}</h1>
      </header>
      <div class="satz">${bodyHtml}</div>
      ${archive}
    </article>
  </div>
  <footer class="schluss">${legal}</footer>
</body>
</html>
`;
}
