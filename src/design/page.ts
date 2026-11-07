import { allgemein, ortZeile, telefonLink } from "../content/allgemein.ts";
import { aktuell, aktuelleLinks, istOnline, menueSeiten } from "../content/document.ts";
import { ANGEBOT, KONTAKT } from "../content/menue.ts";
import { angebote, istAngebot } from "./angebote.ts";
import type { PageView } from "./layout.ts";
import { absoluteUrl, DEFAULT_DESCRIPTION, DEFAULT_IMAGE, jsonLd, organization, SITE_NAME, siteUrl } from "./seo.ts";

function esc(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function current(href: string, here: string): boolean {
  if (href === "/") return here === "/";
  return here === href || here.startsWith(`${href}/`);
}

/**
 * «Unser Angebot» mit den drei Angebotsseiten. Auf dem Desktop wird der Kopf beim Darüberfahren
 * (oder mit Tab) eine Zeile höher; im Handymenü stehen die drei eingerückt darunter.
 */
function angebotNav(here: string): string {
  const angebot = aktuell("/angebot");
  const oben = current(angebot, here) || istAngebot(here) ? ' aria-current="page"' : "";
  const unter = angebote().map(({ href, label }) => {
    const mark = here === href ? ' aria-current="page"' : "";
    return `<a href="${href}"${mark}>${esc(label)}</a>`;
  }).join("");
  return `<div class="nav-gruppe"><a href="${angebot}"${oben}>Unser Angebot</a><div class="nav-unter">${unter}</div></div>`;
}

/** Alles im Kopf, was Suchmaschinen und Vorschauen beim Teilen lesen. */
function headMeta(view: PageView): string {
  const url = absoluteUrl(view.here || "/");
  const image = absoluteUrl(view.image);
  const tags = [
    `<meta name="description" content="${esc(view.description)}">`,
    view.noindex ? `<meta name="robots" content="noindex">` : `<link rel="canonical" href="${esc(url)}">`,
    `<meta property="og:site_name" content="${SITE_NAME}">`,
    `<meta property="og:locale" content="de_CH">`,
    `<meta property="og:type" content="${view.article ? "article" : "website"}">`,
    `<meta property="og:title" content="${esc(view.title)}">`,
    `<meta property="og:description" content="${esc(view.description)}">`,
    `<meta property="og:url" content="${esc(url)}">`,
    `<meta property="og:image" content="${esc(image)}">`,
    ...(view.imageAlt ? [`<meta property="og:image:alt" content="${esc(view.imageAlt)}">`] : []),
    `<meta name="twitter:card" content="summary_large_image">`,
  ];
  if (view.noindex) return tags.join("\n  ");
  if (view.article && /^\d{4}-\d{2}-\d{2}$/.test(view.article.datum)) {
    tags.push(`<meta property="article:published_time" content="${view.article.datum}">`);
    const publisher = organization();
    tags.push(jsonLd({
      "@context": "https://schema.org",
      "@type": "BlogPosting",
      headline: view.title.replace(/ – Advocat Finanz$/, ""),
      description: view.description,
      image: image,
      datePublished: view.article.datum,
      inLanguage: "de-CH",
      mainEntityOfPage: url,
      author: { "@type": "Organization", "@id": publisher["@id"], name: publisher.name, url: publisher.url },
      publisher: { "@type": "Organization", "@id": publisher["@id"], name: publisher.name, logo: publisher.logo },
    }));
  }
  if (view.here === "/") {
    tags.push(jsonLd({
      "@context": "https://schema.org",
      "@graph": [
        organization(),
        { "@type": "WebSite", "@id": `${siteUrl()}/#website`, url: `${siteUrl()}/`, name: SITE_NAME, inLanguage: "de-CH" },
      ],
    }));
  }
  return tags.join("\n  ");
}

export function pageShell(view: PageView): string {
  const year = new Date().getFullYear();
  const angaben = allgemein();
  const adressText = `${esc(angaben.strasse)} | ${esc(ortZeile(angaben))}`;
  const adresse = angaben.karte ? `<a href="${esc(angaben.karte)}">${adressText}</a>` : `<span>${adressText}</span>`;
  // Home steht immer zuerst, «Kontakt» ist ein eigener Knopf. Dazwischen die Reihenfolge aus der Redaktion.
  const link = (href: string, label: string) => {
    const ziel = aktuell(href);
    const mark = current(ziel, view.here) ? ' aria-current="page"' : "";
    return `<a href="${ziel}"${mark}>${esc(label)}</a>`;
  };
  const links = [
    link("/", "Home"),
    ...menueSeiten().map(({ rel, href, label }) => (rel === ANGEBOT ? angebotNav(view.here) : link(href, label))),
  ].join("");
  const kontakt = (klasse: string) => (istOnline(KONTAKT) ? `<a class="btn btn-solid ${klasse}" href="/kontakt">Kontakt</a>` : "");
  // Links im Text und im Layout auf alte Adressen zeigen auf die heutigen (umbenannte Seiten, alte Newsletter-Adressen).
  return aktuelleLinks(`<!DOCTYPE html>
<html lang="de-CH">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(view.title)}</title>
  ${headMeta(view)}
  <link rel="icon" href="/brand/favicon.png" type="image/png" sizes="32x32">
  <link rel="apple-touch-icon" href="/brand/webclip.png">
  <link rel="preload" href="/fonts/manrope-400.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="preload" href="/fonts/marcellus-400.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="stylesheet" href="/heft.css">
</head>
<body>
  <a class="springen" href="#inhalt">Zum Inhalt springen</a>
  <header class="kopf">
    <div class="kopf-innen">
      <a class="logo" href="/"><img src="/brand/logo.svg" alt="Advocat Finanz" width="231" height="50"></a>
      <nav id="menu" class="nav" aria-label="Hauptnavigation">
        ${links}
        ${kontakt("kontakt-mobil")}
      </nav>
      ${kontakt("kontakt-desktop")}
      <button class="burger" type="button" aria-expanded="false" aria-controls="menu" aria-label="Menü"><span></span><span></span><span></span></button>
    </div>
  </header>
  <main id="inhalt" tabindex="-1">${view.main}</main>
  <footer class="fuss">
    <div class="fuss-innen">
      <div class="fuss-text">
        <p><strong>${esc(angaben.firma)}</strong><br>
        ${adresse}<span class="trenner"> | </span><a href="tel:${esc(telefonLink(angaben.telefon))}">Tel. ${esc(angaben.telefon)}</a><span class="trenner"> | </span><a href="mailto:${esc(angaben.email)}">${esc(angaben.email)}</a></p>
        <p class="copy"><span>©${year} ${esc(angaben.firma)}</span><span class="trenner"> | </span><a href="/impressum">Impressum</a><span class="trenner"> | </span><a href="/disclaimer">Disclaimer</a><span class="trenner"> | </span><a href="/datenschutz">Datenschutz</a></p>
      </div>
      <a class="fuss-claim" href="/"><img src="/brand/claim-footer.png" alt="Vermögen und Recht – ein Leben lang" width="240" height="48" loading="lazy"></a>
    </div>
  </footer>
  <script src="/site.js" defer></script>
</body>
</html>
`);
}

export function notFoundPage(): string {
  return pageShell({
    title: "Seite nicht gefunden – Advocat Finanz",
    here: "",
    description: DEFAULT_DESCRIPTION,
    image: DEFAULT_IMAGE,
    noindex: true,
    main: `<div class="inhalt prosa"><h1>Seite nicht gefunden</h1><p>Diese Seite gibt es nicht.</p><p class="aktionen"><a class="btn btn-ghost" href="/">Zur Startseite</a></p></div>`,
  });
}
