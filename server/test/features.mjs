// Schneller Test der Funktionen aus Version 2.1 (ohne Wartezeiten). Aufruf: node test/features.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import crypto from 'node:crypto';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 3800 + Math.floor(Math.random() * 90);
const B = `http://127.0.0.1:${PORT}`;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'manhunt-feat-'));
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

console.log('Profil, Verlauf, Saison');
let pr = await api('/api/profile/Rita');
ok(pr.history?.length === 1 && pr.history[0].result === 'win' && pr.history[0].converted && pr.history[0].role === 'runner', 'Spielverlauf: als Runner gestartet, übergelaufen, gewonnen');
ok(pr.history[0].catches === 1, 'Fänge pro Spiel im Verlauf');
ok(pr.seasons?.[0]?.rank >= 1 && pr.seasons[0].wins === 1, `Saison ${pr.seasons?.[0]?.season}: Platz ${pr.seasons?.[0]?.rank}`);
let lbS = await api('/api/leaderboard?season=current');
ok(lbS.season === lbS.currentSeason && lbS.rows.some((x) => x.username === 'Rita'), 'Saison-Bestenliste (aktueller Monat)');
lbS = await api('/api/leaderboard?season=2001-01');
ok(lbS.rows.length === 0, 'Alte Saison ohne Einträge ist leer');
ok((await api('/api/seasons')).seasons.includes(lbS.currentSeason), 'Saison-Liste');

console.log('Freunde, Einladung, Push');
// Mini-Push-Dienst: nimmt Benachrichtigungen an und entschlüsselt sie
const ua = crypto.createECDH('prime256v1'); ua.generateKeys();
const authSecret = crypto.randomBytes(16);
const received = [];
const pushSrv = http.createServer((req, res) => {
  const chunks = []; req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    const salt = body.subarray(0, 16), idlen = body[20], asPub = body.subarray(21, 21 + idlen), ct = body.subarray(21 + idlen);
    const ecdhSecret = ua.computeSecret(asPub);
    const ikm = Buffer.from(crypto.hkdfSync('sha256', ecdhSecret, authSecret, Buffer.concat([Buffer.from('WebPush: info\0'), ua.getPublicKey(), asPub]), 32));
    const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
    const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
    const d = crypto.createDecipheriv('aes-128-gcm', cek, nonce); d.setAuthTag(ct.subarray(ct.length - 16));
    const plain = Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]);
    received.push({ auth: req.headers.authorization, data: JSON.parse(plain.subarray(0, plain.length - 1).toString()) });
    res.writeHead(201); res.end();
  });
}).listen(0, '127.0.0.1');
await new Promise((r) => pushSrv.once('listening', r));
const sub = { endpoint: `http://127.0.0.1:${pushSrv.address().port}/push/abc`, keys: { p256dh: ua.getPublicKey().toString('base64url'), auth: authSecret.toString('base64url') } };
r = await api('/api/push/subscribe', { acc: A.Hans.token, body: { subscription: sub } });
ok(r.ok, 'Hans abonniert Push');
r = await api('/api/friends/request', { acc: A.Rita.token, body: { username: 'Hans' } });
ok(r.outgoing?.[0]?.username === 'Hans', 'Rita fragt Hans an');
await sleep(300);
ok(received.some((x) => x.data.title === 'Freundschaftsanfrage' && x.data.body.includes('Rita')), 'Hans bekommt die Anfrage als verschlüsselten Push');
ok(received[0]?.auth?.startsWith('vapid t='), 'Push mit VAPID-Signatur');
r = await api('/api/friends/respond', { acc: A.Hans.token, body: { username: 'Rita', accept: true } });
ok(r.friends?.[0]?.username === 'Rita', 'Hans nimmt an – befreundet');
const g2 = await api('/api/admin/games', { token: T, body: { name: 'Revanche' } });
r = await api('/api/friends/invite', { acc: A.Rita.token, body: { username: 'Hans', code: g2.code } });
r = await api('/api/friends', { acc: A.Hans.token });
ok(r.invites?.[0]?.code === g2.code && r.invites[0].from === 'Rita', 'Hans hat eine Einladung zu „Revanche“');
r = await api('/api/friends/invite', { acc: A.Rita.token, body: { username: 'Zoe', code: g2.code } });
ok(r.http === 403, 'Nur Freunde können eingeladen werden');
pr = await api('/api/profile/Hans', { acc: A.Rita.token });
ok(pr.friendship === 'friends' && pr.online, 'Profil zeigt Freundschaft und online');
pushSrv.close();

