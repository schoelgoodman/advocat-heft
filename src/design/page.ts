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

export function pageShell(options: { title: string; here: string; main: string }): string {
  const year = new Date().getFullYear();
  const links = NAV.map(([href, label]) => {
    const mark = current(href, options.here) ? ' aria-current="page"' : "";
    return `<a href="${href}"${mark}>${label}</a>`;
  }).join("");
  return `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(options.title)}</title>
  <link rel="icon" href="/brand/favicon.png" type="image/png" sizes="32x32">
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
  <main>${options.main}</main>
  <footer class="fuss">
    <div class="fuss-innen">
      <div class="fuss-text">
        <p><strong>Advocat Finanz AG</strong><br>
        <a href="https://maps.app.goo.gl/poLBfgcPVnj2UWaW9">Rosenbergstrasse 50 | CH-9000 St. Gallen</a> | <a href="tel:+41712423030">Tel. +41 71 242 30 30</a> | <a href="mailto:office@advocat-finanz.ch">office@advocat-finanz.ch</a></p>
        <p class="copy">©${year} Advocat Finanz AG | <a href="/impressum">Impressum</a> | <a href="/disclaimer">Disclaimer</a> | <a href="/datenschutz">Datenschutz</a></p>
      </div>
      <a class="fuss-claim" href="/"><img src="/brand/claim-footer.png" alt="Vermögen und Recht – ein Leben lang"></a>
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
    main: `<div class="inhalt prosa"><h1>Seite nicht gefunden</h1><p>Diese Seite gibt es nicht.</p><p class="aktionen"><a class="btn btn-ghost" href="/">Zur Startseite</a></p></div>`,
  });
}
