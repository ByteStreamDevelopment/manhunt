// End-to-End-Test: startet einen Server mit leerem Datenordner und spielt alles einmal durch.
// Aufruf: npm test   (dauert gut 2 Minuten, weil Quests, Pickups und Foto-Runden echte Zeit brauchen)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const PORT = 3900 + Math.floor(Math.random() * 90);
const B = `http://127.0.0.1:${PORT}`;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'manhunt-e2e-'));
let LOGTXT = '';
const srv = spawn(process.execPath, [path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'server.js')], {
  env: { ...process.env, ADMIN_PASSWORD: 'test', DATA_DIR: DATA, PORT: String(PORT), HOST: '127.0.0.1', SMTP_HOST: '', VPN_CHECK: 'off', OVERPASS_URL: 'http://127.0.0.1:1/none' },
});
srv.stdout.on('data', (d) => { LOGTXT += d; });
srv.stderr.on('data', (d) => { LOGTXT += d; });
process.on('exit', () => { srv.kill(); fs.rmSync(DATA, { recursive: true, force: true }); });
for (let i = 0; i < 50 && !LOGTXT.includes('läuft auf'); i++) await new Promise((r) => setTimeout(r, 100));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? '  ✓ ' : '  ✗ ') + msg); if (!c) fails++; };
async function api(path, { method = 'GET', body, token, acc, headers = {} } = {}) {
  const h = { ...headers };
  if (token) h['x-token'] = token;
  if (acc) h['x-account'] = acc;
  let payload;
  if (Buffer.isBuffer(body)) { payload = body; h['content-type'] = 'image/jpeg'; }
  else if (body !== undefined) { payload = JSON.stringify(body); h['content-type'] = 'application/json'; }
  const r = await fetch(B + path, { method, headers: h, body: payload });
  let j = {}; try { j = await r.json(); } catch {}
  return { status: r.status, ...j };
}
const codeFromLog = (email) => {
  const txt = LOGTXT;
  const parts = txt.split(`Mail an ${email}`);
  return parts[parts.length - 1].match(/\b(\d{6})\b/)[1];
};
const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.alloc(300, 1)]);

console.log('Accounts');
let r = await api('/api/auth/register', { method: 'POST', body: { username: 'Rita', email: 'rita@example.com', password: 'geheim123' } });
ok(r.status === 201 && r.needsVerification, 'Registrierung verlangt Bestätigung');
r = await api('/api/auth/login', { method: 'POST', body: { login: 'Rita', password: 'geheim123' } });
ok(r.status === 403 && r.needsVerification, 'Login vor Bestätigung abgelehnt');
r = await api('/api/auth/verify', { method: 'POST', body: { login: 'rita@example.com', code: '000000' } });
ok(r.status === 400, 'Falscher Code abgelehnt');
await sleep(200);
r = await api('/api/auth/verify', { method: 'POST', body: { login: 'rita@example.com', code: codeFromLog('rita@example.com') } });
ok(r.status === 200 && r.token, 'Bestätigung mit Code aus Mail');
const RA = r.token;
r = await api('/api/auth/register', { method: 'POST', body: { username: 'profimpossible', email: 'p@example.com', password: 'geheim123' } });
ok(r.status === 403 && r.needsAdminKey, 'Admin-Name ohne Admin-Schlüssel gesperrt');
r = await api('/api/auth/register', { method: 'POST', body: { username: 'ProfImpossible', email: 'p@example.com', password: 'geheim123', adminKey: 'test' } });
ok(r.status === 201, 'Admin-Name mit Admin-Schlüssel registrierbar');
await sleep(200);
r = await api('/api/auth/verify', { method: 'POST', body: { login: 'p@example.com', code: codeFromLog('p@example.com') } });
ok(r.account?.isAdmin && r.adminToken, 'ProfImpossible ist Admin');
const T = r.adminToken;
const accs = {};
for (const n of ['Hans', 'Heidi']) {
  await api('/api/auth/register', { method: 'POST', body: { username: n, email: `${n}@example.com`, password: 'geheim123' } });
  await sleep(150);
  const v = await api('/api/auth/verify', { method: 'POST', body: { login: n, code: codeFromLog(`${n.toLowerCase()}@example.com`) } });
  accs[n] = v.token;
}
ok(accs.Hans && accs.Heidi, 'Weitere Accounts angelegt');
r = await api('/api/admin/login', { method: 'POST', body: { username: 'ProfImpossible', password: 'geheim123' } });
ok(r.token, 'Admin-Login über Account');

