'use strict';
/**
 * Manhunt – Server ohne externe Abhängigkeiten (nur Node.js-Bordmittel).
 * Start: ADMIN_PASSWORD=geheim node server.js
 */
const http = require('node:http');
const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const crypto = require('node:crypto');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const PHOTO_DIR = path.join(DATA_DIR, 'photos');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
const MAX_PLAYERS = 60;
const MAX_LOCATIONS = 30000;

fs.mkdirSync(PHOTO_DIR, { recursive: true });

let ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
if (!ADMIN_PASSWORD) {
  ADMIN_PASSWORD = crypto.randomBytes(6).toString('hex');
  console.log(`[manhunt] ADMIN_PASSWORD ist nicht gesetzt. Temporäres Passwort: ${ADMIN_PASSWORD}`);
}

/* ------------------------------------------------------------------ */
/* Einstellungen (jedes Feature ist hier ein-/ausschaltbar)             */
/* ------------------------------------------------------------------ */
const DEFAULTS = {
  locationIntervalSec: 120,      // wie oft der Standort geteilt wird
  headStartMin: 0,               // Vorsprung: Hunter sehen die Runner erst nach X Minuten (0 = aus)
  autoEndAfterMin: 0,            // Spiel endet automatisch nach X Minuten (0 = aus)
  showTrail: true,               // Spur der bisherigen Route anzeigen
  fuzzMeters: 0,                 // Standort für Hunter um bis zu X Meter verwischen (0 = aus)
  huntersVisibleToHunters: true, // Hunter sehen sich gegenseitig
  huntersVisibleToRunners: false,// Runner sehen die Hunter
  runnersVisibleToRunners: true, // Runner sehen sich gegenseitig
  showDistance: true,            // Hunter sehen Entfernung + Richtung zum nächsten Runner
  photosEnabled: true,           // Foto-Aufforderungen
  photoIntervalMin: 15,          // Intervall der Foto-Aufforderung
  caughtEnabled: true,           // "Gefangen"-Funktion
  autoEndWhenAllCaught: true,    // Spiel endet, wenn alle Runner gefangen sind
  zoneEnabled: false,            // Spielzone (Kreis) mit Warnung bei Verlassen
  zoneLat: 0,
  zoneLng: 0,
  zoneRadiusM: 1000,
};
const LIMITS = {
  locationIntervalSec: [10, 3600], headStartMin: [0, 600], autoEndAfterMin: [0, 1440],
  fuzzMeters: [0, 2000], photoIntervalMin: [1, 240], zoneRadiusM: [50, 50000],
  zoneLat: [-90, 90], zoneLng: [-180, 180],
};
function sanitizeSettings(input, base = DEFAULTS) {
  const out = { ...base };
  if (!input || typeof input !== 'object') return out;
  for (const key of Object.keys(DEFAULTS)) {
    if (!(key in input)) continue;
    const v = input[key];
    if (typeof DEFAULTS[key] === 'boolean') out[key] = v === true || v === 'true';
    else {
      const n = Number(v);
      if (!Number.isFinite(n)) continue;
      const [lo, hi] = LIMITS[key];
      out[key] = Math.min(hi, Math.max(lo, n));
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Datenhaltung (JSON-Datei, atomar geschrieben)                        */
/* ------------------------------------------------------------------ */
let db = { games: {}, secret: '' };
try { db = { ...db, ...JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) }; } catch { /* neu */ }
if (!db.secret) db.secret = crypto.randomBytes(32).toString('hex');
let saveTimer = null;
function save() { if (!saveTimer) saveTimer = setTimeout(flush, 400); }
function flush() {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db));
  fs.renameSync(tmp, DB_FILE);
}
flush();
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { flush(); process.exit(0); });

/* ------------------------------------------------------------------ */
/* Hilfsfunktionen                                                     */
/* ------------------------------------------------------------------ */
class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const rid = (n = 8) => crypto.randomBytes(n).toString('hex');
const hmac = (s) => crypto.createHmac('sha256', db.secret + '|' + ADMIN_PASSWORD).update(s).digest('hex');
function safeEq(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
function makeAdminToken() { const exp = String(Date.now() + 7 * 864e5); return `${exp}.${hmac(exp)}`; }
function checkAdminToken(t) {
  if (typeof t !== 'string') return false;
  const [exp, sig] = t.split('.');
  return !!(exp && sig && Number(exp) > Date.now() && safeEq(sig, hmac(exp)));
}
function newCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (;;) {
    let c = '';
    for (const b of crypto.randomBytes(5)) c += A[b % A.length];
    if (!db.games[c]) return c;
  }
}
const cleanText = (s, max) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);

