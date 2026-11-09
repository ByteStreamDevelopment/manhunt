// Runden für alle, Speicherkontingent (2.6). Aufruf: node test/hosting.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import crypto from 'node:crypto';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 3900 + Math.floor(Math.random() * 90);
const B = `http://127.0.0.1:${PORT}`;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'manhunt-host-'));
let LOG = '', srv = null;
function start(extraEnv = {}) {
  srv = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(ROOT, 'server.js')], {
    env: { ...process.env, PUSH_ALLOW_HTTP: '1', ADMIN_PASSWORD: 'test', DATA_DIR: DATA, PORT: String(PORT), HOST: '127.0.0.1', SMTP_HOST: '', VPN_CHECK: 'off', OVERPASS_URL: 'http://127.0.0.1:1/none', ...extraEnv },
  });
  srv.stdout.on('data', (d) => { LOG += d; });
  srv.stderr.on('data', (d) => { LOG += d; });
  return new Promise((r) => { const t = setInterval(() => { if (LOG.includes('läuft auf')) { clearInterval(t); r(); } }, 50); });
}
async function stop() { const p = new Promise((r) => srv.once('exit', r)); srv.kill('SIGTERM'); await p; LOG = LOG.replace(/läuft auf/g, 'lief auf'); }
process.on('exit', () => { try { srv.kill(); } catch {} fs.rmSync(DATA, { recursive: true, force: true }); });

let fails = 0;
const ok = (c, msg) => { console.log((c ? '  ✓ ' : '  ✗ ') + msg); if (!c) fails++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function api(p, { method, body, token, acc, headers = {}, raw } = {}) {
  const h = { ...headers }; if (token) h['x-token'] = token; if (acc) h['x-account'] = acc;
  let payload;
  if (Buffer.isBuffer(body)) { payload = body; h['content-type'] ||= 'image/jpeg'; }
  else if (body !== undefined) { payload = JSON.stringify(body); h['content-type'] = 'application/json'; }
  const r = await fetch(B + p, { method: method || (body !== undefined ? 'POST' : 'GET'), headers: h, body: payload });
  if (raw) return r;
  let j = {}; try { j = await r.json(); } catch {}
  return { http: r.status, ...j };
}
const code = (email) => { const t = LOG.split(`Mail an ${email}`); return t[t.length - 1].match(/\b(\d{6})\b/)[1]; };
async function account(name, adminKey) {
  await api('/api/auth/register', { body: { username: name, email: `${name.toLowerCase()}@x.de`, password: 'geheim123', adminKey } });
  await sleep(100);
  return api('/api/auth/verify', { body: { login: name, code: code(`${name.toLowerCase()}@x.de`) } });
}
const jpeg = (n) => Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.alloc(n, 1)]);
let r;

// Kleines Kontingent (1 MB) und höchstens 2 offene Runden, damit der Test schnell ist
await start({ USER_QUOTA_MB: '1', MAX_OPEN_GAMES: '2' });
const admin = await account('ProfImpossible', 'test');
const T = admin.adminToken;
const A = {}; for (const n of ['Nora', 'Paul', 'Ida']) A[n] = await account(n);
const Z = await account('Zed');

console.log('Jeder Account kann Runden anlegen');
r = await api('/api/admin/games', { token: A.Nora.token, body: { name: 'Noras Runde', settings: { questsEnabled: false, pickupsEnabled: false, photoIntervalMin: 1 } } });
ok(r.http === 201 && r.mine === true && r.owner === 'Nora', 'Normaler Spieler legt eine Runde an');
const C = r.code;
r = await api('/api/admin/games', { token: 'quatsch', body: { name: 'x' } });
ok(r.http === 401, 'Ohne Anmeldung keine Runde');
r = await api('/api/admin/catalog', { token: A.Nora.token });
ok(r.superAdmin === false && r.storage.quota === 1024 * 1024 && r.defaults, 'Katalog mit Kontingent und Standardwerten');
r = await api('/api/admin/games', { token: A.Paul.token });
ok(r.games.length === 0, 'Andere sehen fremde Runden nicht in ihrer Liste');
r = await api(`/api/admin/games/${C}/start`, { token: A.Paul.token, body: {} });
ok(r.http === 404, 'Fremde Runde lässt sich nicht steuern');
r = await api(`/api/admin/games/${C}`, { method: 'DELETE', token: A.Paul.token });
ok(r.http === 404, 'Fremde Runde lässt sich nicht löschen');
r = await api('/api/admin/games', { token: T });
ok(r.games.some((g) => g.code === C && g.owner === 'Nora' && g.mine === false), 'Admin sieht alle Runden mit Besitzer');
r = await api('/api/admin/accounts', { token: A.Nora.token });
ok(r.http === 403, 'Accounts nur für Admins');
r = await api('/api/admin/photos/purge', { token: A.Nora.token, body: {} });
ok(r.http === 403, 'Alle Fotos löschen nur für Admins');

