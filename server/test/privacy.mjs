// E-Mails und Datenschutz (2.7, Issues #13, #14). Aufruf: node test/privacy.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import crypto from 'node:crypto';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4000 + Math.floor(Math.random() * 90);
const B = `http://127.0.0.1:${PORT}`;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'manhunt-priv-'));
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
async function account(name, adminKey, optIn = false) {
  await api('/api/auth/register', { body: { username: name, email: `${name.toLowerCase()}@x.de`, password: 'geheim123', adminKey, acceptPrivacy: true, mailOptIn: optIn } });
  await sleep(100);
  return api('/api/auth/verify', { body: { login: name, code: code(`${name.toLowerCase()}@x.de`) } });
}
const jpeg = (n) => Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.alloc(n, 1)]);
const mailsTo = (email) => LOG.split(`Mail an ${email}: `).slice(1).map((x) => x.split('\n')[0]);
let r;

await start();
const admin = await account('ProfImpossible', 'test');
const T = admin.adminToken;
const Ana = await account('Ana', undefined, true);   // hat Benachrichtigungs-Mails erlaubt
const Ben = await account('Ben');                    // hat sie nicht erlaubt
await sleep(150);

console.log('E-Mails (Issue #13)');
ok(mailsTo('ana@x.de').some((s) => /Dein Konto ist bereit/.test(s)), 'Willkommens-Mail nach der Bestätigung');
ok(/Willkommen bei Manhunt, Ana!/.test(LOG), 'Bestätigungs-Mail mit Namen');
r = await api('/api/me/prefs', { acc: Ana.token });
ok(r.mailPrefs.friends === true && r.mailPrefs.games === true && r.categories.friends, 'Opt-in bei der Registrierung gespeichert');
r = await api('/api/me/prefs', { acc: Ben.token });
ok(r.mailPrefs.friends === false && r.mailPrefs.account === true, 'Ohne Opt-in: nur Hinweise zu den eigenen Daten');
await api('/api/friends/request', { acc: Ben.token, body: { username: 'Ana' } });
await sleep(150);
ok(mailsTo('ana@x.de').some((s) => /Ben möchte mit dir befreundet sein/.test(s)), 'Mail bei Freundschaftsanfrage (mit Einwilligung)');
await api('/api/friends/respond', { acc: Ana.token, body: { username: 'Ben', accept: true } });
await sleep(150);
ok(!mailsTo('ben@x.de').some((s) => /befreundet/.test(s)), 'Keine Mail ohne Einwilligung');
const g = await api('/api/admin/games', { token: Ben.token, body: { name: 'Mailtest', settings: { questsEnabled: false, pickupsEnabled: false } } });
await api('/api/friends/invite', { acc: Ben.token, body: { username: 'Ana', code: g.code } });
await sleep(150);
ok(mailsTo('ana@x.de').some((s) => /Ben lädt dich zu „Mailtest“ ein/.test(s)), 'Mail bei Einladung');
const unsub = LOG.match(/Abbestellen: (http\S+c=invites\S+)/);
ok(unsub, 'Mail enthält Abmeldelink');
const uurl = new URL(unsub[1]);
r = await api(uurl.pathname + uurl.search, { raw: true });
ok(r.status === 200 && /abbestellen/.test(await r.text()), 'Abmeldelink zeigt erst eine Bestätigungsseite');
r = await api(uurl.pathname + uurl.search, { method: 'POST', raw: true, headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: undefined });
ok(r.status === 200, 'Ein-Klick-Abmeldung (POST)');
r = await api('/api/me/prefs', { acc: Ana.token });
ok(r.mailPrefs.invites === false && r.mailPrefs.friends === true, 'Nur diese Kategorie abbestellt');
r = await api(uurl.pathname + uurl.search.replace(/s=[^&]+/, 's=falsch'), { method: 'POST', raw: true });
ok(r.status === 400, 'Gefälschter Abmeldelink abgelehnt');
const Pa = await api(`/api/g/${g.code}/join`, { acc: Ana.token, body: { role: 'runner' } });
await api(`/api/g/${g.code}/join`, { acc: Ben.token, body: { role: 'hunter' } });
await api(`/api/admin/games/${g.code}/start`, { token: Ben.token, body: {} });
await api(`/api/g/${g.code}/photo`, { token: Pa.token, body: jpeg(500) });
await api(`/api/g/${g.code}/chat`, { token: Pa.token, body: { text: 'Hallo von Ana' } });
await api(`/api/admin/games/${g.code}/end`, { token: Ben.token, body: {} });
await sleep(150);
ok(mailsTo('ana@x.de').some((s) => /Ergebnis: „Mailtest“/.test(s)), 'Ergebnis-Mail nach der Runde');
r = await api('/api/me/password', { acc: Ben.token, body: { oldPassword: 'geheim123', newPassword: 'nochgeheimer' } });
await sleep(150);
ok(mailsTo('ben@x.de').some((s) => /Passwort wurde geändert/.test(s)), 'Sicherheits-Mail bei Passwortänderung (immer)');
const BenTok = r.token;

