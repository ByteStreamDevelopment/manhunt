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

console.log('Konto löschen gibt Runden frei');
r = await api('/api/me/delete', { acc: A.Nora.token, body: { password: 'geheim123' } });
ok(r.ok, 'Konto gelöscht');
st = await api(`/api/g/${C}/state`, { token: P.token });
ok(st.game.owner === null && st.game.status === 'ended', 'Beendete Runde bleibt für Mitspieler erhalten (ohne Besitzer)');

console.log(fails ? `\n${fails} FEHLER` : '\nAlles OK');
await stop();
process.exit(fails ? 1 : 0);
