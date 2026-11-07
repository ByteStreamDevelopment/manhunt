# Manhunt

Ein echtes Manhunt im Browser: **Runner** (die Gejagten) teilen alle paar Minuten ihren Standort und laden regelmäßig Fotos hoch, **Hunter** (die Sucher) sehen sie auf einer Karte und jagen sie.

Keine App nötig. Alle öffnen einfach den Link (`https://manhunt.nebendahl.eu/g/ABCDE`) im Handy-Browser.

## Ablauf

1. Du öffnest `/admin`, meldest dich mit dem Admin-Passwort an und legst ein Spiel an. Dabei schaltest du die Features ein oder aus.
2. Du verschickst den Einladungslink oder den 5-stelligen Code.
3. Jeder trägt Namen und Rolle ein (Runner oder Hunter).
4. Sobald du auf **Spiel starten** drückst, teilen Runner ihren Standort im eingestellten Intervall. Nach jeweils X Minuten (Standard 15) schlagen die Runner-Handys Alarm, bis ein Foto hochgeladen ist.
5. Hunter markieren gefangene Runner. Wenn alle gefangen sind oder das Zeitlimit abläuft, endet das Spiel. Danach sehen alle die komplette Route und alle exakten Positionen.

## Accounts, Bestenliste, Galerie

* Mitspielen geht nur mit **Account** (Benutzername, E-Mail, Passwort). Nach der Registrierung kommt ein 6-stelliger **Bestätigungscode per E-Mail**; erst danach kann man sich anmelden. „Passwort vergessen“ funktioniert genauso über einen Code.
* Ohne eingerichteten SMTP-Server (`SMTP_HOST`) stehen die Codes im Server-Log, und die Spielleitung kann Accounts in `/admin` → „Accounts“ von Hand bestätigen.
* **Admin-Accounts** sind `ProfImpossible` und `Mrcoolgamer11` (änderbar über `ADMIN_USERNAMES`). Damit niemand diese Namen wegschnappt, lassen sie sich nur mit dem Server-Passwort (`ADMIN_PASSWORD`) als „Admin-Schlüssel“ registrieren. Danach melden sich die beiden in `/admin` mit Benutzername und Passwort an.
* **Bestenliste** (`/leaderboard`): Punkte für Fänge, Siege, Überlebenszeit, Quests, eingesammelte Fähigkeiten, Fotos und Galerie-Fotos.
* **Galerie** (`/gallery`): Die Spielleitung wählt in `/admin` → Spiel → „Fotos“ mit ⭐ die besten Fotos aus; sie bleiben mit dem Namen des Fotografen erhalten, auch wenn das Spiel gelöscht wird.
* In `/admin` → „Galerie“ lassen sich **alle Fotos aller Spiele vom Server löschen** (wahlweise inklusive Galerie).

## Quests, Fähigkeiten, Live-Strafe, Anti-Cheat

* **Live-Strafe:** Schickt ein Runner sein Foto mehr als die Schonfrist (Standard 60 s) zu spät, wird sein Standort **live** (exakt, alle 5 s) an die Hunter geteilt – bis zum Foto der nächsten Runde (oder wahlweise bis zum nächsten Foto).
* **Quests:** Alle paar Minuten bekommt jeder eine Quest, z. B. *Kurierlauf* (zu einem Punkt laufen), *Einkaufsliste* (zu einem Supermarkt), *Mutprobe* (einem Hunter bis auf 250 m nahe kommen), *Statue* (4 Minuten stillhalten), *Rot sehen* (Foto-Quest); für Hunter *Kopfgeld* (Runner fangen), *Zange* (zu zweit einen Runner einkreisen), *Witterung*, *Patrouille*, *Paparazzi* u. v. m. Belohnung: Punkte und eine Fähigkeit.
* **Fähigkeiten:** Runner: Freeze (Hunter eingefroren), Tarnkappe, Köder (falsche Position), Nebelwand, Fotojoker, Befreiung. Hunter: Radar (Live-Standort aller Runner), Peilung, Fotobefehl, Spurenleser, Eisbrecher. Beide: Schild. Pro Spiel einstellbar: erlaubt, Anzahl zum Start, im Spiel erhältlich, Dauer.
* **Pickups:** An großen Orten (Supermärkte, Märkte, Bahnhöfe – Daten von OpenStreetMap/Overpass) tauchen Fähigkeiten zum Einsammeln auf, **höchstens eine pro 1 km Umkreis**. Ohne passende Orte werden zufällige Punkte verwendet.
* **Anti-Cheat:** Die Android-App meldet aktive VPNs und Fake-GPS-Apps. Der Server erkennt außerdem Teleports (unmögliche Geschwindigkeit), Genauigkeit 0 m und exakt gleichbleibende Koordinaten. Pro Spiel: aus / Spielleitung warnen / blockieren. Optional prüft der Server IP-Adressen auf VPN/Proxy (`VPN_CHECK=ipapi`).

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
| `DATA_DIR` | Ordner für Spielstände (`db.json`), Accounts, Fotos und Galerie | `./data` |
| `ADMIN_USERNAMES` | Accounts mit diesen Namen sind Admins | `ProfImpossible,Mrcoolgamer11` |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | Mailserver für Bestätigungscodes | – (Codes nur im Log) |
| `VPN_CHECK` | `ipapi` = IP-Adressen auf VPN/Proxy prüfen | `off` |
| `OVERPASS_URL` | Overpass-Server für große Orte (Pickups, Quests) | `https://overpass-api.de/api/interpreter` |
| `ANDROID_CERT_SHA256` | Fingerabdruck der App für App-Links | – |

## Sicherheit und Datenschutz

* Mitspielen erfordert einen bestätigten Account. Passwörter werden mit scrypt gehasht, Bestätigungscodes laufen nach 30 Minuten ab und sind auf 5 Versuche begrenzt. Wer den Spielcode kennt und einen Account hat, kann beitreten – verschicke den Code also nur an Mitspieler.
* Nur die Spielleitung (Passwort) kann Spiele anlegen, steuern und löschen. Falsche Passwörter werden gebremst.
* Runner sehen vor dem Beitritt, was geteilt wird. Nach dem Spiel kannst du das Spiel in `/admin` mit **Löschen** entfernen, dann verschwinden Positionen und Fotos vom Server.
* Auch bei aktivierter Verwischung sieht die Spielleitung immer die exakten Positionen.

## Dateien

```
server.js          Server (API, Live-Updates, Sichtbarkeitsregeln, Accounts, Quests, Fähigkeiten)
lib/catalog.js     Alle Fähigkeiten und Quests (Namen, Texte, Standardwerte)
lib/smtp.js        Mini-SMTP-Client für Bestätigungs-Mails
lib/geo.js         Entfernungen, große Orte über Overpass
lib/anticheat.js   VPN- und GPS-Fälschungs-Erkennung
test/e2e.mjs       End-to-End-Test (npm test)
public/            Startseite, Spielseite, Admin-Bereich, Bestenliste, Galerie
Dockerfile, docker-compose.yml, Caddyfile.example, manhunt.service.example
```
