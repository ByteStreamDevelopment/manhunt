# Manhunt – Android-App (nativ, Kotlin + Jetpack Compose)

Spieler-App für https://manhunt.nebendahl.eu. Die Spielleitung (/admin) bleibt im Browser.

## APK bauen (auf dem VPS)
    ./build.sh
Ergebnis: `out/manhunt.apk` (Debug-signiert, direkt installierbar).
Erster Lauf dauert einige Minuten (Android-SDK + Abhängigkeiten), danach geht es schnell (Gradle-Cache-Volume).

## Installieren
APK aufs Handy kopieren, antippen, „Unbekannte Quellen" für den Dateimanager/Browser erlauben.
Oder per USB: `adb install out/manhunt.apk`.

## Server-Adresse ändern
`app/build.gradle.kts` -> `BASE_URL`.

## Wichtig für zuverlässiges Tracking
- Standort: „Immer/Während der Nutzung" erlauben, Benachrichtigungen erlauben.
- Akku-Optimierung für die App ausschalten (Einstellungen -> Apps -> Manhunt -> Akku -> Nicht optimieren).
  Manche Hersteller (Xiaomi, Huawei, Samsung) beenden Hintergrunddienste sonst trotzdem.

## Aufbau
- `TrackingService`  Foreground-Service: Standort im Intervall der Spielleitung, Foto-Erinnerung (Benachrichtigung + Vibration)
- `GameRepository`   Sitzung, Zustand, Live-Updates per Server-Sent-Events (Fallback: Neuladen alle 20 s)
- `Api`              REST-Client (gleiche Endpunkte wie die Website: info, join, state, location, photo, caught, events)
- `Ui` / `MapTab`    Compose-Oberfläche, OpenStreetMap über osmdroid (kein API-Key nötig)

## Einladungslinks
Links `https://manhunt.nebendahl.eu/g/CODE` bieten das Öffnen mit der App an und füllen den Code vor.

## Forgejo
Der Workflow `.forgejo/workflows/build.yml` baut bei jedem Push auf `main` (und manuell über „Actions“) die APK
und hängt sie als Artefakt `manhunt-apk` an den Lauf. Voraussetzung ist ein aktiver Forgejo-Runner mit Docker;
das `runs-on`-Label muss zu deinem Runner passen.
