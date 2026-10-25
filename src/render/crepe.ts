import { ensureDom } from "./dom.ts";

interface CrepeInstance {
  editor: { action(action: unknown): string };
  create(): Promise<unknown>;
}

interface CrepeStatic {
  new (config: { root: HTMLElement; defaultValue: string; features: Record<string, boolean> }): CrepeInstance;
  Feature: {
    CodeMirror: string;
    Latex: string;
    AI: string;
    TopBar: string;
    Cursor: string;
    LinkTooltip: string;
    BlockEdit: string;
    Toolbar: string;
    Placeholder: string;
    ImageBlock: string;
  };
}

/**
 * Dieselbe Crepe-Konfiguration für die Redaktion und fürs HTML.
 * CodeMirror und LaTeX bleiben aus: die Briefe brauchen sie nicht,
 * und sie ziehen eine zweite Editor-Welt in den Setzer.
 * Der Import von Milkdown passiert erst nach der DOM-Attrappe,
 * sonst merkt sich Vue ein leeres document.
 */
let crepePromise: Promise<CrepeInstance> | null = null;
let queue: Promise<unknown> = Promise.resolve();

async function loadCrepe(): Promise<CrepeStatic> {
  ensureDom();
  const mod = (await import("@milkdown/crepe")) as unknown as { Crepe: CrepeStatic };
  return mod.Crepe;
}

export async function crepeFeatures(): Promise<Record<string, boolean>> {
  const Crepe = await loadCrepe();
  return {
    [Crepe.Feature.CodeMirror]: false,
    [Crepe.Feature.Latex]: false,
    [Crepe.Feature.AI]: false,
    [Crepe.Feature.TopBar]: false,
    [Crepe.Feature.Cursor]: false,
    [Crepe.Feature.LinkTooltip]: false,
  };
}

async function crepe(): Promise<CrepeInstance> {
  crepePromise ??= (async () => {
    const Crepe = await loadCrepe();
    const features = await crepeFeatures();
    const window = globalThis.window as Window;
    const root = window.document.createElement("div");
    window.document.body.appendChild(root);
    const editor = new Crepe({
      root,
      defaultValue: "",
      features: {
        ...features,
        [Crepe.Feature.BlockEdit]: false,
        [Crepe.Feature.Toolbar]: false,
        [Crepe.Feature.Placeholder]: false,
        [Crepe.Feature.ImageBlock]: false,
      },
    });
    await editor.create();
    return editor;
  })();
  return crepePromise;
}

/** Eine Crepe-Instanz, Aufrufe nacheinander. Dieselbe Satz-Konfiguration wie die Redaktion, ohne Werkzeugleiste. */
export function markdownToHtml(markdown: string): Promise<string> {
  const run = queue.then(async () => {
    ensureDom();
    const editor = await crepe();
    const { getHTML, replaceAll } = (await import("@milkdown/utils")) as unknown as {
      getHTML: () => unknown;
      replaceAll: (markdown: string, flush?: boolean) => unknown;
    };
    editor.editor.action(replaceAll(markdown, true));
    return editor.editor.action(getHTML());
  });
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}
