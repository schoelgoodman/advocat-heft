import fs from "node:fs/promises";
import path from "node:path";
import { schreibeAtomar } from "../content/atomar.ts";
import { siteDir } from "../paths.ts";

/**
 * Das Ergebnis des letzten Setzens. Die Seite schreibt es, die Redaktion liest es (site/ ist dort nur
 * lesbar). So sieht Patrick, wenn ein Speichern nicht auf die Website gekommen ist.
 */
export interface SetzStatus {
  ok: boolean;
  zeit: string;
  fehler?: string;
}

export async function schreibeStatus(fehler?: unknown): Promise<void> {
  const status: SetzStatus = { ok: fehler === undefined, zeit: new Date().toISOString() };
  if (fehler !== undefined) status.fehler = (fehler instanceof Error ? fehler.message : String(fehler)).slice(0, 1000);
  await schreibeAtomar(path.join(siteDir(), "status.json"), JSON.stringify(status)).catch((error: unknown) => {
    console.error("Status nicht geschrieben:", error instanceof Error ? error.message : error);
  });
}

export async function leseStatus(): Promise<SetzStatus | null> {
  try {
    return JSON.parse(await fs.readFile(path.join(siteDir(), "status.json"), "utf8")) as SetzStatus;
  } catch {
    return null;
  }
}
