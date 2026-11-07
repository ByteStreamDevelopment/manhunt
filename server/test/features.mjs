// Schneller Test der Funktionen aus Version 2.1 (ohne Wartezeiten). Aufruf: node test/features.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 3800 + Math.floor(Math.random() * 90);
const B = `http://127.0.0.1:${PORT}`;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'manhunt-feat-'));
let LOG = '', srv = null;
function start(extraEnv = {}) {
  srv = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(ROOT, 'server.js')], {
    env: { ...process.env, ADMIN_PASSWORD: 'test', DATA_DIR: DATA, PORT: String(PORT), HOST: '127.0.0.1', SMTP_HOST: '', VPN_CHECK: 'off', OVERPASS_URL: 'http://127.0.0.1:1/none', ...extraEnv },
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
const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.alloc(300, 1)]);

await start();
const admin = await account('ProfImpossible', 'test');
const T = admin.adminToken;
const A = {}; for (const n of ['Rita', 'Rolf', 'Hans', 'Zoe']) A[n] = await account(n);

console.log('SQLite + Neustart');
let g = await api('/api/admin/games', { token: T, body: { name: 'Feat', settings: { locationIntervalSec: 10, spectatorDelaySec: 60, questsEnabled: false, pickupsEnabled: false, abilities: { freeze: { start: 2, cooldownSec: 60 } } } } });
const C = g.code;
const R = await api(`/api/g/${C}/join`, { acc: A.Rita.token, body: { role: 'runner' } });
const R2 = await api(`/api/g/${C}/join`, { acc: A.Rolf.token, body: { role: 'runner' } });
const H = await api(`/api/g/${C}/join`, { acc: A.Hans.token, body: { role: 'hunter' } });
const S = await api(`/api/g/${C}/join`, { acc: A.Zoe.token, body: { role: 'spectator' } });
ok(S.role === 'spectator', 'Zuschauer kann beitreten');
await api(`/api/admin/games/${C}/start`, { token: T, body: {} });
await api(`/api/g/${C}/location`, { token: R.token, body: { lat: 52.5, lng: 13.4, acc: 6 } });
await stop(); await start();
let st = await api(`/api/g/${C}/state`, { token: R.token });
ok(st.game.status === 'running' && st.players.find((p) => p.name === 'Rita').loc?.lat === 52.5, 'Spiel und Position überleben einen Neustart');
ok(fs.existsSync(path.join(DATA, 'manhunt.sqlite')), 'Datenbank-Datei manhunt.sqlite angelegt');

console.log('Offline-Positionen nachreichen');
const now = st.now;
let r = await api(`/api/g/${C}/locations`, { token: R.token, body: { points: [
  { lat: 52.5001, lng: 13.4, acc: 5, ts: now + 1000 }, { lat: 52.5002, lng: 13.4, acc: 5, ts: now + 2000 }, { lat: 52.5003, lng: 13.4, acc: 5, ts: now - 60 * 60000 },
] } });
ok(r.accepted === 2, `2 von 3 Punkten angenommen (zu alter verworfen): ${r.accepted}`);
st = await api(`/api/g/${C}/state`, { token: T });
ok(st.players.find((p) => p.name === 'Rita').trail.length === 3, 'Route enthält die nachgereichten Punkte');

console.log('Abklingzeit und Freeze-Immunität');
r = await api(`/api/g/${C}/ability`, { token: R.token, body: { key: 'freeze' } });
ok(r.ok, 'Freeze 1 eingesetzt');
r = await api(`/api/g/${C}/ability`, { token: R.token, body: { key: 'freeze' } });
ok(r.http === 409 && /Abklingzeit/.test(r.error), `Freeze 2 sofort danach: Abklingzeit (${r.error})`);
st = await api(`/api/g/${C}/state`, { token: R.token });
ok(st.self.cooldowns.some((c) => c.key === 'freeze'), 'Abklingzeit steht im Zustand');
r = await api(`/api/g/${C}/ability`, { token: R2.token, body: { key: 'freeze' } });
ok(r.http === 409 && /immun/.test(r.error), `Zweiter Runner: Hunter noch immun (${r.error})`);

