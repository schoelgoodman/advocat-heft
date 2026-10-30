import type { PageView } from "./layout.ts";
import { absoluteUrl, DEFAULT_DESCRIPTION, DEFAULT_IMAGE, jsonLd, organization, SITE_NAME, siteUrl } from "./seo.ts";

function esc(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

const NAV: Array<[string, string]> = [
  ["/", "Home"],
  ["/angebot", "Unser Angebot"],
  ["/ueber-uns", "Über uns"],
  ["/neuigkeiten", "Neuigkeiten"],
];

function current(href: string, here: string): boolean {
  if (href === "/") return here === "/";
  return here === href || here.startsWith(`${href}/`);
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
  const links = NAV.map(([href, label]) => {
    const mark = current(href, view.here) ? ' aria-current="page"' : "";
    return `<a href="${href}"${mark}>${label}</a>`;
  }).join("");
  return `<!DOCTYPE html>
<html lang="de-CH">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(view.title)}</title>
  ${headMeta(view)}
  <link rel="icon" href="/brand/favicon.png" type="image/png" sizes="32x32">
  <link rel="apple-touch-icon" href="/brand/webclip.png">
  <link rel="preload" href="/fonts/manrope-400.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="stylesheet" href="/heft.css">
  <script>try{if(localStorage.getItem("advocat-cookie")==="1")document.documentElement.classList.add("cookie-ok")}catch(e){}</script>
</head>
<body>
  <header class="kopf">
    <div class="kopf-innen">
      <a class="logo" href="/"><img src="/media/Logo_Advocat_Finanz_2c.png" alt="Advocat Finanz" width="231" height="50"></a>
      <nav id="menu" class="nav" aria-label="Hauptnavigation">
        ${links}
        <a class="btn btn-solid kontakt-mobil" href="/kontakt">Kontakt</a>
      </nav>
      <a class="btn btn-solid kontakt-desktop" href="/kontakt">Kontakt</a>
      <button class="burger" type="button" aria-expanded="false" aria-controls="menu" aria-label="Menü"><span></span><span></span><span></span></button>
    </div>
  </header>
  <main>${view.main}</main>
  <footer class="fuss">
    <div class="fuss-innen">
      <div class="fuss-text">
        <p><strong>Advocat Finanz AG</strong><br>
        <a href="https://maps.app.goo.gl/poLBfgcPVnj2UWaW9">Rosenbergstrasse 50 | CH-9000 St. Gallen</a><span class="trenner"> | </span><a href="tel:+41712423030">Tel. +41 71 242 30 30</a><span class="trenner"> | </span><a href="mailto:office@advocat-finanz.ch">office@advocat-finanz.ch</a></p>
        <p class="copy"><span>©${year} Advocat Finanz AG</span><span class="trenner"> | </span><a href="/impressum">Impressum</a><span class="trenner"> | </span><a href="/disclaimer">Disclaimer</a><span class="trenner"> | </span><a href="/datenschutz">Datenschutz</a></p>
      </div>
      <a class="fuss-claim" href="/"><img src="/brand/claim-footer.png" alt="Vermögen und Recht – ein Leben lang" width="240" height="48" loading="lazy"></a>
    </div>
  </footer>
  <div id="cookie-notice" class="cookies" role="dialog" aria-label="Cookie Compliance">
    <p>Diese Website benutzt Cookies. Wenn Sie die Website weiter nutzen, gehen wir von Ihrem Einverständnis aus.</p>
    <button type="button" class="cookie-ok">OK</button>
    <button type="button" class="cookie-x" aria-label="Schliessen">×</button>
  </div>
  <script src="/site.js" defer></script>
</body>
</html>
`;
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