console.log('Höchstens 2 offene Runden');
const C2 = (await api('/api/admin/games', { token: A.Nora.token, body: { name: 'Zwei' } })).code;
r = await api('/api/admin/games', { token: A.Nora.token, body: { name: 'Drei' } });
ok(r.http === 409 && /offene Runden/.test(r.error), 'Dritte offene Runde abgelehnt');
r = await api(`/api/admin/games/${C2}`, { method: 'DELETE', token: A.Nora.token });
ok(r.ok, 'Eigene Runde gelöscht');

console.log('Spielleitung ohne mitzuspielen: Rundumsicht');
const P = await api(`/api/g/${C}/join`, { acc: A.Paul.token, body: { role: 'runner' } });
const I = await api(`/api/g/${C}/join`, { acc: A.Ida.token, body: { role: 'hunter' } });
await api(`/api/admin/games/${C}/start`, { token: A.Nora.token, body: {} });
r = await api(`/api/g/${C}/state`, { token: A.Nora.token });
ok(r.self?.role === 'admin' && r.canFeature === false && r.game.owner === 'Nora', 'Besitzerin sieht die Runde als Spielleitung');
r = await api(`/api/g/${C}/state`, { token: A.Paul.token });
ok(r.self?.role === 'runner', 'Mitspieler mit Konto-Token sieht seine Spieler-Ansicht');

console.log('Speicherkontingent (1 MB)');
r = await api(`/api/g/${C}/photo`, { token: P.token, body: jpeg(600 * 1024) });
ok(r.stored === true, 'Erstes Foto gespeichert');
r = await api('/api/admin/games', { token: A.Nora.token });
ok(r.storage.used > 600 * 1024 && r.games[0].bytes > 600 * 1024, 'Belegter Speicher wird angezeigt');
r = await api(`/api/g/${C}/photo`, { token: P.token, body: jpeg(420 * 1024) });
ok(r.stored === true, 'Zweites Foto passt noch');
r = await api(`/api/g/${C}/photo`, { token: P.token, body: jpeg(600 * 1024) });
ok(r.ok && r.stored === false && /Speicher/.test(r.warning), 'Kontingent voll: Foto zählt, wird aber nicht gespeichert');
let st = await api(`/api/g/${C}/state`, { token: P.token });
ok(st.photos.length === 2 && st.messages.some((m) => /Speicherplatz/.test(m.text)), 'Nur zwei Fotos gespeichert, alle bekommen eine Meldung');
r = await api(`/api/admin/games/${C}/feature`, { token: A.Nora.token, body: { photoId: st.photos[0].id } });
ok(r.http === 403, 'Galerie bleibt den Admins vorbehalten');
r = await api(`/api/admin/games/${C}/purgephotos`, { token: A.Nora.token, body: {} });
ok(r.http === 409, 'Fotos löschen erst nach Spielende');
await api(`/api/admin/games/${C}/end`, { token: A.Nora.token, body: {} });
r = await api('/api/admin/games', { token: A.Nora.token, body: { name: 'Voll' } });
ok(r.http === 507, 'Neue Runde bei vollem Speicher abgelehnt');
r = await api(`/api/admin/games/${C}/purgephotos`, { token: A.Nora.token, body: {} });
ok(r.photos === 0 && r.bytes === 0, 'Fotos der Runde gelöscht, Speicher frei');
st = await api(`/api/g/${C}/state`, { token: P.token });
ok(st.game.status === 'ended' && st.players.length === 2, 'Ergebnis und Spieler bleiben erhalten');

