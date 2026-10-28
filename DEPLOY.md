# Deploy auf Neo

Anleitung für Hermes auf dem Homeserver. Zwei Teile: das Plugin, der Inhalt. Die Reihenfolge einhalten.

Repo: `github.com/schoelgoodman/advocat-heft` (öffentlich, kein Token nötig).

## 1. Plugin eintragen

1. Neo web → **Settings → core → plugins** → `github:schoelgoodman/advocat-heft` hinzufügen.
2. Speichern, Apply.
3. **Services → Advocat Finanz** und **Services → Advocat Redaktion** einschalten. Apply.

Das Image baut Nix beim Apply aus dem Plugin (nix2container). Die Unit `advocat-image` lädt es als `advocat-heft:<hash>` in Docker, danach startet `docker-advocat`. Kein `docker build`, kein Clone nötig. Nach einem Code-Update reicht es, den Plugin-Input in Neo zu aktualisieren und Apply.

Advocat Redaktion ist ein eigener Container (`docker-advocat-redaktion`) aus demselben Image, unter `redaktion.<domain>` mit tinyauth davor. Neo zeigt seine Units und Logs beim Dienst Advocat Redaktion. Er schreibt nur in `content/`; die Seite setzt `docker-advocat` neu, sobald sich dort etwas ändert. Ohne Advocat Finanz bricht Apply mit einer Meldung ab.

Beim ersten Start legt der Dienst zwei leere Ordner an:

```
<appdata>/advocat/content   ← Markdown, Bilder, Git der Fassungen
<appdata>/advocat/site      ← erzeugtes HTML, bei jedem Start neu gesetzt
```

`<appdata>` ist `neo.core.volumes.appdata` in der Neo-Konfiguration. Den echten Pfad dort nachsehen, nicht raten.

## 2. Inhalt einspielen

Der Inhalt hängt als `advocat-content.zip` am Release `content-2026-10-29` (Stand 29.10.2026, ersetzt `content-2026-10-25`). Das Zip enthält den Inhalt von `dev-content/` direkt (kein Oberordner), samt `.git`. Das `.git` muss mit: die Redaktion schreibt dort ihre Fassungen.

```sh
curl -fL -o /tmp/advocat-content.zip https://github.com/schoelgoodman/advocat-heft/releases/download/content-2026-10-29/advocat-content.zip
echo "7c108e29e221c2e8a71e1097aa83bf87d26d369d4c579fef811d84f7ef2964eb  /tmp/advocat-content.zip" | sha256sum -c

# Beide Container schreiben in content/, darum beide anhalten.
systemctl stop docker-advocat docker-advocat-redaktion

# Der Zip ersetzt den Inhalt. Was schon dasteht, wird nicht gelöscht, sondern beiseitegelegt.
cd <appdata>/advocat
if [ -n "$(ls -A content 2>/dev/null)" ]; then mv content "content.alt-$(date +%F-%H%M)"; fi
mkdir -p content
unzip -q /tmp/advocat-content.zip -d content
# Besitzer und Rechte wie site/ daneben, die Neo im preStart anlegt.
chown -R --reference=site content
chmod -R u+rwX content

systemctl start docker-advocat docker-advocat-redaktion
```

Danach muss es so aussehen:

```
<appdata>/advocat/content/
├── .git/
├── README.md
├── briefe/     35 Newsletter und ein Entwurf (Nr. 40)
├── kapitel/    9 feste Seiten
├── media/      Bilder
└── recht/      Impressum, Datenschutz, Disclaimer
```

Liegt dort ein Ordner `dev-content/` oder `advocat-content/` statt `briefe/` usw., ist eine Ebene zu viel entpackt. Den Inhalt eine Ebene hochschieben.

Der Zip ersetzt immer den ganzen Inhalt, auch Änderungen, die in der Redaktion seither gemacht wurden. Der alte Inhalt liegt danach unter `<appdata>/advocat/content.alt-<Datum>` und lässt sich zurückholen: beide Container anhalten, `content` beiseitelegen, den alten Ordner zurück nach `content` schieben, starten. Erst löschen, wenn die Seite mit dem neuen Inhalt läuft und niemand ihn mehr braucht.

`site/` nicht anfassen. Der Dienst setzt das HTML bei jedem Start neu.

## Assistent

Für den Assistenten in der Redaktion bei **Services → Advocat Redaktion** unter `assistent.xaiApiKey` den xAI-Schlüssel eintragen (bekommt man vom Betreiber, nicht raten). Apply. Ohne Schlüssel bleibt der Assistent aus. Designwünsche nutzen den Telegram-Bot von Advocat Finanz; dort muss nichts zusätzlich eingetragen werden.

## 3. Prüfen

- `systemctl status advocat-image` ist `active (exited)`, `docker image ls advocat-heft` zeigt genau einen Tag.
- `systemctl status docker-advocat` läuft, `docker logs advocat` ohne Fehler.
- `https://advocat.<domain>` zeigt die Startseite mit Bildern.
- `https://advocat.<domain>/redaktion` antwortet 404. Das ist richtig.
- `https://redaktion.<domain>/` verlangt tinyauth und zeigt danach die Redaktion direkt an der Wurzel (`/redaktion` springt auf `/`). `redaktion.<domain>` nicht in die Custom Domains eintragen.
- `git -C <appdata>/advocat/content log --oneline` zeigt oben `Kapitel: Unser Angebot`, weiter unten `Übernahme aus WordPress`.
