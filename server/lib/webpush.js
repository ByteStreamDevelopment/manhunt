'use strict';
/**
 * Web Push ohne Abhängigkeiten: VAPID (RFC 8292) und Verschlüsselung "aes128gcm" (RFC 8291 / RFC 8188).
 * Damit bekommen Browser und als Web-App installierte Seiten (auch iPhone ab iOS 16.4) Benachrichtigungen.
 */
const crypto = require('node:crypto');

const b64u = (buf) => Buffer.from(buf).toString('base64url');
const fromB64u = (s) => Buffer.from(String(s), 'base64url');

/** Neues VAPID-Schlüsselpaar (als JWK, zum Speichern). */
function generateVapidKeys() {
  const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  return privateKey.export({ format: 'jwk' });
}
/** Öffentlicher Schlüssel als unkomprimierter Punkt (65 Bytes, base64url) – den braucht der Browser. */
function vapidPublicKey(jwk) {
  return b64u(Buffer.concat([Buffer.from([4]), fromB64u(jwk.x), fromB64u(jwk.y)]));
}

/**
 * Verschlüsselt eine Nachricht für ein Abo (keys.p256dh, keys.auth).
 * opts.salt / opts.asPrivate nur für Tests (feste Werte aus RFC 8291, Anhang A).
 */
function encrypt(payload, keys, opts = {}) {
  const uaPublic = fromB64u(keys.p256dh);
  const authSecret = fromB64u(keys.auth);
  const ecdh = crypto.createECDH('prime256v1');
  if (opts.asPrivate) ecdh.setPrivateKey(fromB64u(opts.asPrivate)); else ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  const ecdhSecret = ecdh.computeSecret(uaPublic);
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', ecdhSecret, authSecret, keyInfo, 32));
  const salt = opts.salt ? fromB64u(opts.salt) : crypto.randomBytes(16);
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const plain = Buffer.concat([Buffer.from(payload), Buffer.from([2])]); // 0x02 = letzter Datensatz
  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const body = Buffer.concat([cipher.update(plain), cipher.final(), cipher.getAuthTag()]);
  const rs = Buffer.alloc(4); rs.writeUInt32BE(4096);
  return Buffer.concat([salt, rs, Buffer.from([asPublic.length]), asPublic, body]);
}

/** VAPID-Kopfzeile für einen Push-Dienst. */
function vapidHeader(endpoint, jwk, subject) {
  const aud = new URL(endpoint).origin;
  const header = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const claims = b64u(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject }));
  const key = crypto.createPrivateKey({ key: jwk, format: 'jwk' });
  const sig = crypto.sign('sha256', Buffer.from(`${header}.${claims}`), { key, dsaEncoding: 'ieee-p1363' });
  return `vapid t=${header}.${claims}.${b64u(sig)}, k=${vapidPublicKey(jwk)}`;
}

/**
 * Schickt eine Benachrichtigung. Gibt 'ok', 'gone' (Abo abgelaufen -> löschen) oder 'error' zurück.
 */
async function send(sub, data, jwk, subject) {
  try {
    const body = encrypt(JSON.stringify(data), sub.keys);
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 10000);
    const r = await fetch(sub.endpoint, {
      method: 'POST', signal: ctrl.signal, body,
      headers: {
        Authorization: vapidHeader(sub.endpoint, jwk, subject),
        'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream',
        TTL: '600', Urgency: data.urgent ? 'high' : 'normal',
      },
    });
    clearTimeout(t);
    if (r.status === 404 || r.status === 410) return 'gone';
    return r.ok ? 'ok' : 'error';
  } catch {
    return 'error';
  }
}

/** Prüft ein Abo-Objekt aus dem Browser. */
function validSubscription(s) {
  try {
    if (!s || typeof s.endpoint !== 'string' || !s.keys) return false;
    const u = new URL(s.endpoint);
    if (u.protocol !== 'https:' && !(process.env.PUSH_ALLOW_HTTP === '1' && u.protocol === 'http:')) return false; // http nur für Tests
    return fromB64u(s.keys.p256dh).length === 65 && fromB64u(s.keys.auth).length === 16;
  } catch { return false; }
}

module.exports = { generateVapidKeys, vapidPublicKey, encrypt, vapidHeader, send, validSubscription };