console.log('Admins: eigenes Kontingent, Übersicht, löschen');
r = await api(`/api/admin/accounts/${A.Nora.account.id}/quota`, { token: T, body: { mb: 5 } });
ok(r.storage.quota === 5 * 1024 * 1024, 'Admin setzt eigenes Kontingent');
r = await api('/api/admin/storage', { token: T });
ok(r.rows.some((x) => x.username === 'Nora') && r.defaultQuotaMb === 1, 'Speicherübersicht für Admins');
const C3 = (await api('/api/admin/games', { token: A.Nora.token, body: { name: 'Drei' } })).code;
await api(`/api/admin/games/${C3}/start`, { token: A.Nora.token, body: {} });
r = await api(`/api/admin/games/${C3}`, { method: 'DELETE', token: A.Nora.token });
ok(r.http === 409, 'Laufende eigene Runde erst beenden, dann löschen');
r = await api(`/api/admin/games/${C3}`, { method: 'DELETE', token: T });
ok(r.ok, 'Admin löscht jede Runde');

console.log('Web-Anmeldung für alle');
r = await api('/api/admin/login', { body: { username: 'Ida', password: 'geheim123' } });
ok(r.token && r.superAdmin === false, 'Normaler Spieler meldet sich in /admin an');
r = await api('/api/admin/games', { token: r.token });
ok(Array.isArray(r.games) && r.superAdmin === false, 'und sieht seine Runden');

console.log('Mit-Spielleitung');
const Cc = (await api('/api/admin/games', { token: A.Nora.token, body: { name: 'Co', settings: { questsEnabled: false, pickupsEnabled: false } } })).code;
r = await api(`/api/admin/games/${Cc}/cohost`, { token: A.Nora.token, body: { username: 'Ida' } });
ok(r.cohosts?.includes('Ida'), 'Besitzerin ernennt Ida zur Mit-Spielleitung');
r = await api('/api/admin/games', { token: A.Ida.token });
ok(r.games.some((g) => g.code === Cc && g.cohost === true && g.mine === false), 'Mit-Spielleitung sieht die Runde in ihrer Liste');
r = await api(`/api/admin/games/${Cc}/announce`, { token: A.Ida.token, body: { text: 'Hallo' } });
ok(r.code === Cc, 'Mit-Spielleitung kann Durchsagen machen');
r = await api(`/api/admin/games/${Cc}/cohost`, { token: A.Ida.token, body: { username: 'Paul' } });
ok(r.http === 403, 'Mit-Spielleitung kann keine weitere ernennen');
r = await api(`/api/admin/games/${Cc}`, { method: 'DELETE', token: A.Ida.token });
ok(r.http === 403, 'Mit-Spielleitung kann die Runde nicht löschen');

console.log('Sperren und Melden');
const Pc = await api(`/api/g/${Cc}/join`, { acc: A.Paul.token, body: { role: 'runner' } });
const Zc = await api(`/api/g/${Cc}/join`, { acc: Z.token, body: { role: 'hunter' } });
r = await api(`/api/g/${Cc}/report`, { token: Pc.token, body: { playerId: Zc.id, reason: 'Beleidigung', note: 'sagt böse Sachen' } });
ok(r.ok, 'Spieler melden');
r = await api(`/api/g/${Cc}/report`, { token: Pc.token, body: { playerId: Zc.id, reason: 'Beleidigung' } });
ok(r.http === 409, 'Doppelt melden geht nicht');
await api(`/api/admin/games/${Cc}/start`, { token: A.Nora.token, body: {} });
const ph = await api(`/api/g/${Cc}/photo`, { token: Pc.token, body: jpeg(2000) });
r = await api(`/api/g/${Cc}/photo/${ph.id}/report`, { token: Zc.token, body: { reason: 'Privatsphäre' } });
ok(r.ok, 'Foto melden');
r = await api('/api/admin/reports', { token: A.Nora.token });
ok(r.http === 403, 'Meldungen sehen nur Admins');
r = await api('/api/admin/reports', { token: T });
const photoRep = r.reports.find((x) => x.kind === 'photo'), playerRep = r.reports.find((x) => x.kind === 'player');
ok(r.reports.length === 2 && photoRep.photoAvailable && playerRep.note === 'sagt böse Sachen' && playerRep.target === 'Zed', 'Admin sieht beide Meldungen');
r = await api(`/api/admin/reports/${photoRep.id}`, { token: T, body: { action: 'deletephoto' } });
let stc = await api(`/api/g/${Cc}/state`, { token: Pc.token });
ok(r.ok && stc.photos.length === 0, 'Admin entfernt gemeldetes Foto');
r = await api(`/api/admin/games/${Cc}/ban`, { token: A.Ida.token, body: { playerId: Zc.id } });
ok(r.banned?.some((b) => b.username === 'Zed'), 'Spielleitung sperrt einen Spieler');
r = await api(`/api/g/${Cc}/join`, { acc: Z.token, body: { role: 'hunter' } });
ok(r.http === 403 && /gesperrt/.test(r.error), 'Gesperrter kann nicht wieder beitreten');
r = await api(`/api/admin/games/${Cc}/unban`, { token: A.Nora.token, body: { accountId: Z.account.id } });
ok(r.banned.length === 0, 'Sperre aufheben');
r = await api(`/api/admin/reports/${playerRep.id}`, { token: T, body: { action: 'dismiss' } });
ok(r.ok && (await api('/api/admin/reports', { token: T })).reports.length === 0, 'Meldung erledigt');
await api(`/api/admin/games/${Cc}/end`, { token: A.Nora.token, body: {} });