console.log('Spiel');
r = await api('/api/admin/games', { method: 'POST', token: T, body: { name: 'E2E', settings: {
  photoIntervalMin: 1, photoGraceSec: 0, questIntervalMin: 1, pickupIntervalMin: 1, locationIntervalSec: 10,
  zoneEnabled: true, zoneLat: 52.5, zoneLng: 13.4, zoneRadiusM: 2000, antiSpoof: 'block', antiVpn: 'block', adminGiftsEnabled: true,
  abilities: { cloak: { start: 1 }, freeze: { start: 1 }, radar: { start: 1 }, decoy: { enabled: false } }, quests: { r_red: { points: 77 } },
} } });
const C = r.code;
ok(!!C, 'Spiel angelegt');
r = await api(`/api/g/${C}/join`, { method: 'POST', body: { role: 'runner' } });
ok(r.status === 401 && r.needsAccount, 'Beitritt ohne Account abgelehnt');
const R = await api(`/api/g/${C}/join`, { method: 'POST', acc: RA, body: { role: 'runner' } });
const H = await api(`/api/g/${C}/join`, { method: 'POST', acc: accs.Hans, body: { role: 'hunter' } });
const H2 = await api(`/api/g/${C}/join`, { method: 'POST', acc: accs.Heidi, body: { role: 'hunter' } });
ok(R.name === 'Rita' && H.role === 'hunter', 'Beitritt mit Account, Name = Benutzername');
r = await api(`/api/g/${C}/join`, { method: 'POST', acc: RA, body: { role: 'runner' } });
ok(r.rejoined && r.token === R.token, 'Erneuter Beitritt liefert dieselbe Sitzung');
r = await api(`/api/g/${C}/join`, { method: 'POST', acc: RA, headers: { 'x-vpn': '1' }, body: { role: 'runner' } });
ok(r.rejoined, 'Rejoin geht auch mit VPN-Header (nur neue Beitritte geprüft)');
await api(`/api/admin/games/${C}/start`, { method: 'POST', token: T, body: {} });
let st = await api(`/api/g/${C}/state`, { token: R.token });
ok(st.self.abilities.some((a) => a.key === 'freeze') && st.self.abilities.some((a) => a.key === 'cloak'), 'Runner hat Start-Fähigkeiten (freeze, cloak)');
let sh = await api(`/api/g/${C}/state`, { token: H.token });
ok(sh.self.abilities.some((a) => a.key === 'radar'), 'Hunter hat Radar zum Start');

console.log('Standort + Anti-Cheat');
r = await api(`/api/g/${C}/location`, { method: 'POST', token: R.token, body: { lat: 52.5, lng: 13.4, acc: 8 } });
ok(r.ok, 'Position angenommen');
r = await api(`/api/g/${C}/location`, { method: 'POST', token: H.token, body: { lat: 52.503, lng: 13.4, acc: 8 } });
await api(`/api/g/${C}/location`, { method: 'POST', token: H2.token, body: { lat: 52.497, lng: 13.4, acc: 8 } });
r = await api(`/api/g/${C}/location`, { method: 'POST', token: H.token, headers: { 'x-vpn': '1' }, body: { lat: 52.503, lng: 13.4, acc: 8 } });
ok(r.status === 403 && r.vpn, 'VPN wird blockiert');
await sleep(8100);
r = await api(`/api/g/${C}/location`, { method: 'POST', token: R.token, body: { lat: 53.5, lng: 13.4, acc: 8 } });
ok(r.status === 409 && r.spoof, 'Teleport (111 km in 8 s) wird blockiert');
r = await api(`/api/g/${C}/location`, { method: 'POST', token: R.token, body: { lat: 52.5001, lng: 13.4, acc: 8, mock: true } });
ok(r.status === 409, 'Mock-Standort wird blockiert');
let sa = await api(`/api/g/${C}/state`, { token: T });
ok(sa.messages.some((m) => m.kind === 'cheat'), 'Admin sieht Anti-Cheat-Meldungen');
st = await api(`/api/g/${C}/state`, { token: R.token });
ok(!st.messages.some((m) => m.kind === 'cheat'), 'Spieler sehen sie nicht');
ok(sa.players.find((p) => p.name === 'Rita').flags.spoofCount >= 2, 'Spoof-Zähler am Spieler');