function sendJSON(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []; let n = 0; let tooBig = false;
    req.on('data', (c) => { n += c.length; if (n > limit) tooBig = true; else chunks.push(c); });
    req.on('end', () => (tooBig ? reject(new HttpError(413, 'Datei zu groß')) : resolve(Buffer.concat(chunks))));
    req.on('error', reject);
  });
}
async function readJSON(req) {
  const buf = await readBody(req, 64 * 1024);
  if (!buf.length) return {};
  try { return JSON.parse(buf.toString('utf8')); } catch { throw new HttpError(400, 'Ungültiges JSON'); }
}
function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371000, r = Math.PI / 180;
  const dLat = (lat2 - lat1) * r, dLng = (lng2 - lng1) * r;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
/** Deterministische Verwischung – bleibt zwischen zwei Abrufen stabil. */
function fuzzPoint(seed, lat, lng, meters) {
  const h = crypto.createHash('sha256').update(db.secret + seed).digest();
  const ang = (h.readUInt16BE(0) / 65535) * 2 * Math.PI;
  const rad = Math.sqrt(h.readUInt16BE(2) / 65535) * meters;
  return [
    lat + (rad * Math.cos(ang)) / 111320,
    lng + (rad * Math.sin(ang)) / (111320 * Math.max(0.2, Math.cos((lat * Math.PI) / 180))),
  ];
}

/* ------------------------------------------------------------------ */
/* Spiel-Logik                                                         */
/* ------------------------------------------------------------------ */
function newGame(name, settings) {
  const code = newCode();
  db.games[code] = {
    code, name, status: 'lobby', createdAt: Date.now(), startedAt: null, endedAt: null,
    settings: sanitizeSettings(settings), players: {}, locations: [], photos: [], messages: [],
  };
  save();
  return db.games[code];
}
function getGame(code) {
  const g = db.games[String(code).toUpperCase()];
  if (!g) throw new HttpError(404, 'Spiel nicht gefunden');
  return g;
}
function pushMsg(g, text, kind = 'system') {
  g.messages.push({ id: rid(3), ts: Date.now(), text: cleanText(text, 300), kind });
  if (g.messages.length > 100) g.messages.splice(0, g.messages.length - 100);
}
function startGame(g) {
  if (g.status !== 'lobby') throw new HttpError(409, 'Spiel wurde schon gestartet');
  g.status = 'running'; g.startedAt = Date.now();
  const hs = g.settings.headStartMin;
  pushMsg(g, hs > 0 ? `Das Spiel läuft! Runner haben ${hs} Minuten Vorsprung.` : 'Das Spiel läuft!');
}
function endGame(g, reason) {
  if (g.status === 'ended') return;
  g.status = 'ended'; g.endedAt = Date.now();
  pushMsg(g, `Spiel beendet: ${reason}`);
}
function resetGame(g) {
  g.status = 'lobby'; g.startedAt = null; g.endedAt = null;
  g.locations = []; g.photos = []; g.messages = [];
  deletePhotoFiles(g.code);
  for (const p of Object.values(g.players)) { p.caught = false; p.lastLoc = null; }
}
function deletePhotoFiles(code) {
  try {
    for (const f of fs.readdirSync(PHOTO_DIR)) if (f.startsWith(code + '_')) fs.unlinkSync(path.join(PHOTO_DIR, f));
  } catch { /* ignore */ }
}
function checkAllCaught(g) {
  if (g.status !== 'running' || !g.settings.caughtEnabled || !g.settings.autoEndWhenAllCaught) return;
  const runners = Object.values(g.players).filter((p) => p.role === 'runner');
  if (runners.length && runners.every((p) => p.caught)) endGame(g, 'Alle Runner wurden gefangen. Die Hunter gewinnen!');
}
setInterval(() => {
  const now = Date.now();
  for (const g of Object.values(db.games)) {
    if (g.status === 'running' && g.settings.autoEndAfterMin > 0 && now >= g.startedAt + g.settings.autoEndAfterMin * 60000) {
      endGame(g, 'Die Zeit ist um. Die Runner gewinnen!'); save(); notify(g.code);
    }
  }
}, 10000).unref();

