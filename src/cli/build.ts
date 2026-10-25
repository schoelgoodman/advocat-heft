import { buildSite } from "../render/build.ts";

const result = await buildSite();
console.log(`${result.pages} Seiten. Start: ${result.index}`);
