import path from "node:path";
import { fileURLToPath } from "node:url";

/** Repo-Wurzel. Inhalt liegt nie hier drin, nur der Code, der ihn setzt. */
export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Markdown, Bilder und das Inhalts-Git.
 * Lokal der gitignorierte Ordner `dev-content/`.
 * Auf Neo das Appdata-Volume, gesetzt über CONTENT_DIR.
 */
export function contentDir(): string {
  return path.resolve(process.env.CONTENT_DIR ?? path.join(repoRoot, "dev-content"));
}

/** Generiertes HTML. Steht nicht im Code-Repo. */
export function siteDir(): string {
  return path.resolve(process.env.SITE_DIR ?? path.join(repoRoot, "site"));
}
