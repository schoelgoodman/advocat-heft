# Advocat-Heft

Der Code setzt Markdown zu der Seite von Advocat Finanz. Die Texte liegen nicht in diesem Repo.

Lokal liegt der Inhalt in `dev-content/` (gitignoriert, eigenes Git). Der Server liest ihn über `CONTENT_DIR`. Fehlt die Variable, nimmt er `dev-content/`.

```sh
npm install
npm run dev
```

Die Seite ist dann auf `http://127.0.0.1:4321`, die Redaktion auf `http://127.0.0.1:4321/redaktion`. Eine geänderte Datei in `dev-content/` baut die betroffene Seite neu. Nach etwa 20 Sekunden Ruhe schreibt das Git in `dev-content/` eine Fassung.

## Kontaktformular

`POST /kontakt` legt jede Anfrage als JSON-Datei in `ANFRAGEN_DIR` ab (lokal `dev-anfragen/`, gitignoriert; auf Neo `<appdata>/advocat/anfragen`). Der Dateiname ist die Eingangszeit in UTC. Die Anfragen stehen absichtlich nicht im Inhalts-Git.

Sind `TELEGRAM_BOT_TOKEN` und `TELEGRAM_CHAT_ID` gesetzt, schickt der Server jede Anfrage zusätzlich als Telegram-Nachricht. Auf Neo sind das die Optionen `telegram.botToken` und `telegram.chatId` von Advocat Finanz. Scheitert Telegram, bleibt die Datei trotzdem liegen; das Feld `telegram` in der Datei sagt `gesendet`, `fehler` oder `aus`.

Die Chat-ID findet man so: dem Bot eine Nachricht schreiben, dann `https://api.telegram.org/bot<TOKEN>/getUpdates` öffnen und `message.chat.id` ablesen. Für eine Gruppe den Bot hinzufügen, dort etwas schreiben, gleiche Abfrage (die ID beginnt mit `-`).

## Neo

Das Plugin ist die Flake in diesem Repo. Sie baut das Image selbst (`modules/packages/advocat-heft.nix`, nix2container); `advocat-image.service` lädt es vor dem Container in Docker. Nach einer Änderung an `package-lock.json` muss `npmDepsHash` dort neu: `prefetch-npm-deps package-lock.json`. Die ausführliche Anleitung für den Server steht in `DEPLOY.md`. Kurz:

1. Das Plugin eintragen und die Dienste `advocat` und `advocat-redaktion` einschalten.
2. `dev-content/` inklusive `.git` nach `<appdata>/advocat/content` kopieren. `<appdata>/advocat/site` ist das erzeugte HTML; der Server setzt es bei jedem Start neu.

Die öffentliche Seite heisst `advocat.<domain>`. Die Redaktion ist ein eigener Neo-Dienst, `advocat-redaktion`, unter `redaktion.<domain>` (an der Wurzel, `/redaktion` springt auf `/`) und verlangt tinyauth. Sie hat keinen eigenen Container und spricht mit dem von `advocat`. Auf dem öffentlichen Namen antworten `/redaktion` und `/api` mit 404.

Der eigene Dienst ist nötig, weil SWAG Zertifikate nur für die Subdomains der Dienste holt. `redaktion.<domain>` nie als Custom Domain eintragen: Neo leitet Custom Domains auf die öffentliche Seite, dort ist `/redaktion` 404. Eine eigene Domain wie `advocat-finanz.ch` kommt in die Custom Domains von `advocat`.

Ein gespeicherter Satz erscheint ohne `neo activate`. Zurücksetzen schreibt die alte Datei zurück und macht einen neuen Commit `Wiederhergestellt: …`.

Die Flake ist gegen `github:madebydamo/neo` ausgewertet: ein Neo-System mit beiden Diensten ergibt ein Systemabbild ohne fehlgeschlagene Assertions. Gebaut und gestartet ist es nicht.
