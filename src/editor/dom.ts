/** Kleine Helfer fürs DOM. Text kommt immer als Textknoten in die Seite, nie als HTML. */

type Attr = Record<string, string | boolean | number | ((event: never) => void) | null | undefined>;
type Kind = Node | string | null | false | undefined;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attr: Attr = {}, ...kinder: Kind[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [name, wert] of Object.entries(attr)) {
    if (wert == null || wert === false) continue;
    if (typeof wert === "function") el.addEventListener(name.slice(2), wert as EventListener);
    else if (wert === true) el.setAttribute(name, "");
    else el.setAttribute(name, String(wert));
  }
  for (const kind of kinder) if (kind) el.append(kind);
  return el;
}

let hinweis: HTMLElement | null = null;
let hinweisTimer: number | undefined;

/** Eine kurze Meldung unten. Mit `aktion` bleibt sie länger, für «Rückgängig». */
export function toast(text: string, aktion?: { label: string; aus: () => void }, fehler = false): void {
  hinweis ??= document.body.appendChild(h("div", { class: "toast", role: "status", "aria-live": "polite" }));
  const el = hinweis;
  el.replaceChildren(text);
  if (aktion) {
    el.append(h("button", {
      type: "button",
      onclick: () => {
        el.classList.remove("sichtbar");
        aktion.aus();
      },
    }, aktion.label));
  }
  el.classList.toggle("fehler", fehler);
  el.classList.add("sichtbar");
  window.clearTimeout(hinweisTimer);
  hinweisTimer = window.setTimeout(() => el.classList.remove("sichtbar"), aktion ? 10_000 : fehler ? 8000 : 3500);
}

/** Die Meldung aus einer Antwort des Servers. */
export async function fehlerText(response: Response, sonst: string): Promise<string> {
  const json = (await response.json().catch(() => ({}))) as { error?: string };
  return json.error ?? sonst;
}

export function postJson(url: string, daten: unknown): Promise<Response> {
  return fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(daten) });
}
