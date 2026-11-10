# Erfundener Inhalt für die Tests

Dieser Ordner ist ein kleiner Inhalt für `npm run test:browser`. Er hat denselben Aufbau wie der echte Inhalt (`briefe/`, `kapitel/`, `recht/`, `media/`, `papierkorb/`), aber alle Texte sind erfunden und alle Bilder gezeichnet (`node tests/fixtures/bilder.mjs`).

Die festen Seiten in `kapitel/` liegen hier absichtlich noch als Markdown: Beim Start stellt die Redaktion sie auf Felder um, und der Test hat so eine ältere Fassung in Markdown. `allgemein.json` fehlt absichtlich, die Redaktion legt die Datei beim Start an.

Ein Git gibt es hier nicht. `tests/fixtures/inhalt.mjs` kopiert den Ordner und legt in der Kopie die Fassungen an.