console.log('Fähigkeiten');
r = await api(`/api/g/${C}/ability`, { method: 'POST', token: R.token, body: { key: 'cloak' } });
ok(r.ok, 'Tarnkappe benutzt');
sh = await api(`/api/g/${C}/state`, { token: H.token });
ok(sh.players.find((p) => p.name === 'Rita').loc === null, 'Hunter sieht getarnten Runner nicht');
r = await api(`/api/g/${C}/ability`, { method: 'POST', token: R.token, body: { key: 'cloak' } });
ok(r.status === 409, 'Fähigkeit nicht doppelt benutzbar');
r = await api(`/api/g/${C}/ability`, { method: 'POST', token: R.token, body: { key: 'radar' } });
ok(r.status === 403, 'Runner kann kein Radar');
r = await api(`/api/g/${C}/ability`, { method: 'POST', token: H.token, body: { key: 'radar' } });
ok(r.ok, 'Radar benutzt');
st = await api(`/api/g/${C}/state`, { token: R.token });
ok(st.self.live === 'radar' && st.self.sendIntervalSec === 5, 'Runner ist live (Radar), Intervall 5 s');
sh = await api(`/api/g/${C}/state`, { token: H.token });
const rita = sh.players.find((p) => p.name === 'Rita');
ok(rita.loc && rita.loc.lat === 52.5, 'Radar schlägt Tarnkappe: Hunter sieht exakte Position');
r = await api(`/api/g/${C}/ability`, { method: 'POST', token: R.token, body: { key: 'freeze' } });
ok(r.ok, 'Freeze benutzt');
sh = await api(`/api/g/${C}/state`, { token: H.token });
ok(sh.self.frozenUntil > Date.now() && sh.players.find((p) => p.name === 'Rita').loc === null, 'Hunter eingefroren, sieht keine Runner');
r = await api(`/api/g/${C}/caught`, { method: 'POST', token: H.token, body: { playerId: R.id, caught: true } });
ok(r.status === 409, 'Eingefrorener Hunter kann nicht fangen');
await api(`/api/admin/games/${C}/give`, { method: 'POST', token: T, body: { playerId: H.id, ability: 'thaw' } });
r = await api(`/api/g/${C}/ability`, { method: 'POST', token: H.token, body: { key: 'thaw' } });
ok(r.ok, 'Admin schenkt Eisbrecher, Freeze gebrochen');
sh = await api(`/api/g/${C}/state`, { token: H.token });
ok(!sh.self.frozenUntil, 'Nicht mehr eingefroren');

console.log('Warte auf Quests, Pickups und Live-Strafe (ca. 2 Minuten) …');
for (let i = 0; i < 26; i++) {
  await sleep(5000);
  // Runner bewegt sich ein Stück, damit Positionen frisch bleiben
  await api(`/api/g/${C}/location`, { method: 'POST', token: R.token, body: { lat: 52.5 + i * 0.00005, lng: 13.4, acc: 6 } });
  await api(`/api/g/${C}/location`, { method: 'POST', token: H.token, body: { lat: 52.503 - i * 0.00004, lng: 13.4, acc: 6 } });
  st = await api(`/api/g/${C}/state`, { token: R.token });
  sh = await api(`/api/g/${C}/state`, { token: H.token });
  if (st.self.penalty && st.self.quests.length && sh.self.quests.length && st.pickups.length) break;
}
ok(st.self.penalty?.reason === 'photo' && st.self.live === 'photo', 'Foto verpasst -> Live-Strafe');
ok(st.self.quests.length > 0, `Runner hat Quest: ${st.self.quests.map((q) => q.key).join(',')}`);
ok(sh.self.quests.length > 0, `Hunter hat Quest: ${sh.self.quests.map((q) => q.key).join(',')}`);
ok(st.pickups.length > 0, `Pickup erschienen: ${st.pickups.map((p) => p.name).join(', ')}`);
ok(st.self.inbox.some((m) => m.kind === 'quest'), 'Inbox meldet neue Quest');

