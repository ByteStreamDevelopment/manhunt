# Manhunt – Android-App (nativ, Kotlin + Jetpack Compose)

Spieler-App für https://manhunt.nebendahl.eu. Die Spielleitung (/admin) bleibt im Browser.

Vorteil gegenüber der Website: Der Standort wird **auch bei gesperrtem Bildschirm** geteilt, und
Foto-Alarm, Durchsagen der Spielleitung, Spielstart/-ende, Fänge und neue Fotos kommen als Benachrichtigung.

## APK bauen (auf dem VPS, mit Docker)
    ./build.sh
Ergebnis: `out/manhunt.apk` (Release, mit eigenem Schlüssel signiert, direkt installierbar).
Erster Lauf dauert einige Minuten (Android-SDK + Abhängigkeiten), danach geht es schnell (Gradle-Cache-Volume).

**Signierschlüssel:** Beim ersten Lauf erzeugt `build.sh` den Schlüssel `keystore/manhunt.jks` und
`keystore.properties` (beide nicht im Git). **Diese Dateien sichern!** Android installiert Updates nur,
wenn sie mit demselben Schlüssel signiert sind. Wer noch eine ältere APK (Version 1.0, Debug-Schlüssel)
installiert hat, muss sie einmal deinstallieren.

Ohne Docker (Android Studio oder JDK 17 + Android-SDK): `./gradlew assembleRelease`.
Tests: `./gradlew testDebugUnitTest`.

## Installieren
APK aufs Handy kopieren, antippen, „Unbekannte Quellen" für den Dateimanager/Browser erlauben.
Oder per USB: `adb install -r out/manhunt.apk`.

## Server-Adresse ändern
`app/build.gradle.kts` -> `BASE_URL` (und den Host im Intent-Filter in `AndroidManifest.xml`).

## Einladungslinks direkt in der App öffnen (App-Links)
`build.sh` gibt am Ende den SHA-256-Fingerabdruck des Schlüssels aus. Diesen in `server/.env` als
`ANDROID_CERT_SHA256=…` eintragen und den Server neu starten. Dann liefert der Server
`/.well-known/assetlinks.json` aus, und Links `https://manhunt.nebendahl.eu/g/CODE` öffnen ohne Nachfrage
die App (der Code wird vorausgefüllt und das Spiel sofort gesucht). Ohne diese Einstellung fragt Android,
bzw. man aktiviert unter Einstellungen → Apps → Manhunt → „Standardmäßig öffnen" die Links von Hand.

