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
2. Das Plugin eintragen und den Dienst `advocat` einschalten.
3. `dev-content/` inklusive `.git` nach `<appdata>/advocat/content` kopieren. `<appdata>/advocat/site` bleibt das erzeugte HTML und wird beim Start gefüllt, wenn es leer ist.

Die öffentliche Seite heisst `advocat.<domain>`. Die Redaktion heisst `redaktion.<domain>` und verlangt tinyauth. Auf dem öffentlichen Namen antworten `/redaktion` und `/api` mit 404.

`redaktion.<domain>` braucht einen DNS-Eintrag. Ein Wildcard-Zertifikat deckt den Namen. Sonst `redaktion.<domain>` bei den Custom Domains des Dienstes eintragen, sobald der Name auflöst. Eine eigene Domain wie `advocat-finanz.ch` kommt ebenfalls in die Custom Domains.

Ein gespeicherter Satz erscheint ohne `neo activate`. Zurücksetzen schreibt die alte Datei zurück und macht einen neuen Commit `Wiederhergestellt: …`.

Die Flake ist hier nicht ausgewertet: auf diesem Rechner liegt kein Nix, und die Vorlage baut für `x86_64-linux`.