console.log('Datenschutz (Issue #14)');
r = await api('/api/legal');
ok(r.privacyVersion && r.retention.photosDays === 30 && r.retention.unverifiedDays === 7, 'Angaben für Datenschutzerklärung');
for (const pg of ['/datenschutz', '/impressum']) { const x = await api(pg, { raw: true }); ok(x.status === 200, `${pg} erreichbar`); }
r = await api('/vendor/leaflet/leaflet.js', { raw: true });
ok(r.status === 200, 'Kartenbibliothek wird selbst ausgeliefert');
ok(!/unpkg/.test(r.headers.get('content-security-policy')), 'Keine fremden Skript-Quellen mehr (CSP)');
r = await api(`/api/me/export?t=${encodeURIComponent(Ana.token)}`, { raw: true });
const zipBuf = Buffer.from(await r.arrayBuffer());
const zipFile = path.join(DATA, 'export.zip'); fs.writeFileSync(zipFile, zipBuf);
const { execFileSync } = await import('node:child_process');
let listing = ''; try { listing = execFileSync('unzip', ['-l', zipFile]).toString(); } catch {}
const json = (() => { try { return JSON.parse(execFileSync('unzip', ['-p', zipFile, 'daten.json']).toString()); } catch { return null; } })();
ok(r.status === 200 && /daten\.json/.test(listing) && /fotos\/.*\.jpg/.test(listing), 'Datenexport als ZIP mit daten.json und Fotos');
ok(json && json.account.email === 'ana@x.de' && json.games[0].yourChat[0].text === 'Hallo von Ana' && json.friends.includes('Ben') && !JSON.stringify(json).includes('"hash"'), 'Export enthält Konto, Chat, Freunde – aber keinen Passwort-Hash');
r = await api('/api/me/export');
ok(r.http === 401, 'Export nur angemeldet');
r = await api('/api/me/delete', { acc: Ana.token, body: { password: 'geheim123' } });
await sleep(150);
ok(r.ok && mailsTo('ana@x.de').some((s) => /Konto wurde gelöscht/.test(s)), 'Konto gelöscht, Bestätigungs-Mail');
const st = await api(`/api/g/${g.code}/state`, { token: BenTok });
ok(st.players.some((p) => p.name === 'Gelöschter Spieler') && !st.players.some((p) => p.name === 'Ana'), 'In Runden anonymisiert');
ok(st.photos.length === 0 && !st.chat.some((c) => /Ana/.test(c.text)), 'Fotos und Chat der Person gelöscht');
ok(!st.messages.some((m) => /\bAna\b/.test(m.text)), 'Name auch aus Spielmeldungen entfernt');
ok(!fs.readdirSync(path.join(DATA, 'photos')).length, 'Foto-Dateien gelöscht');

console.log('Aufbewahrung');
const karl = await api('/api/auth/register', { body: { username: 'Karl', email: 'karl@x.de', password: 'geheim123', acceptPrivacy: true } });
await sleep(400); // Frist (0,1 s) sicher verstreichen lassen
await stop(); await start({ UNVERIFIED_DAYS: '0.000001', RETENTION_DAYS: '0.000001' });
r = await api('/api/admin/accounts', { token: T });
ok(!r.accounts.some((a) => a.username === 'Karl'), 'Unbestätigtes Konto nach Frist gelöscht');
const st2 = await api(`/api/g/${g.code}/state`, { token: (await api('/api/auth/login', { body: { login: 'Ben', password: 'nochgeheimer' } })).token });
ok(st2.chat.length === 0 && st2.players.every((p) => !p.trail.length), 'Chat und Standorte beendeter Runden nach Frist gelöscht');
ok(st2.game.status === 'ended' && st2.players.length === 2, 'Ergebnis bleibt erhalten');

console.log(fails ? `\n${fails} FEHLER` : '\nAlles OK');
await stop();
process.exit(fails ? 1 : 0);