## Wichtig für zuverlässiges Tracking
- Standort „Während der Nutzung der App" erlauben, Benachrichtigungen erlauben.
- Akku-Optimierung für die App ausschalten – die App zeigt dafür im Spiel einen Hinweis mit Knopf.
  Manche Hersteller (Xiaomi, Huawei, Samsung) beenden Hintergrunddienste sonst trotzdem
  (siehe https://dontkillmyapp.com).

## Funktionen
- Neu in 2.5: Einstellungen (⚙️ auf dem Startbildschirm): nach Updates suchen, automatische Prüfung,
  helles/dunkles Design, topografische Karte, Bildschirm im Spiel anlassen, GPS-Sparmodus, Foto-Qualität,
  Benachrichtigungen, Passwort ändern, Abmelden, Konto löschen, Zwischenspeicher leeren.
  Neuer Startbildschirm mit Profilbild, „Spiel beitreten“ im Mittelpunkt und Kacheln.
- Neu in 2.4: Fotos im Vollbild mit Emoji-Reaktionen, Karten-Tab nur mit Karte (Hinweise im Aktionen-Tab),
  Spielverlauf mit vergangenen Runden, Profilbild, persönliche Galerie und Vitrine, seltenere Fähigkeiten
- Neu in 2.3: Chat für alle (🌍), alle Fotos nach Spielende als ZIP, eigene Quests im Einstellungs-Formular,
  Spielleitung ohne Vorteile, wenn sie selbst mitspielt
- Neu in 2.2: Profil mit Verlauf, Saisons und Abzeichen; Freunde und Einladungen (mit Benachrichtigung, solange die App offen ist);
  Saison-Bestenliste; Versorgungsabwürfe 📦; Spielleitung kann Spiele mit allen Einstellungen in der App anlegen und bearbeiten
- Neu in 2.1: Team-Chat mit Sprachnachrichten (🎙️ gedrückt halten), Zuschauer-Modus, Wiederholung nach Spielende,
  Abzeichen in der Bestenliste (Eintrag antippen), Abklingzeiten, Seitenwechsel (gefangen = jetzt Hunter),
  Spielleitung in der App für Admin-Accounts, Positionen im Funkloch werden nachgereicht,
  GPS fragt seltener ab, wenn man stillsteht (spart Akku)
- Account mit E-Mail-Bestätigung (Registrieren, Code eingeben, Passwort vergessen); Name im Spiel = Benutzername
- Bestenliste und Galerie der besten Fotos (mit Fotograf), direkt in der App
- Tab „Aktionen“: Fähigkeiten einsetzen (Freeze, Tarnkappe, Radar …), Quests mit Countdown, Ziel auf der Karte
  und Foto-Knopf, Fähigkeiten zum Einsammeln (🎁) – werden automatisch eingesammelt, sobald man nah genug ist
- Eingefrorene Hunter sehen einen Freeze-Bildschirm mit Countdown (und können ggf. den Eisbrecher einsetzen)
- Live-Strafe: Kommt das Foto zu spät, sendet die App automatisch alle paar Sekunden (Hinweis oben)
- Genauerer Standort: GPS läuft feiner als gesendet wird, gesendet wird die genaueste Position der letzten 15 s;
  Warnung, wenn nur „ungefährer Standort“ erlaubt ist
- Anti-Cheat: Die App meldet aktive VPNs und Fake-GPS-Positionen an den Server
- Beitreten per Code oder Einladungslink, Regeln des Spiels vorab sichtbar
- Karte (OpenStreetMap): eigene GPS-Position mit Genauigkeit, Spieler mit Namen, Spuren, Spielzone,
  Unschärfe-Kreise (wenn die Spielleitung Positionen verwischt), veraltete Positionen blass,
  „Alle zeigen" und „Zu mir"
- Hunter: Entfernung und Himmelsrichtung zum nächsten Runner, Runner als gefangen markieren (mit Rückfrage)
- Runner: Foto-Runden im festen Takt ab Spielstart (wie auf der Website) mit Countdown und Alarm,
  „Ich wurde gefangen", Warnung beim Verlassen der Spielzone, Vorsprung-Countdown
- Standort wird nur gesendet, wenn die Spielregeln es vorsehen (Hunter z. B. nur, wenn Hunter sichtbar sind)
- Spieler-Liste mit „Karte"-Sprung, Foto-Galerie mit Zähler für neue Fotos, Meldungen der Spielleitung

## Aufbau
- `TrackingService`  Foreground-Service: GPS, Senden im Intervall der Spielleitung, Foto-Alarm,
                     Benachrichtigungen bei Spielereignissen
- `GameRepository`   Sitzung, Zustand, Live-Updates per Server-Sent-Events (Fallback: Neuladen alle 20 s)
- `Api`              REST-Client (gleiche Endpunkte wie die Website: info, join, state, location, photo, caught, events)
- `Models`           Datenmodell + Spiellogik (Foto-Runden, wer teilt), mit Unit-Tests gegen echte Server-Antworten
- `Ui` / `MapTab`    Compose-Oberfläche, OpenStreetMap über osmdroid (kein API-Key nötig)

## Automatische Updates (Issue #5)

Ablauf: Push auf GitHub `main` (Änderung in `android/` oder `server/`) → GitHub-Workflow `.github/workflows/auto-tag.yml`
setzt den nächsten Tag `v<major>.<minor>.<n>` → Forgejo spiegelt Repo und Tag → Forgejo-Workflow
`.forgejo/workflows/build.yml` baut die APK mit dieser Version und hängt sie als Release an →
die App fragt **bei jedem Öffnen** `git.nebendahl.eu/api/v1/repos/Manhunt/manhunt/releases/latest` ab und bietet
„Jetzt aktualisieren“ an (Download mit Fortschritt, dann Android-Installer).

- `major.minor` steht in `app/build.gradle.kts` (`versionName`), die letzte Zahl zählt automatisch hoch.
  Kein neuer Tag: `[skip tag]` in die Commit-Nachricht.
- Beim ersten Update fragt Android, ob Manhunt Apps installieren darf – einmal erlauben.

**Einmalig einrichten:**

1. **Signierschlüssel (wichtig!)** – sonst signiert jeder CI-Build mit einem neuen Zufallsschlüssel und Android
   lehnt jedes Update ab („App nicht installiert“). Schlüssel einmal erzeugen (z. B. mit `./build.sh`, liegt dann in
   `android/keystore/manhunt.jks`, Passwort in `android/keystore.properties`) und in **Forgejo** →
   Manhunt/manhunt → Einstellungen → Actions → Secrets anlegen:
   - `MANHUNT_KEYSTORE_BASE64` = Ausgabe von `base64 -w0 android/keystore/manhunt.jks`
   - `MANHUNT_KEYSTORE_PASSWORD` = das `storePassword`

   Wer schon eine APK mit einem anderen Schlüssel installiert hat, muss **einmal** deinstallieren und neu installieren
   (die App erkennt das und sagt es im Update-Dialog). Account und Punkte liegen auf dem Server und bleiben erhalten.
2. **Optional, damit Updates sofort kommen:** Forgejo spiegelt GitHub nur alle 8 Stunden. Mit einem Forgejo-Token
   (Schreibrecht auf Manhunt/manhunt) als **GitHub**-Secret `FORGEJO_TOKEN` stößt der Auto-Tag-Workflow die
   Synchronisation sofort an.
3. `RELEASE_TOKEN` (Forgejo-Secret zum Anlegen der Releases) ist schon eingerichtet.

## Forgejo
Der Workflow `.forgejo/workflows/build.yml` testet und baut bei jedem Push auf `main` (und manuell über „Actions“)
die APK und hängt sie als Artefakt `manhunt-apk` an den Lauf. Voraussetzung ist ein aktiver Forgejo-Runner mit
Docker; das `runs-on`-Label muss zu deinem Runner passen. Damit die CI-APK denselben Schlüssel wie `build.sh`
nutzt, die Secrets `MANHUNT_KEYSTORE_BASE64` (`base64 -w0 keystore/manhunt.jks`) und
`MANHUNT_KEYSTORE_PASSWORD` anlegen.
