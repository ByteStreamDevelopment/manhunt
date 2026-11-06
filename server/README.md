# Manhunt

Ein echtes Manhunt im Browser: **Runner** (die Gejagten) teilen alle paar Minuten ihren Standort und laden regelmäßig Fotos hoch, **Hunter** (die Sucher) sehen sie auf einer Karte und jagen sie.

Keine App nötig. Alle öffnen einfach den Link (`https://manhunt.nebendahl.eu/g/ABCDE`) im Handy-Browser.

## Ablauf

1. Du öffnest `/admin`, meldest dich mit dem Admin-Passwort an und legst ein Spiel an. Dabei schaltest du die Features ein oder aus.
2. Du verschickst den Einladungslink oder den 5-stelligen Code.
3. Jeder trägt Namen und Rolle ein (Runner oder Hunter).
4. Sobald du auf **Spiel starten** drückst, teilen Runner ihren Standort im eingestellten Intervall. Nach jeweils X Minuten (Standard 15) schlagen die Runner-Handys Alarm, bis ein Foto hochgeladen ist.
5. Hunter markieren gefangene Runner. Wenn alle gefangen sind oder das Zeitlimit abläuft, endet das Spiel. Danach sehen alle die komplette Route und alle exakten Positionen.

## Features (alle in `/admin` pro Spiel schaltbar)

| Feature | Standard |
|---|---|
| Standort-Intervall (Sekunden) | 120 |
| Foto-Aufforderung mit Alarm, Intervall in Minuten | an, 15 |
| Vorsprung für Runner (Hunter sehen sie erst nach X Min.) | aus |
| Standort verwischen (Hunter sehen nur ±X Meter genau) | aus |
| Spur der bisherigen Route | an |
| Hunter sehen Entfernung + Himmelsrichtung zum nächsten Runner | an |
| Runner sehen sich gegenseitig / Hunter sehen sich / Runner sehen Hunter | an / an / aus |
| „Gefangen“-Funktion, Auto-Ende wenn alle gefangen | an |
| Zeitlimit (Runner gewinnen bei Ablauf) | aus |
| Spielzone (Kreis auf der Karte, Warnung beim Verlassen) | aus |
| Nachrichten der Spielleitung an alle | immer |
| Live-Ansicht der Spielleitung (alles exakt), Spieler entfernen, Spiel zurücksetzen | immer |

## Wichtige Grenzen (Browser, nicht dieses Programm)

* **HTTPS ist Pflicht.** Standort und Kamera funktionieren nur über HTTPS. Mit Caddy hast du das.
* **Die Seite muss im Vordergrund bleiben.** Browser pausieren Webseiten im Hintergrund oder bei gesperrtem Bildschirm, dann kommen keine Standorte mehr an. Die Seite hält den Bildschirm per „Wake Lock“ wach und warnt, wenn der Standort nicht freigegeben ist. Ein Handy mit Powerbank in der Jackentasche geht also, gesperrtes Display nicht.
* **Foto-Erinnerungen** kommen als Ton, Vibration und Banner, solange die Seite offen ist. Echte Push-Nachrichten bei gesperrtem Handy wären ein späteres Upgrade (Web Push, geht bei iPhones nur mit installierter Web-App).
* Karte: Leaflet und OpenStreetMap-Kacheln werden vom Handy direkt bei `unpkg.com` bzw. `tile.openstreetmap.org` geladen. Das ist für private Runden völlig okay. Für ein öffentliches Angebot solltest du Leaflet selbst hosten und einen eigenen Kachelserver nutzen.

## Installation

Es gibt **keine npm-Abhängigkeiten**. Nötig ist nur Node.js ab Version 18 (getestet mit 22).

### Empfehlung: Linux-VPS

Der Linux-VPS ist die bessere Wahl: läuft dauerhaft, Caddy ist dort schon eingerichtet, Docker ist auf Linux problemlos, und du brauchst keine Portfreigabe im Heimnetz. Docker Desktop auf einem Windows Server ist dafür unnötig kompliziert.

### Variante 1: Docker (mit deinem Caddy)

```bash
cp .env.example .env        # ADMIN_PASSWORD setzen
nano docker-compose.yml     # Netzwerkname "caddy" auf den deines Caddy-Containers ändern
docker compose up -d --build
```

Dann den Block aus `Caddyfile.example` in deine Caddyfile übernehmen und Caddy neu laden (`docker exec <caddy> caddy reload --config /etc/caddy/Caddyfile`). Spielstände und Fotos liegen im Docker-Volume `manhunt-data`.

### Variante 2: Ohne Docker (Node.js direkt)

Ja, das läuft auf Linux problemlos ohne Docker:

```bash
cd /opt/manhunt
ADMIN_PASSWORD='dein-langes-passwort' HOST=127.0.0.1 PORT=3000 DATA_DIR=/var/lib/manhunt node server.js
```

Als Dauerdienst siehe `manhunt.service.example` (systemd). Läuft dein Caddy in Docker, muss er den Host erreichen können (siehe Variante B in `Caddyfile.example`). Dann setzt du `HOST=0.0.0.0` und sperrst Port 3000 per Firewall nach außen.

### Umgebungsvariablen

| Variable | Bedeutung | Standard |
|---|---|---|
| `ADMIN_PASSWORD` | Passwort für `/admin`. Ohne Angabe wird beim Start ein zufälliges ausgegeben. | zufällig |
| `PORT` | Port des Servers | 3000 |
| `HOST` | Adresse, auf der gelauscht wird | 0.0.0.0 |
| `DATA_DIR` | Ordner für Spielstände (`db.json`) und Fotos | `./data` |

## Sicherheit und Datenschutz

* Spieler bekommen beim Beitritt ein zufälliges Token. Wer den Spielcode kennt, kann beitreten. Verschicke den Code also nur an Mitspieler.
* Nur die Spielleitung (Passwort) kann Spiele anlegen, steuern und löschen. Falsche Passwörter werden gebremst.
* Runner sehen vor dem Beitritt, was geteilt wird. Nach dem Spiel kannst du das Spiel in `/admin` mit **Löschen** entfernen, dann verschwinden Positionen und Fotos vom Server.
* Auch bei aktivierter Verwischung sieht die Spielleitung immer die exakten Positionen.

## Dateien

```
server.js          Server (API, Live-Updates, Sichtbarkeitsregeln)
public/            Startseite, Spielseite, Admin-Bereich
Dockerfile, docker-compose.yml, Caddyfile.example, manhunt.service.example
```
