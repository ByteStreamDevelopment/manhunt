#!/usr/bin/env bash
# Baut out/manhunt.apk (Release, mit eigenem festen Schlüssel signiert, direkt installierbar).
#
# Beim ersten Lauf wird ein Signierschlüssel unter keystore/manhunt.jks erzeugt (nicht im Git!).
# Diesen Schlüssel unbedingt aufheben/sichern: Nur damit signierte APKs lassen sich als Update
# über eine installierte App installieren.
set -euo pipefail
cd "$(dirname "$0")"

docker build -t manhunt-apk-builder .

run() {
  docker run --rm \
    -v "$PWD":/project \
    -v manhunt-gradle-cache:/root/.gradle \
    manhunt-apk-builder "$@"
}

if [ ! -f keystore.properties ]; then
  mkdir -p keystore
  PASS="$(head -c 24 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 24)"
  echo "Erzeuge Signierschlüssel keystore/manhunt.jks …"
  run keytool -genkeypair -v -keystore keystore/manhunt.jks -alias manhunt \
    -keyalg RSA -keysize 4096 -validity 36500 \
    -storepass "$PASS" -keypass "$PASS" \
    -dname "CN=Manhunt, O=nebendahl.eu, C=DE" >/dev/null
  cat > keystore.properties <<PROPS
storeFile=keystore/manhunt.jks
storePassword=$PASS
keyAlias=manhunt
keyPassword=$PASS
PROPS
  chmod 600 keystore.properties
fi

run gradle --no-daemon assembleRelease
mkdir -p out
cp app/build/outputs/apk/release/app-release.apk out/manhunt.apk

PASS="$(grep '^storePassword=' keystore.properties | cut -d= -f2-)"
FP="$(run keytool -list -v -keystore keystore/manhunt.jks -alias manhunt -storepass "$PASS" \
  | grep 'SHA256:' | head -n1 | awk '{print $2}')"
echo
echo "Fertig: $PWD/out/manhunt.apk"
echo "Signatur-Fingerabdruck (SHA-256): $FP"
echo "Für App-Links in server/.env eintragen:  ANDROID_CERT_SHA256=$FP"
