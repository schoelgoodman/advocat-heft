# Advocat-Heft

Der Code setzt Markdown zu der Seite von Advocat Finanz. Die Texte liegen nicht in diesem Repo.

Lokal liegt der Inhalt in `dev-content/` (gitignoriert, eigenes Git). Der Server liest ihn über `CONTENT_DIR`. Fehlt die Variable, nimmt er `dev-content/`.

```sh
npm install
npm run dev
```

Die Seite ist dann auf `http://127.0.0.1:4321`, die Redaktion auf `http://127.0.0.1:4321/redaktion`. Eine geänderte Datei in `dev-content/` baut die betroffene Seite neu. Nach etwa 20 Sekunden Ruhe schreibt das Git in `dev-content/` eine Fassung.

## Neo

Das Plugin ist die Flake in diesem Repo. Die ausführliche Anleitung für den Server steht in `DEPLOY.md`. Kurz:

1. `docker build -t advocat-heft:local .`
2. Das Plugin eintragen und die Dienste `advocat` und `advocat-redaktion` einschalten.
3. `dev-content/` inklusive `.git` nach `<appdata>/advocat/content` kopieren. `<appdata>/advocat/site` bleibt das erzeugte HTML und wird beim Start gefüllt, wenn es leer ist.

Die öffentliche Seite heisst `advocat.<domain>`. Die Redaktion ist ein eigener Neo-Dienst, `advocat-redaktion`, unter `redaktion.<domain>` und verlangt tinyauth. Sie hat keinen eigenen Container und spricht mit dem von `advocat`. Auf dem öffentlichen Namen antworten `/redaktion` und `/api` mit 404.

Der eigene Dienst ist nötig, weil SWAG Zertifikate nur für die Subdomains der Dienste holt. `redaktion.<domain>` nie als Custom Domain eintragen: Neo leitet Custom Domains auf die öffentliche Seite, dort ist `/redaktion` 404. Eine eigene Domain wie `advocat-finanz.ch` kommt in die Custom Domains von `advocat`.

Ein gespeicherter Satz erscheint ohne `neo activate`. Zurücksetzen schreibt die alte Datei zurück und macht einen neuen Commit `Wiederhergestellt: …`.

Die Flake ist gegen `github:madebydamo/neo` ausgewertet: ein Neo-System mit beiden Diensten ergibt ein Systemabbild ohne fehlgeschlagene Assertions. Gebaut und gestartet ist es nicht.
