import { renderFile } from "../render/to-html.ts";

const rel = process.argv[2];
if (!rel) {
  console.error("Aufruf: npm run render -- briefe/<datei>.md");
  process.exit(1);
}

const { html } = await renderFile(rel);
process.stdout.write(`${html}\n`);
