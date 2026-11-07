# Deploy auf Neo

Anleitung für Hermes auf dem Homeserver. Das Plugin, der Inhalt, die Prüfung und einmalig das Umschalten von WordPress (Teil 4). Die Reihenfolge einhalten.

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

Einmal zum Umzug auf den Server ist das geschehen (als Zip mit `.git`). Nicht wiederholen: Ein Zip ersetzt den ganzen Inhalt samt Patricks Arbeit. Für einen neuen Server den Betreiber fragen.

### Umstellung der festen Seiten auf Felder

Die erste Version mit Feldern stellt die festen Seiten beim Start der Redaktion selbst um und schreibt eine Fassung «Feste Seiten auf Felder umgestellt». Vor diesem einen Update `content` sichern (`cp -a content "content.alt-$(date +%F-%H%M)"`). Danach `docker logs advocat-redaktion | grep Umstellung`: Meldet es eine Seite, die «bleibt Text», läuft sie weiter mit dem freien Editor; dem Betreiber melden. Wer danach Inhalt als Bundle schickt, nimmt zuerst den Stand vom Server.

`site/` nicht anfassen. Der Dienst setzt das HTML bei jedem Start neu. Nach dem Update mit AVIF rechnet der erste Start alle Fotos einmal neu (einige Minuten); die Seite bleibt online und bekommt die neuen Bilder, sobald im Log `… Seiten gesetzt.` steht.

## Schlüssel der Redaktion

Die Redaktion nimmt nur Anfragen an, die über SWAG und tinyauth kommen. SWAG schickt dafür einen geheimen Schlüssel mit; andere Container im Netz `internal` kennen ihn nicht. Bei **Services → Advocat Redaktion** unter `schluessel` einmal **Generate** drücken, Apply. Ohne Schlüssel antwortet die Redaktion 503 (die öffentliche Seite läuft weiter). Braucht ein Neo mit `neo.core.secrets` (ab 28.10.2026).

## Assistent

Für den Assistenten in der Redaktion bei **Services → Advocat Redaktion** unter `assistent.xaiApiKey` den xAI-Schlüssel eintragen (bekommt man vom Betreiber, nicht raten). Apply. Ohne Schlüssel bleibt der Assistent aus. Support-Nachrichten nutzen den Telegram-Bot von Advocat Finanz; dort muss nichts zusätzlich eingetragen werden.

## 3. Prüfen

- `systemctl status advocat-image` ist `active (exited)`, `docker image ls advocat-heft` zeigt genau einen Tag.
- `systemctl status docker-advocat` läuft, `docker logs advocat` ohne Fehler.
- `https://advocat.<domain>` zeigt die Startseite mit Bildern.
- `https://advocat.<domain>/redaktion` antwortet 404. Das ist richtig.
- `curl -s -o /dev/null -w '%{http_code}' http://advocat-redaktion:4321/api/pages` aus einem anderen Container im Netz `internal` (etwa `docker exec swag …`): `403`. Über `https://redaktion.<domain>/` geht es nach der Anmeldung.
- `docker inspect advocat --format '{{.HostConfig.ReadonlyRootfs}} {{.HostConfig.Memory}}'` zeigt `true` und einen Speicherwert; `docker logs advocat` ohne `EROFS`.
- `curl -sI https://advocat.<domain>//x//boese.example/ | grep -i ^location` zeigt `/boese.example`, keine fremde Adresse.
- `curl -sI https://advocat.<domain>/ | grep -i x-robots` zeigt `noindex`, solange die Seite nicht unter ihrer eigenen Domain läuft.
- `curl -sI https://advocat.<domain>/ | grep -i content-security` zeigt `default-src 'self'`; bei einer Datei `.svg` steht `sandbox`.
- `https://redaktion.<domain>/` verlangt tinyauth und zeigt danach die Redaktion direkt an der Wurzel (`/redaktion` springt auf `/`). `redaktion.<domain>` nicht in die Custom Domains eintragen.
- Nach einer Inhaltsübernahme: `git -C <appdata>/advocat/content log --oneline -5` zeigt oben die Fassungen aus dem Release (oder einen Merge-Commit darüber).
- Telegram: `docker logs advocat | grep -i '^Telegram'` ist leer. Das Feld `telegram` in der neuesten Datei unter `<appdata>/advocat/anfragen` sagt `gesendet`.

## 4. Umschalten von WordPress

Einmalig, nur auf Anweisung des Betreibers. Noch zeigt `advocat-finanz.ch` auf WordPress; dieser Teil zieht die Domain auf den Neo-Server. Die Punkte der Reihe nach abarbeiten und das Ergebnis jedes Abschnitts melden. Schlägt etwas in «Nach dem Umschalten» fehl: «Zurück» unten.

### Vor dem Umschalten

Die Liste der alten Adressen sichern. Nach dem Umschalten ist sie nicht mehr abrufbar:

```sh
for map in $(curl -sL https://advocat-finanz.ch/wp-sitemap.xml | grep -oE 'https://[^<]+wp-sitemap-[^<]+\.xml'); do
  curl -sL "$map" | grep -oE '<loc>[^<]+' | sed 's/<loc>//'
done | sort -u > /root/advocat-alte-adressen.txt
wc -l /root/advocat-alte-adressen.txt   # etwa 49
```

