import fs from "node:fs";
import path from "node:path";
import { defineConfig } from "vite";

/** Baut nur die Redaktion. Der Setzer bleibt TypeScript und läuft über tsx. */
export default defineConfig({
  build: {
    outDir: "dist/redaktion",
    emptyOutDir: true,
    rollupOptions: {
      input: path.resolve("src/editor/index.html"),
    },
  },
  plugins: [
    {
      name: "editor-index-an-die-wurzel",
      apply: "build",
      closeBundle() {
        const nested = path.resolve("dist/redaktion/src/editor/index.html");
        const flat = path.resolve("dist/redaktion/index.html");
        if (!fs.existsSync(nested)) return;
        fs.copyFileSync(nested, flat);
        fs.rmSync(path.resolve("dist/redaktion/src"), { recursive: true, force: true });
      },
    },
  ],
});