// Foto in derselben Runde beendet die Strafe im Modus nextRound NICHT
const pen = st.self.penalty;
r = await api(`/api/g/${C}/photo`, { method: 'POST', token: R.token, body: jpeg });
st = await api(`/api/g/${C}/state`, { token: R.token });
ok(r.ok, 'Foto hochgeladen');
console.log(`    (Strafe Runde ${pen.round}, danach: ${JSON.stringify(st.self.penalty)})`);

// Pickup einsammeln: hinlaufen (Position im Pickup-Request mitschicken)
const pu = st.pickups[0];
r = await api(`/api/g/${C}/pickup`, { method: 'POST', token: H.token, body: { id: pu.id, lat: pu.lat + 0.01, lng: pu.lng, acc: 5 } });
ok(r.status === 409, 'Zu weit weg zum Einsammeln');

// Foto-Quest erfüllen (falls vorhanden)
const pq = st.self.quests.find((q) => q.status === 'active' && ['r_red', 'r_tourist', 'r_number', 'r_safari'].includes(q.key));
if (pq) {
  const before = st.self.points;
  r = await api(`/api/g/${C}/photo?quest=${pq.id}`, { method: 'POST', token: R.token, body: jpeg });
  st = await api(`/api/g/${C}/state`, { token: R.token });
  ok(st.self.quests.find((q) => q.id === pq.id).status === 'done' && st.self.points > before, 'Foto-Quest erledigt, Punkte gutgeschrieben');
}

console.log('Galerie, Bestenliste, Aufräumen');
sa = await api(`/api/g/${C}/state`, { token: T });
r = await api(`/api/admin/games/${C}/feature`, { method: 'POST', token: T, body: { photoId: sa.photos[0].id, caption: 'Super' } });
ok(r.code && !r.error, 'Foto in Galerie übernommen');
r = await api('/api/gallery');
ok(r.items.length === 1 && r.items[0].username === 'Rita', 'Galerie zeigt Foto mit Fotograf');
const img = await fetch(`${B}/api/gallery/${r.items[0].id}.jpg`);
ok(img.status === 200, 'Galerie-Bild abrufbar');
await api(`/api/g/${C}/caught`, { method: 'POST', token: H.token, body: { playerId: R.id, caught: true } });
st = await api(`/api/g/${C}/state`, { token: R.token });
ok(st.game.status === 'ended', 'Alle Runner gefangen -> Spiel vorbei');
r = await api('/api/leaderboard');
const hans = r.rows.find((x) => x.username === 'Hans');
ok(hans && hans.wins === 1 && hans.catches === 1 && hans.points >= 300, `Bestenliste: Hans ${hans?.points} Punkte`);
ok(r.rows.find((x) => x.username === 'Rita')?.featured === 1, 'Bestenliste zählt Galerie-Fotos');
r = await api('/api/admin/photos/purge', { method: 'POST', token: T, body: { includeGallery: false } });
ok(r.ok, `Alle Spielfotos gelöscht (${r.deleted} Dateien)`);
r = await api('/api/gallery');
ok(r.items.length === 1, 'Galerie bleibt erhalten');
r = await api('/api/admin/photos/purge', { method: 'POST', token: T, body: { includeGallery: true } });
r = await api('/api/gallery');
ok(r.items.length === 0, 'Mit Galerie: alles gelöscht');
r = await api('/api/auth/forgot', { method: 'POST', body: { login: 'Rita' } });
await sleep(200);
r = await api('/api/auth/reset', { method: 'POST', body: { login: 'Rita', code: codeFromLog('rita@example.com'), password: 'neuesPasswort1' } });
ok(r.token, 'Passwort zurückgesetzt');
r = await api('/api/auth/me', { acc: RA });
ok(r.status === 401, 'Alte Tokens nach Passwort-Reset ungültig');
console.log(fails ? `\n${fails} FEHLER` : '\nAlles OK');
process.exit(fails ? 1 : 0);