/* ------------------------------------------------------------------ */
/* Live-Updates (Server-Sent Events)                                   */
/* ------------------------------------------------------------------ */
const sseClients = new Map(); // code -> Set<res>
const notifyTimers = new Map();
function notify(code) {
  if (notifyTimers.has(code)) return;
  notifyTimers.set(code, setTimeout(() => {
    notifyTimers.delete(code);
    for (const res of sseClients.get(code) || []) res.write('event: update\ndata: {}\n\n');
  }, 250));
}
function openSSE(req, res, g) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive', 'X-Accel-Buffering': 'no',
  });
  res.write('retry: 3000\n\n');
  if (!sseClients.has(g.code)) sseClients.set(g.code, new Set());
  sseClients.get(g.code).add(res);
  const hb = setInterval(() => res.write(': hb\n\n'), 25000);
  req.on('close', () => { clearInterval(hb); sseClients.get(g.code)?.delete(res); });
}

/* ------------------------------------------------------------------ */
/* Zustand pro Betrachter (hier steckt die Sichtbarkeits-Logik)        */
/* ------------------------------------------------------------------ */
function buildState(g, auth) {
  const now = Date.now();
  const s = g.settings;
  const ended = g.status === 'ended';
  const active = g.status !== 'lobby';
  const isAdmin = !!auth.admin;
  const viewer = auth.player || null;
  const viewerRole = isAdmin ? 'admin' : viewer.role;
  const releaseAt = g.startedAt ? g.startedAt + s.headStartMin * 60000 : null;
  const released = ended || (g.status === 'running' && now >= releaseAt);

  const canSee = (t) => {
    if (ended || isAdmin || (viewer && t.id === viewer.id)) return true;
    if (!active) return false;
    if (viewerRole === 'hunter') return t.role === 'runner' ? released : s.huntersVisibleToHunters;
    return t.role === 'runner' ? s.runnersVisibleToRunners : s.huntersVisibleToRunners;
  };
  const doFuzz = (t) => s.fuzzMeters > 0 && !ended && viewerRole === 'hunter' && t.role === 'runner';

  const locsBy = {}; for (const l of g.locations) (locsBy[l.pid] ||= []).push(l);
  const photosBy = {}; for (const ph of g.photos) (photosBy[ph.pid] ||= []).push(ph);

  const players = Object.values(g.players).map((t) => {
    const vis = canSee(t);
    const pts = vis ? locsBy[t.id] || [] : [];
    const fz = doFuzz(t);
    const conv = (l) => (fz ? fuzzPoint(`${t.id}:${l.ts}`, l.lat, l.lng, s.fuzzMeters) : [l.lat, l.lng]);
    let loc = null, trail = [], outside = false;
    if (pts.length) {
      const last = pts[pts.length - 1];
      const [la, ln] = conv(last);
      loc = { lat: la, lng: ln, acc: fz ? Math.max(last.acc, s.fuzzMeters) : last.acc, ts: last.ts };
      if (s.showTrail || ended) trail = pts.slice(-300).map((l) => { const [a, b] = conv(l); return [a, b, l.ts]; });
      if (s.zoneEnabled && t.role === 'runner') outside = haversine(last.lat, last.lng, s.zoneLat, s.zoneLng) > s.zoneRadiusM;
    }
    const ph = vis ? photosBy[t.id] || [] : [];
    return {
      id: t.id, name: t.name, role: t.role, caught: t.caught,
      lastSeen: isAdmin ? t.lastSeen : undefined,
      hidden: active && !vis, loc, trail, outside,
      photoCount: ph.length, lastPhotoTs: ph.length ? ph[ph.length - 1].ts : null,
    };
  });
  const visibleIds = new Set(players.filter((p) => !p.hidden).map((p) => p.id));
  return {
    now,
    game: { code: g.code, name: g.name, status: g.status, startedAt: g.startedAt, endedAt: g.endedAt, releaseAt },
    settings: s,
    self: isAdmin
      ? { id: null, name: 'Spielleitung', role: 'admin', caught: false, lastLocTs: null }
      : { id: viewer.id, name: viewer.name, role: viewer.role, caught: viewer.caught, lastLocTs: viewer.lastLoc?.ts || null },
    players,
    photos: g.photos.filter((ph) => visibleIds.has(ph.pid)).map(({ id, pid, ts }) => ({ id, pid, ts })),
    messages: g.messages.slice(-30),
  };
}
function adminSummary(g) {
  const ps = Object.values(g.players);
  return {
    code: g.code, name: g.name, status: g.status, createdAt: g.createdAt, startedAt: g.startedAt, endedAt: g.endedAt,
    settings: g.settings, runners: ps.filter((p) => p.role === 'runner').length, hunters: ps.filter((p) => p.role === 'hunter').length,
    caught: ps.filter((p) => p.caught).length, photos: g.photos.length,
  };
}

