# Deploy auf Neo

Anleitung für Hermes auf dem Homeserver. Zwei Teile: das Plugin, der Inhalt. Die Reihenfolge einhalten.

Ein Code-Update ist nur Teil 1. Teil 2 (Inhalt einspielen) nur, wenn der Betreiber es ausdrücklich verlangt. Der Inhalt gehört Patrick: Er pflegt ihn in der Redaktion. Eingespielt wird nur zusammengeführt (Git-Bundle), nie ersetzt.

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

Nur auf ausdrückliche Anweisung des Betreibers, nicht bei einem Code-Update. Der Inhalt gehört Patrick: Er pflegt ihn in der Redaktion.

### Änderungen übernehmen (der normale Weg)

Der Betreiber ändert Inhalt lokal auf dem Stand des Servers und schickt nur seine neuen Fassungen als Git-Bundle (`advocat-content.bundle` an einem Release `content-<Datum>`). Das Bundle wird **zusammengeführt**, nicht ersetzt: Was Patrick seither in der Redaktion gespeichert hat, bleibt erhalten.

Tag und Prüfsumme stehen in der Anweisung des Betreibers.

```sh
TAG=content-<Datum>
curl -fL -o /tmp/advocat-content.bundle https://github.com/schoelgoodman/advocat-heft/releases/download/$TAG/advocat-content.bundle
echo "<sha256>  /tmp/advocat-content.bundle" | sha256sum -c

# Beide Container schreiben in content/, darum beide anhalten.
systemctl stop docker-advocat docker-advocat-redaktion

cd <appdata>/advocat
# Sicherung, bevor etwas geändert wird.
cp -a content "content.alt-$(date +%F-%H%M)"

cd content
g() { git -c safe.directory='*' -c user.name="Advocat Redaktion" -c user.email="redaktion@advocat.local" "$@"; }
# Ungespeicherte Fassungen (die Redaktion committet nach 20 s Ruhe) zuerst sichern.
[ -z "$(g status --porcelain)" ] || { g add -A && g commit -q -m "Stand vor Übernahme"; }
g bundle verify /tmp/advocat-content.bundle
g fetch /tmp/advocat-content.bundle main:refs/heads/uebernahme
# Hat Patrick seither nichts geändert, geht es geradeaus. Sonst ein Merge-Commit.
g merge --ff-only uebernahme || g merge --no-edit uebernahme
g branch -d uebernahme
g status --short   # muss leer sein
cd ..

# Besitzer und Rechte wie site/ daneben.
chown -R --reference=site content
chmod -R u+rwX content

systemctl start docker-advocat docker-advocat-redaktion
```

Meldet `git merge` einen **Konflikt** (Patrick und der Betreiber haben dieselbe Stelle geändert): `g merge --abort`, `g branch -D uebernahme`, Container starten und dem Betreiber die Ausgabe schicken. Nichts von Hand auflösen.

Zurück zum Stand davor: beide Container anhalten, `content` beiseitelegen, `content.alt-<Datum>` zurück nach `content` schieben, starten. Die Sicherung erst löschen, wenn die Seite mit dem neuen Inhalt läuft.

Den aktuellen Stand für den Betreiber holen (nur lesend, nichts anhalten): `git -C <appdata>/advocat/content bundle create /tmp/advocat-live.bundle --all`.

### Erstinstallation (nur bei leerem `content/`)

Einmal zum Umzug auf den Server ist das geschehen (Release `content-2026-10-29`, `advocat-content.zip` mit `.git`). Nicht wiederholen: Ein Zip ersetzt den ganzen Inhalt samt Patricks Arbeit. Für einen neuen Server den Betreiber fragen.

`site/` nicht anfassen. Der Dienst setzt das HTML bei jedem Start neu.

## Assistent

Für den Assistenten in der Redaktion bei **Services → Advocat Redaktion** unter `assistent.xaiApiKey` den xAI-Schlüssel eintragen (bekommt man vom Betreiber, nicht raten). Apply. Ohne Schlüssel bleibt der Assistent aus. Designwünsche nutzen den Telegram-Bot von Advocat Finanz; dort muss nichts zusätzlich eingetragen werden.

## 3. Prüfen

- `systemctl status advocat-image` ist `active (exited)`, `docker image ls advocat-heft` zeigt genau einen Tag.
- `systemctl status docker-advocat` läuft, `docker logs advocat` ohne Fehler.
- `https://advocat.<domain>` zeigt die Startseite mit Bildern.
- `https://advocat.<domain>/redaktion` antwortet 404. Das ist richtig.
- `https://redaktion.<domain>/` verlangt tinyauth und zeigt danach die Redaktion direkt an der Wurzel (`/redaktion` springt auf `/`). `redaktion.<domain>` nicht in die Custom Domains eintragen.
- Nach einer Inhaltsübernahme: `git -C <appdata>/advocat/content log --oneline -5` zeigt oben die Fassungen aus dem Release (oder einen Merge-Commit darüber).