Prüfen, bevor etwas geändert wird:

- **Länderfilter:** Beide nginx-Konfigurationen laden `/config/nginx/geo-access.conf`. Den Inhalt ansehen. Lässt die Datei nur bestimmte Länder zu, sperrt sie den Googlebot aus (er kommt meist aus den USA), und die Seite fällt aus dem Suchindex. In dem Fall anhalten und dem Betreiber melden.
- **DNS:** Die heutigen Einträge der Domain sichern. Die TTL der A/AAAA-Einträge von `advocat-finanz.ch` und `www` mindestens einen Tag vorher auf 300 Sekunden setzen.
- **Zertifikat:** Die Domain sendet heute HSTS. Browser, die sie kennen, lassen bei einem falschen Zertifikat keine Ausnahme zu. Klären, wie SWAG das Zertifikat für `advocat-finanz.ch` und `www.advocat-finanz.ch` bekommt, bevor die Einträge wechseln.
- **Stand von WordPress sichern** (Dateien und Datenbank) und den alten Hoster noch nicht kündigen.

### Umschalten

1. Bei **Services → Advocat Finanz** in den Custom Domains `advocat-finanz.ch` und `www.advocat-finanz.ch` eintragen. `siteUrl` bleibt `https://advocat-finanz.ch`. Apply. `redaktion.<domain>` bleibt draussen.
2. **Nur** die A/AAAA-Einträge von `advocat-finanz.ch` und `www` ändern. MX, SPF, DKIM, Autodiscover und alle TXT-Einträge bleiben: Die E-Mails laufen über Microsoft 365, und der TXT-Eintrag bestätigt die Domain bei der Google Search Console.

### Nach dem Umschalten

Die Domain muss öffentlich auffindbar sein. Jeder Befehl mit seiner erwarteten Antwort:

```sh
D=https://advocat-finanz.ch
# Der neue Server antwortet (kein «server: Apache»).
curl -sI $D/ | grep -i ^server
# Nur eine Adresse: beide 301 auf https://advocat-finanz.ch/
curl -sI http://advocat-finanz.ch/ | grep -iE '^(HTTP|location)'
curl -sI https://www.advocat-finanz.ch/ | grep -iE '^(HTTP|location)'
# WICHTIG: leer. Steht hier noindex, verschwindet die Seite aus Google.
curl -sI $D/ | grep -i x-robots
# Keine Zeile «Disallow: /». Dafür «Disallow: /api/» und «Sitemap: https://advocat-finanz.ch/sitemap.xml».
curl -s $D/robots.txt
# canonical zeigt auf die Domain, kein <meta name="robots" content="noindex">.
curl -s $D/ | grep -oE '<link rel="canonical"[^>]*>|<meta name="robots"[^>]*>'
# Einfache Sitemap, alle Adressen auf dieser Domain: die Zahl ist die Anzahl Seiten.
curl -s $D/sitemap.xml | grep -c "<loc>$D"
# Redaktion und API sind von aussen zu: zweimal 404.
curl -s -o /dev/null -w '%{http_code}\n' $D/redaktion
curl -s -o /dev/null -w '%{http_code}\n' $D/api/pages
# Jede alte Adresse endet auf 200. Erlaubte Ausnahmen mit 404: /author/…, /category/… und die Fragenseite, die es nur noch bei WordPress gibt.
while read -r url; do
  curl -sL -o /dev/null -w '%{http_code} %{num_redirects} %{url_effective}\n' "$url"
done < /root/advocat-alte-adressen.txt | grep -v '^200 '
```

Von Hand:

- **Kontaktformular:** Auf `https://advocat-finanz.ch/kontakt` eine Testanfrage schicken. Sie erscheint in der Redaktion unter «Kontaktaufnahme», die Telegram-Meldung kommt. Danach auf «Erledigt» setzen, sonst kommt morgen eine Erinnerung.
- **E-Mail:** Eine Nachricht an und von `office@advocat-finanz.ch` geht durch.
- **Bilder:** Die Startseite auf dem Handy öffnen. In den Entwicklerwerkzeugen laden die Bilder aus `/media/_klein/` als `image/avif`.

Dem Betreiber melden, dann erledigt der Betreiber:

- **Google Search Console:** unter Indexierung → Sitemaps `sitemap.xml` einreichen und einen alten Eintrag `wp-sitemap.xml` entfernen. In der URL-Prüfung die Startseite mit «Live-URL testen» prüfen: Das zeigt, ob der Googlebot wirklich durchkommt. Dann die Indexierung beantragen.
- **Erreichbarkeit überwachen:** Bei einem externen Dienst (nicht auf diesem Server, sonst fällt er mit aus) `https://advocat-finanz.ch/` alle paar Minuten prüfen lassen, mit Meldung an den Betreiber.
- **Zwei Wochen beobachten:** In der Search Console unter Seiten nach neuen 404 und nach «Durch noindex-Tag ausgeschlossen» schauen.

### Zurück

Bei einem Fehler, den sich nicht sofort beheben lässt: die A/AAAA-Einträge auf den gesicherten Stand zurücksetzen. WordPress läuft unverändert weiter, Inhalt und Anfragen auf Neo bleiben. Der Betreiber kündigt den alten Hoster erst, wenn zwei Wochen ohne Befund vorbei sind.