/* ------------------------------------------------------------------ */
/* API                                                                 */
/* ------------------------------------------------------------------ */
const loginFails = new Map();
const clientIp = (req) => String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();

async function handleApi(req, res, url) {
  const m = req.method, p = url.pathname;
  if (m === 'GET' && p === '/api/health') return sendJSON(res, 200, { ok: true });

  if (m === 'POST' && p === '/api/admin/login') {
    const ip = clientIp(req);
    const f = loginFails.get(ip);
    if (f && f.n >= 5 && Date.now() < f.until) throw new HttpError(429, 'Zu viele Versuche. Bitte kurz warten.');
    const b = await readJSON(req);
    if (!safeEq(String(b.password ?? ''), ADMIN_PASSWORD)) {
      const n = (f?.n || 0) + 1;
      loginFails.set(ip, { n, until: Date.now() + 60000 });
      throw new HttpError(401, 'Falsches Passwort');
    }
    loginFails.delete(ip);
    return sendJSON(res, 200, { token: makeAdminToken() });
  }
  if (p.startsWith('/api/admin/')) return handleAdmin(req, res, url);

  const gm = p.match(/^\/api\/g\/([A-Za-z0-9]{3,10})(?:\/(.*))?$/);
  if (gm) return handleGame(req, res, url, gm[1].toUpperCase(), gm[2] || '');
  throw new HttpError(404, 'Nicht gefunden');
}

async function handleAdmin(req, res, url) {
  const token = req.headers['x-token'] || url.searchParams.get('t');
  if (!checkAdminToken(token)) throw new HttpError(401, 'Nicht angemeldet');
  const m = req.method, p = url.pathname;

  if (p === '/api/admin/games' && m === 'GET') {
    const games = Object.values(db.games).sort((a, b) => b.createdAt - a.createdAt).map(adminSummary);
    return sendJSON(res, 200, { games });
  }
  if (p === '/api/admin/games' && m === 'POST') {
    const b = await readJSON(req);
    const g = newGame(cleanText(b.name, 40) || 'Manhunt', b.settings);
    return sendJSON(res, 201, adminSummary(g));
  }
  const r = p.match(/^\/api\/admin\/games\/([A-Za-z0-9]+)(?:\/(\w+))?$/);
  if (!r) throw new HttpError(404, 'Nicht gefunden');
  const g = getGame(r[1]); const act = r[2];

  if (!act && m === 'DELETE') {
    deletePhotoFiles(g.code); delete db.games[g.code]; save();
    return sendJSON(res, 200, { ok: true });
  }
  if (!act && m === 'PATCH') {
    const b = await readJSON(req);
    if (b.name !== undefined) g.name = cleanText(b.name, 40) || g.name;
    if (b.settings) g.settings = sanitizeSettings(b.settings, g.settings);
    save(); notify(g.code);
    return sendJSON(res, 200, adminSummary(g));
  }
  if (m === 'POST') {
    const b = await readJSON(req);
    if (act === 'start') startGame(g);
    else if (act === 'end') endGame(g, 'Beendet von der Spielleitung.');
    else if (act === 'reset') resetGame(g);
    else if (act === 'announce') { const t = cleanText(b.text, 300); if (!t) throw new HttpError(400, 'Nachricht fehlt'); pushMsg(g, t, 'admin'); }
    else if (act === 'kick') { delete g.players[b.playerId]; g.locations = g.locations.filter((l) => l.pid !== b.playerId); g.photos = g.photos.filter((x) => x.pid !== b.playerId); }
    else throw new HttpError(404, 'Unbekannte Aktion');
    checkAllCaught(g); save(); notify(g.code);
    return sendJSON(res, 200, adminSummary(g));
  }
  throw new HttpError(405, 'Methode nicht erlaubt');
}

