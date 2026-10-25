# Deploy auf Neo

Anleitung für Hermes auf dem Homeserver. Drei Teile: das Image, das Plugin, der Inhalt. Die Reihenfolge einhalten.

Repo: `github.com/schoelgoodman/advocat-heft` (öffentlich, kein Token nötig).

## 1. Image bauen

Das Plugin zeigt auf das lokale Image `advocat-heft:local`. Es muss existieren, bevor der Dienst startet.

```sh
git clone https://github.com/schoelgoodman/advocat-heft.git ~/advocat-heft
cd ~/advocat-heft
docker build -t advocat-heft:local .
```

Das Image enthält nur den Setzer und die Redaktion, kein Markdown. Nach einem Code-Update: `git pull`, neu bauen, `systemctl restart docker-advocat`.

## 2. Plugin eintragen

1. Neo web → **Settings → core → plugins** → `github:schoelgoodman/advocat-heft` hinzufügen.
2. Speichern, Apply.
3. **Services → Advocat Finanz** und **Services → Advocat Redaktion** einschalten. Apply.

Advocat Redaktion ist nur der Name `redaktion.<domain>` mit tinyauth davor. Er hat keinen eigenen Prozess und zeigt darum keine Units. Ohne Advocat Finanz bricht Apply mit einer Meldung ab.

Beim ersten Start legt der Dienst zwei leere Ordner an:

```
<appdata>/advocat/content   ← Markdown, Bilder, Git der Fassungen
<appdata>/advocat/site      ← erzeugtes HTML, wird beim Start gefüllt
```

`<appdata>` ist `neo.core.volumes.appdata` in der Neo-Konfiguration. Den echten Pfad dort nachsehen, nicht raten.

## 3. Inhalt einspielen

Der Inhalt hängt als `advocat-content.zip` am Release `content-2026-10-25`. Das Zip enthält den Inhalt von `dev-content/` direkt (kein Oberordner), samt `.git`. Das `.git` muss mit: die Redaktion schreibt dort ihre Fassungen.

```sh
curl -fL -o /tmp/advocat-content.zip https://github.com/schoelgoodman/advocat-heft/releases/download/content-2026-10-25/advocat-content.zip
echo "900dde296f56c3b5d50316e7784dcd9501aa2e8715a6ee8c8a5dd410ff75ac96  /tmp/advocat-content.zip" | sha256sum -c

systemctl stop docker-advocat
unzip -q /tmp/advocat-content.zip -d <appdata>/advocat/content
systemctl start docker-advocat
```

Danach muss es so aussehen:

```
<appdata>/advocat/content/
├── .git/
├── README.md
├── briefe/     35 Newsletter
├── kapitel/    9 feste Seiten
├── media/      Bilder
└── recht/      Impressum, Datenschutz, Disclaimer
```

Liegt dort ein Ordner `dev-content/` oder `advocat-content/` statt `briefe/` usw., ist eine Ebene zu viel entpackt. Den Inhalt eine Ebene hochschieben.

Besitzer und Rechte wie die anderen Ordner unter `<appdata>/advocat` setzen (Neo legt sie im `preStart` an). Ist `content` nicht leer, wenn der Zip kommt, nichts überschreiben und Bescheid geben.

`site/` nicht anfassen. Ist es leer, baut der Dienst das HTML beim Start.

## 4. Prüfen

- `systemctl status docker-advocat` läuft, `docker logs advocat` ohne Fehler.
- `https://advocat.<domain>` zeigt die Startseite mit Bildern.
- `https://advocat.<domain>/redaktion` antwortet 404. Das ist richtig.
- `https://redaktion.<domain>` verlangt tinyauth und zeigt danach die Redaktion. `redaktion.<domain>` nicht in die Custom Domains eintragen.
- `git -C <appdata>/advocat/content log --oneline` zeigt `Übernahme aus WordPress`.
