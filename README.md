# Advocat-Heft

Der Code setzt Markdown zu der Seite von Advocat Finanz. Die Texte liegen nicht in diesem Repo.

Lokal liegt der Inhalt in `dev-content/` (gitignoriert, eigenes Git). Der Server liest ihn über `CONTENT_DIR`. Fehlt die Variable, nimmt er `dev-content/`.

```sh
npm install
npm run dev
```

Die Seite ist dann auf `http://127.0.0.1:4321`, die Redaktion auf `http://127.0.0.1:4321/redaktion`. Eine geänderte Datei in `dev-content/` baut die betroffene Seite neu. Nach etwa 20 Sekunden Ruhe schreibt das Git in `dev-content/` eine Fassung.

## Suchmaschinen

Jede Seite bekommt Beschreibung, canonical, Open Graph und auf der Startseite bzw. bei Newslettern strukturierte Daten (`src/design/seo.ts`). Die Beschreibung sind die ersten Absätze der Seite; wer sie ändern will, ändert den Anfang des Textes. Der Setzer schreibt `sitemap.xml` und `robots.txt` mit. Die Adresse darin kommt aus `SITE_URL` (Standard `https://advocat-finanz.ch`, auf Neo die Option `siteUrl`). Der Server leitet `/angebot/` auf `/angebot` und alte WordPress-Bilder unter `/wp-content/uploads/…` auf `/media/…` um. Die Redaktion und `/api` tragen `X-Robots-Tag: noindex`.

Bilder gehen verkleinert auf die Seite (`src/render/media.ts`, mit sharp): höchstens 2000 px breit, neu komprimiert, unter demselben Namen. Das Original im Inhalt bleibt unverändert. Lädt sharp nicht, gehen die Originale raus und das Log sagt es.

## Kontaktformular

`POST /kontakt` legt jede Anfrage als JSON-Datei in `ANFRAGEN_DIR` ab (lokal `dev-anfragen/`, gitignoriert; auf Neo `<appdata>/advocat/anfragen`). Der Dateiname ist die Eingangszeit in UTC. Die Anfragen stehen absichtlich nicht im Inhalts-Git.

Sind `TELEGRAM_BOT_TOKEN` und `TELEGRAM_CHAT_ID` gesetzt, schickt der Server jede Anfrage zusätzlich als Telegram-Nachricht. Auf Neo sind das die Optionen `telegram.botToken` und `telegram.chatId` von Advocat Finanz. Scheitert Telegram, bleibt die Datei trotzdem liegen; das Feld `telegram` in der Datei sagt `gesendet`, `fehler` oder `aus`.

Die Chat-ID findet man so: dem Bot eine Nachricht schreiben, dann `https://api.telegram.org/bot<TOKEN>/getUpdates` öffnen und `message.chat.id` ablesen. Für eine Gruppe den Bot hinzufügen, dort etwas schreiben, gleiche Abfrage (die ID beginnt mit `-`).

Die Redaktion zeigt alle Anfragen unter „Kontaktaufnahme“ (`GET /api/anfragen`, neueste zuerst). Auf Neo bindet der Container `advocat-redaktion` den Ordner dafür nur lesend ein.

## Assistent

Rechts in der Redaktion sitzt ein Assistent: Er erklärt die Redaktion und schreibt mit Patrick an den Texten. Dahinter steht ein Modell bei xAI (`XAI_API_KEY`, Modell `XAI_MODEL`, Standard `grok-4.7`). Lokal steht der Schlüssel in `.env` (gitignoriert); der Server liest die Datei ausserhalb von `NODE_ENV=production` selbst. Ohne Schlüssel ist der Assistent aus, die Redaktion läuft sonst normal.

Der Assistent hat keine Werkzeuge. Der Server schickt ihm die Anleitung (`src/server/anleitung.ts`), die offene Seite samt Markierung und die drei neuesten Newsletter, dazu jeden, den Patrick mit Nummer nennt. Änderungen am Text kommen als Vorschlag; erst «Übernehmen» setzt sie ein, als normale Änderung im Editor (Ctrl+Z, Fassungen). Ändert sich die Redaktion, muss `anleitung.ts` mit.