console.log('Chat für alle (Issue #4)');
const gc = await api('/api/admin/games', { token: T, body: { name: 'Allchat', settings: { questsEnabled: false, pickupsEnabled: false } } });
const cR = await api(`/api/g/${gc.code}/join`, { acc: A.Rita.token, body: { role: 'runner' } });
const cH = await api(`/api/g/${gc.code}/join`, { acc: A.Hans.token, body: { role: 'hunter' } });
const cS = await api(`/api/g/${gc.code}/join`, { acc: A.Zoe.token, body: { role: 'spectator' } });
await api(`/api/admin/games/${gc.code}/start`, { token: T, body: {} });
await api(`/api/g/${gc.code}/chat`, { token: cR.token, body: { text: 'nur Runner' } });
await sleep(1600);
r = await api(`/api/g/${gc.code}/chat`, { token: cR.token, body: { text: 'Hallo an alle', channel: 'all' } });
ok(r.ok, 'Runner schreibt in den Chat für alle');
sh = await api(`/api/g/${gc.code}/state`, { token: cH.token });
ok(sh.chat.length === 1 && sh.chat[0].channel === 'all' && sh.chat[0].text === 'Hallo an alle', 'Hunter sieht nur die Nachricht an alle');
st = await api(`/api/g/${gc.code}/state`, { token: cR.token });
ok(st.chat.length === 2, 'Runner sieht Team- und Allgemein-Chat');
ss = await api(`/api/g/${gc.code}/state`, { token: cS.token });
ok(ss.chat.length === 1, 'Zuschauer liest den Chat für alle mit');
r = await api(`/api/g/${gc.code}/chat`, { token: cS.token, body: { text: 'Rita ist am Bahnhof!', channel: 'all' } });
ok(r.http === 403, 'Zuschauer dürfen im Chat für alle nicht schreiben');

console.log('Fotos als ZIP (Issue #3)');
await api(`/api/g/${gc.code}/photo`, { token: cR.token, body: jpeg });
await sleep(1100);
await api(`/api/g/${gc.code}/photo`, { token: cR.token, body: Buffer.concat([jpeg, Buffer.alloc(50, 9)]) });
resp = await api(`/api/g/${gc.code}/photos.zip`, { token: cH.token, raw: true });
ok(resp.status === 409, 'Während des Spiels kein ZIP für Spieler');
await api(`/api/admin/games/${gc.code}/end`, { token: T, body: {} });
resp = await api(`/api/g/${gc.code}/photos.zip`, { token: cH.token, raw: true });
const zipBuf = Buffer.from(await resp.arrayBuffer());
ok(resp.status === 200 && resp.headers.get('content-type') === 'application/zip' && zipBuf.readUInt32LE(0) === 0x04034b50, 'Nach Spielende: ZIP für jeden Spieler');
const zipPath = path.join(DATA, 'test.zip'); fs.writeFileSync(zipPath, zipBuf);
const { execFileSync } = await import('node:child_process');
let zipOk = false, zipList = '';
try { zipList = execFileSync('unzip', ['-l', zipPath]).toString(); execFileSync('unzip', ['-tq', zipPath]); zipOk = true; } catch (e) { zipList = String(e); }
ok(zipOk && /Rita\/\d\d-\d\d-\d\d\.jpg/.test(zipList) && (zipList.match(/\.jpg/g) || []).length === 2, 'ZIP ist gültig (unzip -t), Ordner pro Fotograf, 2 Fotos');

console.log('Spielleitung spielt mit: keine Vorteile (Issue #2)');
const ga = await api('/api/admin/games', { token: T, body: { name: 'Fair', settings: { questsEnabled: false } } });
const aP = await api(`/api/g/${ga.code}/join`, { acc: admin.token, body: { role: 'runner' } });
const aH = await api(`/api/g/${ga.code}/join`, { acc: A.Hans.token, body: { role: 'hunter' } });
await api(`/api/admin/games/${ga.code}/start`, { token: T, body: {} });
r = await api(`/api/g/${ga.code}/state`, { token: T });
ok(r.http === 403, 'Mitspielender Admin bekommt keine Rundumsicht');
r = await api(`/api/admin/games/${ga.code}/give`, { token: T, body: { playerId: aP.id, ability: 'cloak' } });
ok(r.http === 403, 'Mitspielender Admin kann sich keine Fähigkeiten geben');
r = await api(`/api/admin/games/${ga.code}/kick`, { token: T, body: { playerId: aH.id } });
ok(r.http === 403, 'Mitspielender Admin kann niemanden entfernen');
r = await api(`/api/admin/games/${ga.code}/announce`, { token: T, body: { text: 'Pause in 5 Minuten' } });
ok(r.code === ga.code, 'Durchsagen gehen weiter');
const pwToken = (await api('/api/admin/login', { body: { password: 'test' } })).token;
r = await api(`/api/admin/games/${ga.code}/give`, { token: pwToken, body: { playerId: aH.id, ability: 'radar' } });
ok(r.http === 403 && /verschenken/.test(r.error), 'Verschenken ist standardmäßig aus');
await api(`/api/admin/games/${ga.code}`, { method: 'PATCH', token: pwToken, body: { settings: { adminGiftsEnabled: true } } });
r = await api(`/api/admin/games/${ga.code}/give`, { token: pwToken, body: { playerId: aH.id, ability: 'radar' } });
ok(r.code === ga.code, 'Eingeschaltet: unbeteiligte Spielleitung kann verschenken');
const list = await api('/api/admin/games', { token: T });
ok(list.games.find((x) => x.code === ga.code).youPlay === true, 'Spieleliste zeigt „du spielst mit“');