async function handleGame(req, res, url, code, rest) {
  const g = getGame(code);
  const m = req.method;

  if (rest === 'info' && m === 'GET') {
    const ps = Object.values(g.players);
    return sendJSON(res, 200, {
      code: g.code, name: g.name, status: g.status,
      runners: ps.filter((p) => p.role === 'runner').length, hunters: ps.filter((p) => p.role === 'hunter').length,
      settings: {
        locationIntervalSec: g.settings.locationIntervalSec, photosEnabled: g.settings.photosEnabled,
        photoIntervalMin: g.settings.photoIntervalMin, headStartMin: g.settings.headStartMin,
        fuzzMeters: g.settings.fuzzMeters, zoneEnabled: g.settings.zoneEnabled,
      },
    });
  }
  if (rest === 'join' && m === 'POST') {
    const b = await readJSON(req);
    const name = cleanText(b.name, 24);
    if (!name) throw new HttpError(400, 'Bitte einen Namen eingeben');
    if (!['runner', 'hunter'].includes(b.role)) throw new HttpError(400, 'Bitte eine Rolle wählen');
    if (g.status === 'ended') throw new HttpError(409, 'Das Spiel ist schon beendet');
    if (Object.keys(g.players).length >= MAX_PLAYERS) throw new HttpError(409, 'Das Spiel ist voll');
    if (Object.values(g.players).some((p) => p.name.toLowerCase() === name.toLowerCase())) throw new HttpError(409, 'Dieser Name ist schon vergeben');
    const player = { id: rid(4), name, role: b.role, token: rid(18), caught: false, joinedAt: Date.now(), lastSeen: Date.now(), lastLoc: null };
    g.players[player.id] = player;
    pushMsg(g, `${name} ist als ${b.role === 'runner' ? 'Runner' : 'Hunter'} beigetreten.`);
    save(); notify(g.code);
    return sendJSON(res, 201, { token: player.token, id: player.id, name, role: player.role });
  }

  // Ab hier ist eine Anmeldung nötig
  const t = req.headers['x-token'] || url.searchParams.get('t') || '';
  let auth = null;
  if (checkAdminToken(t)) auth = { admin: true };
  else {
    const player = Object.values(g.players).find((pl) => safeEq(pl.token, t));
    if (player) { player.lastSeen = Date.now(); auth = { player }; }
  }
  if (!auth) throw new HttpError(401, 'Nicht angemeldet oder aus dem Spiel entfernt');

  if (rest === 'state' && m === 'GET') return sendJSON(res, 200, buildState(g, auth));
  if (rest === 'events' && m === 'GET') return openSSE(req, res, g);

  if (rest === 'location' && m === 'POST') {
    if (!auth.player) throw new HttpError(403, 'Nur für Spieler');
    const pl = auth.player;
    if (g.status !== 'running') throw new HttpError(409, 'Das Spiel läuft gerade nicht');
    if (pl.caught) throw new HttpError(409, 'Du bist gefangen');
    const b = await readJSON(req);
    const lat = Number(b.lat), lng = Number(b.lng), acc = Math.min(10000, Math.max(0, Number(b.acc) || 0));
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) throw new HttpError(400, 'Ungültige Position');
    const now = Date.now();
    const minGap = Math.max(8000, g.settings.locationIntervalSec * 1000 * 0.8);
    if (pl.lastLoc && now - pl.lastLoc.ts < minGap) return sendJSON(res, 200, { ok: false, nextInMs: pl.lastLoc.ts + minGap - now });
    pl.lastLoc = { lat, lng, acc, ts: now };
    g.locations.push({ pid: pl.id, lat, lng, acc: Math.round(acc), ts: now });
    if (g.locations.length > MAX_LOCATIONS) g.locations.splice(0, g.locations.length - MAX_LOCATIONS);
    save(); notify(g.code);
    return sendJSON(res, 200, { ok: true, nextInMs: g.settings.locationIntervalSec * 1000 });
  }

  if (rest === 'photo' && m === 'POST') {
    const pl = auth.player;
    if (!pl || pl.role !== 'runner') throw new HttpError(403, 'Nur Runner laden Fotos hoch');
    if (!g.settings.photosEnabled) throw new HttpError(409, 'Fotos sind in diesem Spiel ausgeschaltet');
    if (g.status !== 'running') throw new HttpError(409, 'Das Spiel läuft gerade nicht');
    if (pl.caught) throw new HttpError(409, 'Du bist gefangen');
    const buf = await readBody(req, MAX_PHOTO_BYTES);
    if (buf.length < 100 || buf[0] !== 0xff || buf[1] !== 0xd8) throw new HttpError(400, 'Bitte ein JPEG-Foto senden');
    const id = rid(6);
    await fsp.writeFile(path.join(PHOTO_DIR, `${g.code}_${id}.jpg`), buf);
    g.photos.push({ id, pid: pl.id, ts: Date.now() });
    save(); notify(g.code);
    return sendJSON(res, 201, { ok: true, id });
  }

  const ph = rest.match(/^photo\/([a-f0-9]{12})$/);
  if (ph && m === 'GET') {
    const photo = g.photos.find((x) => x.id === ph[1]);
    const st = buildState(g, auth);
    if (!photo || !st.photos.some((x) => x.id === photo.id)) throw new HttpError(404, 'Foto nicht gefunden');
    const data = await fsp.readFile(path.join(PHOTO_DIR, `${g.code}_${photo.id}.jpg`)).catch(() => null);
    if (!data) throw new HttpError(404, 'Foto nicht gefunden');
    res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': data.length, 'Cache-Control': 'private, max-age=86400, immutable' });
    return res.end(data);
  }

  if (rest === 'caught' && m === 'POST') {
    if (!g.settings.caughtEnabled) throw new HttpError(409, 'Gefangen-Funktion ist ausgeschaltet');
    if (g.status !== 'running') throw new HttpError(409, 'Das Spiel läuft gerade nicht');
    const b = await readJSON(req);
    const target = g.players[b.playerId];
    if (!target || target.role !== 'runner') throw new HttpError(404, 'Runner nicht gefunden');
    const value = b.caught !== false;
    const isHunterOrAdmin = auth.admin || auth.player.role === 'hunter';
    const isSelf = auth.player && auth.player.id === target.id;
    if (!isHunterOrAdmin && !(isSelf && value)) throw new HttpError(403, 'Nicht erlaubt');
    if (target.caught !== value) {
      target.caught = value;
      pushMsg(g, value ? `${target.name} wurde gefangen!` : `${target.name} ist wieder im Spiel.`);
      checkAllCaught(g); save(); notify(g.code);
    }
    return sendJSON(res, 200, { ok: true });
  }

  throw new HttpError(404, 'Nicht gefunden');
}

