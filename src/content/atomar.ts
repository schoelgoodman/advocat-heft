import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

/**
 * Schreibt erst daneben und benennt dann um. Der Container `seite` liest den Inhalt, während die
 * Redaktion speichert; so sieht er die Datei ganz oder gar nicht, nie halb.
 */
export async function schreibeAtomar(file: string, text: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${randomBytes(4).toString("hex")}.tmp`;
  try {
    await fs.writeFile(tmp, text, "utf8");
    await fs.rename(tmp, file);
  } catch (error) {
    await fs.rm(tmp, { force: true });
    throw error;
  }
}