console.log('Eigene Quests (Issue #2)');
const noBuiltin = Object.fromEntries(Object.keys((await api('/api/catalog')).quests).map((k) => [k, { enabled: false }]));
const gq = await api('/api/admin/games', { token: T, body: { name: 'Eigene Quests', settings: {
  questsEnabled: true, questIntervalMin: 1, pickupsEnabled: false, quests: noBuiltin,
  customQuests: [{ title: 'Zum Rathaus', desc: 'Lauf zum Rathaus', team: 'any', kind: 'place', lat: 52.5005, lng: 13.4, radiusM: 30, points: 77, reward: 'none', icon: '🏛️' }],
} } });
ok(gq.settings.customQuests.length === 1 && gq.settings.customQuests[0].id, 'Eigene Quest gespeichert');
const qR = await api(`/api/g/${gq.code}/join`, { acc: A.Rolf.token, body: { role: 'runner' } });
await api(`/api/admin/games/${gq.code}/start`, { token: T, body: {} });
await api(`/api/g/${gq.code}/location`, { token: qR.token, body: { lat: 52.5, lng: 13.4, acc: 5 } });

console.log('Versorgungsabwurf');
const g3 = await api('/api/admin/games', { token: T, body: { name: 'Abwurf', settings: { supplyDropsEnabled: true, supplyDropIntervalMin: 1, supplyDropWarnMin: 0, supplyDropAbilities: 3, pickupsEnabled: false, questsEnabled: false, zoneEnabled: true, zoneLat: 52.5, zoneLng: 13.4, zoneRadiusM: 800 } } });
const Rd = await api(`/api/g/${g3.code}/join`, { acc: A.Rolf.token, body: { role: 'runner' } });
await api(`/api/admin/games/${g3.code}/start`, { token: T, body: {} });
let drop = null;
for (let i = 0; i < 20 && !drop; i++) { await sleep(5000); drop = (await api(`/api/g/${g3.code}/state`, { token: Rd.token })).pickups.find((p) => p.drop); }
ok(!!drop, 'Abwurf erscheint nach 1 Minute');
st = await api(`/api/g/${g3.code}/state`, { token: Rd.token });
ok(st.messages.some((m) => m.text.includes('Versorgungsabwurf')), 'Abwurf wird angekündigt');
r = await api(`/api/g/${g3.code}/pickup`, { token: Rd.token, body: { id: drop.id, lat: drop.lat, lng: drop.lng, acc: 5 } });
ok(r.abilities?.length === 3, `Abwurf enthält 3 Fähigkeiten: ${r.abilities}`);

console.log('Eigene Quests – Auswertung');
let cq = null;
for (let i = 0; i < 20 && !cq; i++) { st = await api(`/api/g/${gq.code}/state`, { token: qR.token }); cq = st.self.quests[0]; if (!cq) await sleep(5000); }
ok(cq?.title === 'Zum Rathaus' && cq.custom && cq.target?.lat === 52.5005, 'Eigene Ort-Quest wird zugeteilt, mit Titel und Ziel');
await api(`/api/g/${gq.code}/location`, { token: qR.token, body: { lat: 52.5005, lng: 13.4, acc: 5 } });
st = await api(`/api/g/${gq.code}/state`, { token: qR.token });
ok(st.self.quests[0]?.status === 'done' && st.self.points >= 77, 'Am Rathaus angekommen: Quest geschafft, 77 Punkte');

console.log('IP hinter Proxy');
await stop(); await start({ TRUST_PROXY: 'never' }); // wie ein direkt aus dem Internet erreichbarer Server
for (let i = 0; i < 6; i++) await api('/api/admin/login', { body: { password: 'falsch' }, headers: { 'x-forwarded-for': `1.2.3.${i}` } });
r = await api('/api/admin/login', { body: { password: 'falsch' }, headers: { 'x-forwarded-for': '9.9.9.9' } });
ok(r.http === 429, 'Gefälschtes X-Forwarded-For umgeht die Bremse nicht (direkte Verbindung)');

console.log(fails ? `\n${fails} FEHLER` : '\nAlles OK');
await stop();
process.exit(fails ? 1 : 0);