Support an die Betreuung, in drei Arten: Feature (etwas Neues in der Redaktion), Bug (etwas in der Redaktion geht nicht) und Styling (Aussehen der Website). Intern heissen sie weiter `funktion`, `fehler` und `design`. Der Assistent schreibt sie auf, ein Feature als kleinen Entwurf (Was fehlt, Wozu, Vorschlag), einen Bug als Meldung zum Nachstellen (Was passiert, Wo und wie, Erwartet, Wie oft). Patrick kann den Text auf der Karte ändern, «An Support senden» bzw. «Bug melden» schickt ihn über denselben Telegram-Bot wie die Anfragen; ein Bug bringt Browser und Fenstergrösse mit. Jeder Eintrag bleibt in `CHAT_DIR/wuensche.json` und steht in der Redaktion unter «Support», mit Stand offen oder erledigt; dort lässt sich auch ohne Assistenten einer schreiben. Der Verlauf des Assistenten liegt daneben in `CHAT_DIR/verlauf.json`, nicht im Inhalts-Git. «Neues Gespräch» leert nur den Verlauf.

## Word-Import

In einem Entwurf liest «Word importieren» (oder eine .docx, auf den Text gezogen) eine Word-Datei ein (`src/server/word.ts`, mit mammoth). Es bleibt, was die Website kennt: Zwischentitel, Absätze, Listen, Zitate, fett, kursiv, Links, Bilder. Ganz fette kurze Absätze und von Hand gesetzte Punkte (•, –) gelten als Zwischentitel bzw. Liste, Tabellen werden zu Zeilen mit « · ». Die erste Überschrift wird das Thema. Bilder landen als `media/word-…` im Inhalt; EMF und WMF zeigt kein Browser, die meldet die Redaktion. Alte .doc-Dateien gehen nicht.

## Neo

Das Plugin ist die Flake in diesem Repo. Sie baut das Image selbst (`modules/packages/advocat-heft.nix`, nix2container); `advocat-image.service` lädt es vor dem Container in Docker. Nach einer Änderung an `package-lock.json` muss `npmDepsHash` dort neu: `prefetch-npm-deps package-lock.json`. Die ausführliche Anleitung für den Server steht in `DEPLOY.md`. Kurz:

1. Das Plugin eintragen und die Dienste `advocat` und `advocat-redaktion` einschalten.
2. `dev-content/` inklusive `.git` nach `<appdata>/advocat/content` kopieren. `<appdata>/advocat/site` ist das erzeugte HTML; der Server setzt es bei jedem Start neu.

Die öffentliche Seite heisst `advocat.<domain>`. Die Redaktion ist ein eigener Neo-Dienst, `advocat-redaktion`, unter `redaktion.<domain>` (an der Wurzel, `/redaktion` springt auf `/`) und verlangt tinyauth. Beide laufen aus demselben Image, je als eigener Container: `advocat` mit `ROLLE=seite` setzt und liefert die Seite und schreibt als einziger nach `site/`; `advocat-redaktion` mit `ROLLE=redaktion` schreibt nur Inhalt und Fassungen und sieht `site/` nur lesend. Die Seite bemerkt jede Änderung am Inhalt und setzt die betroffenen Seiten neu. Stoppen der Redaktion lässt die Seite online. Auf dem öffentlichen Namen antworten `/redaktion` und `/api` mit 404. Lokal, ohne `ROLLE`, macht ein Prozess beides.

Der eigene Dienst ist nötig, weil SWAG Zertifikate nur für die Subdomains der Dienste holt. `redaktion.<domain>` nie als Custom Domain eintragen: Neo leitet Custom Domains auf die öffentliche Seite, dort ist `/redaktion` 404. Eine eigene Domain wie `advocat-finanz.ch` kommt in die Custom Domains von `advocat`.

Ein gespeicherter Satz erscheint ohne `neo activate`. Ein neuer Newsletter beginnt als Entwurf (`entwurf: true` im Frontmatter); der Setzer lässt ihn aus, bis er in der Redaktion veröffentlicht wird. Beim Veröffentlichen bekommt die Datei das Thema in den Namen, damit die Adresse wie bei den bisherigen Newslettern lautet. Zurücksetzen schreibt die alte Datei zurück und macht einen neuen Commit `Wiederhergestellt: …`.

Die Flake ist gegen `github:madebydamo/neo` ausgewertet: ein Neo-System mit beiden Diensten ergibt ein Systemabbild ohne fehlgeschlagene Assertions. Gebaut und gestartet ist es nicht.
