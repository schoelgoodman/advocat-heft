/**
 * Was Suchmaschinen und Vorschauen (Google, LinkedIn, WhatsApp) über eine Seite lesen.
 * Der Text kommt aus dem Inhalt; hier steht nur, wie er in den Kopf der Seite kommt.
 */

export const SITE_NAME = "Advocat Finanz";

/** Ersatz, wenn eine Seite keinen eigenen Absatz hat. */
export const DEFAULT_DESCRIPTION =
  "Advocat Finanz AG in St. Gallen: Vermögen und Recht – ein Leben lang. Beratung für Privatpersonen, Unternehmen und Stiftungen.";

/** Ersatz, wenn eine Seite kein eigenes Bild hat. */
export const DEFAULT_IMAGE = "/media/Logo_Advocat_Finanz_2c.png";

/**
 * Die Adresse, unter der die Seite gefunden werden soll: für canonical, Sitemap und Vorschaubilder.
 * Läuft die Seite auch unter advocat.<domain>, zeigt canonical trotzdem hierhin.
 */
export function siteUrl(): string {
  return (process.env.SITE_URL || "https://advocat-finanz.ch").replace(/\/+$/, "");
}

export function absoluteUrl(href: string): string {
  return new URL(href, `${siteUrl()}/`).href;
}

/** Höchstens `limit` Zeichen, an einer Wortgrenze geschnitten. Google zeigt etwa 155. */
export function clip(text: string, limit = 158): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= limit) return clean;
  const cut = clean.slice(0, limit - 1);
  const at = cut.lastIndexOf(" ");
  return `${(at > limit * 0.6 ? cut.slice(0, at) : cut).replace(/[\s,;:–-]+$/, "")}…`;
}

/** JSON-LD darf im Script kein `</script>` enthalten. */
export function jsonLd(data: unknown): string {
  return `<script type="application/ld+json">${JSON.stringify(data).replaceAll("<", "\\u003c")}</script>`;
}

export function organization(): Record<string, unknown> {
  return {
    "@type": "FinancialService",
    "@id": `${siteUrl()}/#organisation`,
    name: "Advocat Finanz AG",
    url: `${siteUrl()}/`,
    logo: absoluteUrl("/media/Logo_Advocat_Finanz_2c.png"),
    image: absoluteUrl("/media/Logo_Advocat_Finanz_2c.png"),
    slogan: "Vermögen und Recht – ein Leben lang",
    telephone: "+41 71 242 30 30",
    email: "office@advocat-finanz.ch",
    address: {
      "@type": "PostalAddress",
      streetAddress: "Rosenbergstrasse 50",
      postalCode: "9000",
      addressLocality: "St. Gallen",
      addressRegion: "SG",
      addressCountry: "CH",
    },
    areaServed: "CH",
  };
}

export interface SitemapEntry {
  href: string;
  /** ISO-Datum oder leer. */
  lastmod: string;
}

function xmlEsc(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export function sitemapXml(entries: SitemapEntry[]): string {
  const urls = entries.map((entry) => {
    const lastmod = /^\d{4}-\d{2}-\d{2}$/.test(entry.lastmod) ? `<lastmod>${entry.lastmod}</lastmod>` : "";
    return `  <url><loc>${xmlEsc(absoluteUrl(entry.href))}</loc>${lastmod}</url>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join("\n")}
</urlset>
`;
}

export function robotsTxt(): string {
  return `User-agent: *
Disallow: /api/
Disallow: /redaktion

Sitemap: ${siteUrl()}/sitemap.xml
`;
}
