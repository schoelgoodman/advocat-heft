import { timingSafeEqual } from "node:crypto";
import type http from "node:http";
import path from "node:path";

/**
 * Wer und was in die Redaktion darf. Ohne Zustand, damit es sich testen lässt (zugang.test.ts).
 */

/** Den Header setzt nginx nach tinyauth (advocat-redaktion/swag.nix). Ein Browser kann ihn nicht vorgeben: nginx überschreibt ihn. */
export const SCHLUESSEL_HEADER = "x-redaktion-schluessel";

/**
 * Kommt die Anfrage über SWAG und tinyauth? Der Container hängt im Netz `internal`, das auch andere
 * Dienste erreichen. Ohne diesen Schlüssel könnte jeder davon die API direkt rufen, an der Anmeldung vorbei.
 */
export function schluesselPasst(req: http.IncomingMessage, schluessel: string): boolean {
  const wert = req.headers[SCHLUESSEL_HEADER];
  if (typeof wert !== "string" || !schluessel) return false;
  const a = Buffer.from(wert);
  const b = Buffer.from(schluessel);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Schutz gegen Anfragen, die eine fremde Seite im Browser von Patrick auslöst (CSRF). Der Browser
 * schickt das tinyauth-Cookie auch von anderen Diensten unter derselben Domain mit; das Origin
 * verrät, woher die Anfrage kommt. Lesen bleibt erlaubt, Ändern nur von der Redaktion selbst.
 */
export function fremdeHerkunft(req: http.IncomingMessage): boolean {
  if (req.method === "GET" || req.method === "HEAD") return false;
  const origin = req.headers.origin;
  if (!origin) return req.headers["sec-fetch-site"] === "cross-site";
  let host: string;
  try {
    host = new URL(origin).host;
  } catch {
    return true;
  }
  const eigene = [req.headers.host, req.headers["x-forwarded-host"]].flatMap((value) => String(value ?? "").split(","));
  return !eigene.map((value) => value.trim()).includes(host);
}

/** Bildformate, die die Redaktion annimmt. Kein SVG: Es kann Skript enthalten, und Neo entfernt den Sandbox-Header. */
export const BILD_ENDUNGEN = [".png", ".jpg", ".jpeg", ".gif", ".webp"];

export function bildEndung(dateiname: string): string | null {
  const ext = path.extname(dateiname).toLowerCase().replace(/[^.a-z0-9]/g, "");
  return BILD_ENDUNGEN.includes(ext) ? ext : null;
}

/**
 * Eine Adresse mit Schrägstrich am Ende, ohne ihn. Führende Schrägstriche fallen zu einem zusammen:
 * Aus «//boese.example/» darf nie «Location: //boese.example» werden, das führte auf die fremde Seite.
 */
export function ohneEndSchraegstrich(pathname: string): string {
  return `/${pathname.replace(/^[/\\]+|\/+$/g, "")}`;
}

/**
 * Unter der Adresse, die Google führen soll? Dieselbe Seite läuft auch unter advocat.<domain>; das soll
 * nie als Doppel im Suchindex landen. nginx reicht den Namen weiter, den der Besucher aufgerufen hat.
 */
export function kanonischerHost(req: http.IncomingMessage, siteUrl: string): boolean {
  const host = String(req.headers["x-forwarded-host"] ?? req.headers.host ?? "").split(",")[0].trim().toLowerCase();
  return host === new URL(siteUrl).host;
}
