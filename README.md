# Manhunt

Monorepo for Manhunt:

- [`android/`](android/) – Android app (Kotlin)
- [`server/`](server/) – Node.js server

Details on building and running are in each folder's README.

## Releases und Updates

Jeder Push auf `main`, der App oder Server ändert, bekommt automatisch einen Versions-Tag (`v2.3.0`, `v2.3.1`, …).
Forgejo baut daraus die APK und veröffentlicht sie unter https://git.nebendahl.eu/Mrcoolgamer-Inc/manhunt/releases –
die App meldet beim Öffnen, wenn eine neue Version da ist. Einrichtung: siehe [`android/README.md`](android/README.md#automatische-updates-issue-5).