/* ------------------------------------------------------------------ */
/* Statische Dateien                                                   */
/* ------------------------------------------------------------------ */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
};
const CSP = [
  "default-src 'self'",
  "script-src 'self' https://unpkg.com",
  "style-src 'self' 'unsafe-inline' https://unpkg.com",
  "img-src 'self' data: blob: https://unpkg.com https://*.tile.openstreetmap.org",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
].join('; ');

async function serveStatic(req, res, url) {
  if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Methode nicht erlaubt');
  let p = decodeURIComponent(url.pathname);
  if (p === '/') p = '/index.html';
  else if (p === '/admin') p = '/admin.html';
  else if (/^\/g\/[A-Za-z0-9]+\/?$/.test(p)) p = '/game.html';
  const file = path.normalize(path.join(PUBLIC_DIR, p));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) throw new HttpError(403, 'Verboten');
  const data = await fsp.readFile(file).catch(() => null);
  if (!data) throw new HttpError(404, 'Seite nicht gefunden');
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  res.end(req.method === 'HEAD' ? undefined : data);
}

const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(self), camera=(self)');
  res.setHeader('Content-Security-Policy', CSP);
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) await handleApi(req, res, url);
    else await serveStatic(req, res, url);
  } catch (e) {
    if (res.headersSent) return res.end();
    if (e instanceof HttpError) {
      if (req.url.startsWith('/api/')) return sendJSON(res, e.status, { error: e.message });
      res.writeHead(e.status, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end(e.message);
    }
    console.error(e);
    sendJSON(res, 500, { error: 'Serverfehler' });
  }
});
server.listen(PORT, HOST, () => console.log(`[manhunt] läuft auf http://${HOST}:${PORT}  (Daten: ${DATA_DIR})`));