console.log('Team-Chat und Sprachnachricht');
r = await api(`/api/g/${C}/chat`, { token: R.token, body: { text: 'Treffpunkt am Brunnen' } });
ok(r.ok, 'Runner schreibt im Chat');
r = await api(`/api/g/${C}/chat`, { token: R.token, body: { text: 'Spam' } });
ok(r.http === 429, 'Zu schnelle Nachrichten gebremst');
const audio = Buffer.alloc(4000, 7);
r = await api(`/api/g/${C}/chat/voice?dur=3`, { token: R2.token, body: audio, headers: { 'content-type': 'audio/mp4' } });
ok(r.ok, 'Sprachnachricht hochgeladen');
st = await api(`/api/g/${C}/state`, { token: R.token });
const vmsg = st.chat.find((c) => c.voice);
ok(st.chat.length === 2 && vmsg?.voice.dur === 3, 'Runner sehen Text und Sprachnachricht');
let sh = await api(`/api/g/${C}/state`, { token: H.token });
ok(sh.chat.length === 0, 'Hunter sehen den Runner-Chat nicht');
let resp = await api(`/api/g/${C}/chat/voice/${vmsg.voice.id}`, { token: H.token, raw: true });
ok(resp.status === 404, 'Hunter kann Runner-Sprachnachricht nicht abrufen');
resp = await api(`/api/g/${C}/chat/voice/${vmsg.voice.id}`, { token: R.token, raw: true });
ok(resp.status === 200 && resp.headers.get('content-type') === 'audio/mp4', 'Runner kann sie abspielen');

console.log('Zuschauer');
let ss = await api(`/api/g/${C}/state`, { token: S.token });
ok(ss.self.role === 'spectator' && ss.self.spectatorDelaySec === 60, 'Zuschauer-Zustand mit Verzögerung');
ok(!ss.players.find((p) => p.name === 'Rita').loc || ss.players.find((p) => p.name === 'Rita').loc.ts <= ss.now - 60000, 'Zuschauer sehen keine Positionen jünger als 60 s');
r = await api(`/api/g/${C}/location`, { token: S.token, body: { lat: 52.5, lng: 13.4, acc: 5 } });
ok(r.http === 403, 'Zuschauer können keine Position senden');

console.log('Quest-Foto ablehnen, Fotos');
r = await api(`/api/g/${C}/photo`, { token: R.token, body: jpeg });
st = await api(`/api/g/${C}/state`, { token: T });
r = await api(`/api/admin/games/${C}/rejectphoto`, { token: T, body: { photoId: st.photos[0].id } });
st = await api(`/api/g/${C}/state`, { token: R.token });
ok(st.photos.length === 0 && st.self.inbox.some((m) => m.text.includes('abgelehnt')), 'Foto abgelehnt und entfernt, Spieler informiert');

console.log('Gefangen -> Hunter');
r = await api(`/api/g/${C}/caught`, { token: H.token, body: { playerId: R.id, caught: true } });
ok(r.http === 409, 'Eingefrorener Hans kann nicht fangen');
r = await api(`/api/g/${C}/caught`, { token: T, body: { playerId: R.id, caught: true } });
st = await api(`/api/g/${C}/state`, { token: R.token });
ok(st.self.role === 'hunter' && st.self.converted && st.game.status === 'running', 'Gefangene Rita ist jetzt Hunter, Spiel läuft weiter');
ok(st.self.abilities.some((a) => a.key === 'radar') && !st.self.abilities.some((a) => a.key === 'freeze'), 'Rita hat jetzt Hunter-Fähigkeiten');
r = await api(`/api/g/${C}/caught`, { token: R.token, body: { playerId: R2.id, caught: true } });
st = await api(`/api/g/${C}/state`, { token: T });
ok(st.game.status === 'ended', 'Rita fängt Rolf -> alle gefangen -> Spiel vorbei');
const lb = await api('/api/leaderboard');
const rita = lb.rows.find((x) => x.username === 'Rita');
ok(rita.badges.includes('turncoat') && rita.badges.includes('firstCatch') && rita.badges.includes('iceAge') === false, `Abzeichen für Rita: ${rita.badges.join(', ')}`);
ok(rita.wins === 1, 'Übergelaufene Rita gewinnt mit den Huntern');
st = await api(`/api/g/${C}/state`, { token: R.token });
ok(st.self.inbox.some((m) => m.text.includes('Abzeichen')), 'Abzeichen werden gemeldet');

console.log('IP hinter Proxy');
await stop(); await start({ TRUST_PROXY: 'never' }); // wie ein direkt aus dem Internet erreichbarer Server
for (let i = 0; i < 6; i++) await api('/api/admin/login', { body: { password: 'falsch' }, headers: { 'x-forwarded-for': `1.2.3.${i}` } });
r = await api('/api/admin/login', { body: { password: 'falsch' }, headers: { 'x-forwarded-for': '9.9.9.9' } });
ok(r.http === 429, 'Gefälschtes X-Forwarded-For umgeht die Bremse nicht (direkte Verbindung)');

console.log(fails ? `\n${fails} FEHLER` : '\nAlles OK');
await stop();
process.exit(fails ? 1 : 0);