console.log('Vorlagen');
r = await api('/api/me/templates', { acc: A.Nora.token, body: { name: 'Stadtpark-Regeln', settings: { photoIntervalMin: 7, questsEnabled: false } } });
ok(r.templates?.length === 1, 'Vorlage gespeichert');
const tid = r.templates[0].id;
r = await api(`/api/me/templates/${tid}`, { acc: A.Nora.token });
ok(r.settings.photoIntervalMin === 7 && r.settings.questsEnabled === false && r.settings.abilities, 'Vorlage laden (vollständige Einstellungen)');
r = await api('/api/me/templates', { acc: A.Nora.token, body: { name: 'stadtpark-regeln', settings: { photoIntervalMin: 9 } } });
ok(r.templates.length === 1, 'Gleicher Name überschreibt');
r = await api(`/api/me/templates/${tid}`, { acc: A.Paul.token });
ok(r.http === 404, 'Fremde Vorlagen unsichtbar');
r = await api(`/api/me/templates/${tid}`, { method: 'DELETE', acc: A.Nora.token });
ok(r.ok, 'Vorlage gelöscht');

console.log('Offene Runden');
const Cp = (await api('/api/admin/games', { token: A.Nora.token, body: { name: 'Öffentlich', settings: { publicListed: true }, place: { lat: 52.5201, lng: 13.4049, name: 'Alexanderplatz' } } })).code;
r = await api('/api/public-games?lat=52.52&lng=13.40', { acc: A.Paul.token });
const pub = r.games.find((x) => x.code === Cp);
ok(pub && pub.km < 2 && pub.place === 'Alexanderplatz' && !r.games.some((x) => x.code === Cc), 'Öffentliche Runde mit Entfernung, private nicht gelistet');
r = await api('/api/public-games?lat=48.13&lng=11.58', { acc: A.Paul.token });
ok(!r.games.some((x) => x.code === Cp), 'Zu weit weg: nicht gelistet');
r = await api('/api/admin/games', { token: A.Nora.token });
ok(r.games.find((g) => g.code === Cp).place.lat === 52.52, 'Ort auf ~1 km gerundet');

console.log('Fotos laufen ab');
const Pp = await api(`/api/g/${Cp}/join`, { acc: A.Paul.token, body: { role: 'runner' } });
await api(`/api/admin/games/${Cp}/start`, { token: A.Nora.token, body: {} });
await api(`/api/g/${Cp}/photo`, { token: Pp.token, body: jpeg(2000) });
await api(`/api/admin/games/${Cp}/end`, { token: A.Nora.token, body: {} });
ok((await api('/api/admin/games', { token: T })).games.find((g) => g.code === Cp).photos === 1, 'Vor Ablauf: Foto vorhanden');
await sleep(1500);
await stop(); await start({ USER_QUOTA_MB: '1', MAX_OPEN_GAMES: '2', PHOTO_RETENTION_DAYS: '0.00001' });
stc = await api(`/api/g/${C}/state`, { token: P.token });
r = await api('/api/admin/games', { token: T });
ok(r.games.find((g) => g.code === Cp).photos === 0 && r.games.find((g) => g.code === Cp).status === 'ended', 'Fotos beendeter Runden nach Ablauf gelöscht');

console.log('Konto löschen gibt Runden frei');
r = await api('/api/me/delete', { acc: A.Nora.token, body: { password: 'geheim123' } });
ok(r.ok, 'Konto gelöscht');
st = await api(`/api/g/${C}/state`, { token: P.token });
ok(st.game.owner === null && st.game.status === 'ended', 'Beendete Runde bleibt für Mitspieler erhalten (ohne Besitzer)');

console.log(fails ? `\n${fails} FEHLER` : '\nAlles OK');
await stop();
process.exit(fails ? 1 : 0);
