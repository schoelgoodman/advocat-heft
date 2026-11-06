/**
 * Sortieren durch Ziehen am Griff. Pointer-Events statt HTML-Drag-and-Drop: das geht auf dem Telefon
 * nicht. Während des Ziehens folgt das DOM dem Finger; die Änderung selbst macht `beimLoslassen`.
 * Die Zeilen tragen die Klasse `ziehbar` und sind Geschwister.
 */
const RAND = 90;
const TEMPO = 12;

export function verschiebe<T>(liste: T[], von: number, nach: number): void {
  const [eintrag] = liste.splice(von, 1);
  liste.splice(nach, 0, eintrag);
}

export function zieheStart(druck: PointerEvent, griff: HTMLElement, beimLoslassen: (von: number, nach: number) => void): void {
  if (druck.button !== 0) return;
  druck.preventDefault();
  const zeile = griff.closest<HTMLElement>(".ziehbar")!;
  const eltern = zeile.parentElement!;
  const zeilen = () => [...eltern.querySelectorAll<HTMLElement>(":scope > .ziehbar")];
  const von = zeilen().indexOf(zeile);
  let y = druck.clientY;
  let griffAbstand = 0;
  let bild = 0;
  let aktiv = false;
  griff.setPointerCapture(druck.pointerId);

  /** Stellt die anderen um die Zeile herum. Sie selbst herauszunehmen würde die Berührung beenden. */
  const ordne = (nach: number) => {
    const alle = zeilen();
    const jetzt = alle.indexOf(zeile);
    const andere = alle.filter((z) => z !== zeile);
    for (const z of andere.slice(jetzt, nach)) eltern.insertBefore(z, zeile);
    for (const z of andere.slice(nach, jetzt).reverse()) eltern.insertBefore(z, zeile.nextElementSibling);
  };
  const setze = () => {
    zeile.style.transform = "";
    const andere = zeilen().filter((z) => z !== zeile);
    const naechste = andere.findIndex((z) => {
      const box = z.getBoundingClientRect();
      return y < box.top + box.height / 2;
    });
    ordne(naechste === -1 ? andere.length : naechste);
    zeile.style.transform = `translateY(${y - griffAbstand - zeile.getBoundingClientRect().top}px)`;
  };
  const schritt = () => {
    if (y < RAND && y < druck.clientY) window.scrollBy({ top: -TEMPO, behavior: "instant" });
    else if (y > window.innerHeight - RAND && y > druck.clientY) window.scrollBy({ top: TEMPO, behavior: "instant" });
    setze();
    bild = requestAnimationFrame(schritt);
  };
  const beginne = () => {
    aktiv = true;
    const oben = zeile.getBoundingClientRect().top;
    griffAbstand = druck.clientY - oben;
    eltern.classList.add("wird-sortiert");
    zeile.classList.add("wird-gezogen");
    window.scrollBy({ top: zeile.getBoundingClientRect().top - oben, behavior: "instant" });
    schritt();
  };
  const bewege = (event: PointerEvent) => {
    y = event.clientY;
    if (!aktiv && Math.abs(y - druck.clientY) > 4) beginne();
  };
  const ende = (abbruch: boolean) => {
    griff.removeEventListener("pointermove", bewege);
    griff.removeEventListener("pointerup", los);
    griff.removeEventListener("pointercancel", abgebrochen);
    if (!aktiv) return;
    cancelAnimationFrame(bild);
    zeile.style.transform = "";
    zeile.classList.remove("wird-gezogen");
    eltern.classList.remove("wird-sortiert");
    if (abbruch) {
      ordne(von);
      return;
    }
    const nach = zeilen().indexOf(zeile);
    if (nach !== von) beimLoslassen(von, nach);
  };
  const los = () => ende(false);
  const abgebrochen = () => ende(true);
  griff.addEventListener("pointermove", bewege);
  griff.addEventListener("pointerup", los);
  griff.addEventListener("pointercancel", abgebrochen);
}
