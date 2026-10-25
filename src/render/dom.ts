import { Window } from "happy-dom";

let registered = false;

/** Eine gemeinsame Browser-Attrappe, damit Milkdown auf dem Server HTML schreiben kann. */
export function ensureDom(): Window {
  if (registered) return globalThis.window as unknown as Window;
  const window = new Window({ url: "https://advocat.local/" });
  const names = [
    "window",
    "document",
    "navigator",
    "HTMLElement",
    "Element",
    "Node",
    "Text",
    "DocumentFragment",
    "MutationObserver",
    "DOMParser",
    "NodeFilter",
    "Range",
    "Comment",
    "Document",
    "SVGElement",
    "customElements",
    "getSelection",
    "requestAnimationFrame",
    "cancelAnimationFrame",
    "getComputedStyle",
    "addEventListener",
    "removeEventListener",
    "dispatchEvent",
    "CustomEvent",
    "Event",
    "KeyboardEvent",
    "InputEvent",
    "ClipboardEvent",
    "DragEvent",
  ] as const;
  for (const name of names) {
    const raw = window[name as keyof Window];
    if (raw === undefined) continue;
    const value = typeof raw === "function" ? raw.bind(window) : raw;
    try {
      Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
    } catch {
      // Node schützt einzelne Namen. Milkdown liest sie erst beim Aufbau.
    }
  }
  registered = true;
  return window;
}
