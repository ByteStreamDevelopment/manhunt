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
- Beitreten per Code oder Einladungslink, Regeln des Spiels vorab sichtbar, Name wird gemerkt
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

## Forgejo
Der Workflow `.forgejo/workflows/build.yml` testet und baut bei jedem Push auf `main` (und manuell über „Actions“)
die APK und hängt sie als Artefakt `manhunt-apk` an den Lauf. Voraussetzung ist ein aktiver Forgejo-Runner mit
Docker; das `runs-on`-Label muss zu deinem Runner passen. Damit die CI-APK denselben Schlüssel wie `build.sh`
nutzt, die Secrets `MANHUNT_KEYSTORE_BASE64` (`base64 -w0 keystore/manhunt.jks`) und
`MANHUNT_KEYSTORE_PASSWORD` anlegen.
