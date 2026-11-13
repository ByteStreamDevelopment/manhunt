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
const { ABILITIES, QUESTS, POINTS, BADGES, RARITY, ABILITY_REWARD_QUESTS, catalogForClients } = require('./lib/catalog');
const { Store } = require('./lib/store');
const { createSocial } = require('./lib/social');
const { ZipWriter, safeName } = require('./lib/zip');
const { haversine, offset, randomPointAround, fetchPois } = require('./lib/geo');
const { detectVpn, checkSpoof } = require('./lib/anticheat');
const smtp = require('./lib/smtp');
const { createMailer } = require('./lib/mail');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const PHOTO_DIR = path.join(DATA_DIR, 'photos');
const GALLERY_DIR = path.join(DATA_DIR, 'gallery');
const AVATAR_DIR = path.join(DATA_DIR, 'avatars');     // Profilbilder (Issue #7)
const SHOWCASE_DIR = path.join(DATA_DIR, 'showcase');  // Fotos, die man auf dem eigenen Profil ausstellt (Issue #8)
const MAX_SHOWCASE = 24;
/** Erlaubte Reaktionen auf Fotos (Issue #6) */
const REACTIONS = ['👍', '❤️', '😂', '😮', '🔥', '👏', '🤩', '👎'];
const DB_FILE = path.join(DATA_DIR, 'db.json'); // altes Format, wird beim Start übernommen
const SQLITE_FILE = path.join(DATA_DIR, 'manhunt.sqlite');
const VOICE_DIR = path.join(DATA_DIR, 'voice');
const MAX_VOICE_BYTES = 1024 * 1024;
/** Standortdaten beendeter Spiele werden nach so vielen Tagen gelöscht (0 = nie). */
const RETENTION_DAYS = Number(process.env.RETENTION_DAYS ?? 30);
const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
const MAX_PLAYERS = 60;
const MAX_LOCATIONS = 60000;
const TICK_MS = 5000;
/** Accounts mit diesen Namen sind Admins (Groß-/Kleinschreibung egal). */
const ADMIN_USERNAMES = String(process.env.ADMIN_USERNAMES || 'ProfImpossible,Mrcoolgamer11')
  .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
/**
 * Jeder bestätigte Account darf Runden anlegen. Damit Fotos den Server nicht zumüllen, hat jeder (außer Admins)
 * ein Speicherkontingent: Fotos und Sprachnachrichten aller eigenen Runden zählen dazu.
 */
const MB = 1024 * 1024;
const USER_QUOTA_MB = Math.max(1, Number(process.env.USER_QUOTA_MB) || 1024);
/** So viele nicht beendete Runden (Lobby oder laufend) darf ein normaler Account gleichzeitig haben */
const MAX_OPEN_GAMES = Math.max(1, Number(process.env.MAX_OPEN_GAMES) || 3);
/** Laufende Runden enden spätestens nach so vielen Stunden automatisch (vergessene Runden) */
const MAX_GAME_HOURS = Math.max(1, Number(process.env.MAX_GAME_HOURS) || 24);
/** Fotos und Sprachnachrichten beendeter Runden werden nach so vielen Tagen gelöscht (0 = nie). Galerie und Vitrine bleiben. */
const PHOTO_RETENTION_DAYS = Number(process.env.PHOTO_RETENTION_DAYS ?? 30);
const MAX_COHOSTS = 5;
/** Unbestätigte Konten nach so vielen Tagen löschen (Datensparsamkeit) */
const UNVERIFIED_DAYS = Number(process.env.UNVERIFIED_DAYS ?? 7);
/** Version der Datenschutzerklärung – bei wesentlichen Änderungen hochzählen (Nachweis der Kenntnisnahme) */
const PRIVACY_VERSION = '2026-11-13';
const PUBLIC_URL = process.env.PUBLIC_URL || 'https://manhunt.nebendahl.eu';
const MAX_TEMPLATES = 20;

fs.mkdirSync(PHOTO_DIR, { recursive: true });
fs.mkdirSync(GALLERY_DIR, { recursive: true });
fs.mkdirSync(VOICE_DIR, { recursive: true });
fs.mkdirSync(AVATAR_DIR, { recursive: true });
fs.mkdirSync(SHOWCASE_DIR, { recursive: true });

let ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
if (!ADMIN_PASSWORD) {
  ADMIN_PASSWORD = crypto.randomBytes(6).toString('hex');
  console.log(`[manhunt] ADMIN_PASSWORD ist nicht gesetzt. Temporäres Passwort: ${ADMIN_PASSWORD}`);
}

/* ------------------------------------------------------------------ */
/* Einstellungen (jedes Feature ist hier ein-/ausschaltbar)             */
/* ------------------------------------------------------------------ */
function defaultAbilities() {
  const o = {};
  for (const [k, a] of Object.entries(ABILITIES)) o[k] = { enabled: true, start: a.start, obtainable: a.obtainable, durationSec: a.durationSec, cooldownSec: a.cooldownSec || 0 };
  return o;
}
function defaultQuests() {
  const o = {};
  for (const [k, q] of Object.entries(QUESTS)) o[k] = { enabled: true, minutes: q.minutes, points: q.points, reward: ABILITY_REWARD_QUESTS.includes(k) ? 'random' : 'none' };
  return o;
}
const DEFAULTS = {
  locationIntervalSec: 60,       // wie oft der Standort geteilt wird
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
  livePenaltyEnabled: true,      // Live-Standort, wenn das Foto zu spät kommt
  photoGraceSec: 60,             // so lange nach Fälligkeit hat man Zeit
  livePenaltyUntil: 'nextRound', // 'nextRound': live bis zum Foto der nächsten Runde, 'upload': bis zum nächsten Foto
  liveIntervalSec: 5,            // Intervall im Live-Modus
  caughtEnabled: true,           // "Gefangen"-Funktion
  caughtBecomeHunter: true,      // Gefangene Runner spielen als Hunter weiter
  freezeImmunitySec: 120,        // nach einem Freeze sind Hunter so lange immun gegen den nächsten
  chatEnabled: true,             // Team-Chat
  allChatEnabled: true,          // zusätzlich ein Chat für alle (Runner, Hunter, Zuschauer lesen mit)
  voiceEnabled: true,            // Sprachnachrichten im Team-Chat
  spectatorsEnabled: true,       // Zuschauer dürfen beitreten
  spectatorDelaySec: 120,        // Zuschauer sehen Positionen so viel später (damit sie nichts verraten)
  autoEndWhenAllCaught: true,    // Spiel endet, wenn alle Runner gefangen sind
  zoneEnabled: false,            // Spielzone (Kreis) mit Warnung bei Verlassen
  zoneLat: 0,
  zoneLng: 0,
  zoneRadiusM: 1000,
  abilitiesEnabled: true,        // Fähigkeiten
  questsEnabled: true,           // Quests
  questIntervalMin: 8,           // alle X Minuten bekommt jeder eine neue Quest
  questMaxActive: 1,             // so viele Quests gleichzeitig
  pickupsEnabled: true,          // Fähigkeiten zum Einsammeln auf der Karte
  pickupIntervalMin: 12,         // alle X Minuten taucht eine neue auf
  pickupMax: 3,                  // höchstens so viele gleichzeitig
  pickupSpacingM: 1000,          // höchstens eine pro Umkreis (Meter, mindestens 1000)
  pickupCollectM: 40,            // so nah muss man ran
  pickupLifetimeMin: 30,         // so lange bleibt eine liegen
  pickupSearchM: 3000,           // Suchradius für große Orte um die Spielmitte
  pickupRandomFallback: true,    // ohne große Orte zufällige Punkte verwenden
  supplyDropsEnabled: false,     // Versorgungsabwürfe (angekündigt, mit mehreren Fähigkeiten)
  supplyDropIntervalMin: 20,     // alle X Minuten ein Abwurf
  supplyDropWarnMin: 5,          // so lange vorher wird er angekündigt
  supplyDropAbilities: 2,        // so viele Fähigkeiten enthält er
  antiVpn: 'warn',               // off | warn | block
  antiSpoof: 'warn',             // off | warn | block
  maxSpeedKmh: 45,               // schneller = verdächtig
  abilities: defaultAbilities(),
  quests: defaultQuests(),
  customQuests: [],              // eigene Quests der Spielleitung (Foto oder fester Ort)
  adminGiftsEnabled: false,      // Spielleitung darf Fähigkeiten verschenken (Standard: aus, sonst unfair)
  publicListed: false,           // Runde erscheint unter „Offene Runden“ (jeder mit Account kann sie finden und beitreten)
};
const LIMITS = {
  locationIntervalSec: [10, 3600], headStartMin: [0, 600], autoEndAfterMin: [0, 1440],
  fuzzMeters: [0, 2000], photoIntervalMin: [1, 240], zoneRadiusM: [50, 50000],
  zoneLat: [-90, 90], zoneLng: [-180, 180], photoGraceSec: [0, 3600], liveIntervalSec: [3, 60],
  questIntervalMin: [1, 120], questMaxActive: [1, 5], pickupIntervalMin: [1, 120], pickupMax: [0, 50],
  pickupSpacingM: [1000, 20000], pickupCollectM: [15, 200], pickupLifetimeMin: [2, 600], pickupSearchM: [300, 10000],
  maxSpeedKmh: [10, 500], freezeImmunitySec: [0, 1800], spectatorDelaySec: [0, 1800],
  supplyDropIntervalMin: [1, 240], supplyDropWarnMin: [0, 60], supplyDropAbilities: [1, 5],
};
const ENUMS = { livePenaltyUntil: ['nextRound', 'upload'], antiVpn: ['off', 'warn', 'block'], antiSpoof: ['off', 'warn', 'block'] };
const toBool = (v) => v === true || v === 'true';
const clampNum = (v, lo, hi, def) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : def; };

function sanitizeSettings(input, base = DEFAULTS) {
  const out = { ...DEFAULTS, ...base };
  out.abilities = { ...defaultAbilities(), ...(base.abilities || {}) };
  out.quests = { ...defaultQuests(), ...(base.quests || {}) };
  out.customQuests = Array.isArray(base.customQuests) ? base.customQuests : [];
  if (!input || typeof input !== 'object') return out;
  for (const key of Object.keys(DEFAULTS)) {
    if (!(key in input) || key === 'abilities' || key === 'quests' || key === 'customQuests') continue;
    const v = input[key];
    if (ENUMS[key]) { if (ENUMS[key].includes(v)) out[key] = v; }
    else if (typeof DEFAULTS[key] === 'boolean') out[key] = toBool(v);
    else {
      const n = Number(v);
      if (!Number.isFinite(n)) continue;
      const [lo, hi] = LIMITS[key];
      out[key] = Math.min(hi, Math.max(lo, n));
    }
  }
  if (input.abilities && typeof input.abilities === 'object') {
    for (const [k, def] of Object.entries(ABILITIES)) {
      const v = input.abilities[k]; if (!v || typeof v !== 'object') continue;
      const cur = out.abilities[k];
      out.abilities[k] = {
        enabled: 'enabled' in v ? toBool(v.enabled) : cur.enabled,
        start: 'start' in v ? Math.round(clampNum(v.start, 0, 20, cur.start)) : cur.start,
        obtainable: 'obtainable' in v ? toBool(v.obtainable) : cur.obtainable,
        durationSec: def.durationSec === 0 ? 0 : ('durationSec' in v ? Math.round(clampNum(v.durationSec, 10, 3600, cur.durationSec)) : cur.durationSec),
        cooldownSec: 'cooldownSec' in v ? Math.round(clampNum(v.cooldownSec, 0, 3600, cur.cooldownSec ?? 0)) : (cur.cooldownSec ?? def.cooldownSec ?? 0),
      };
    }
  }
  if (Array.isArray(input.customQuests)) {
    out.customQuests = input.customQuests.slice(0, 30).map((q) => {
      const kind = q && q.kind === 'place' ? 'place' : 'photo';
      const c = {
        id: typeof q?.id === 'string' && /^[a-z0-9]{4,12}$/.test(q.id) ? q.id : crypto.randomBytes(4).toString('hex'),
        enabled: q.enabled !== false && q.enabled !== 'false',
        title: String(q.title || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 40),
        desc: String(q.desc || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 200),
        icon: String(q.icon || '⭐').slice(0, 4),
        team: ['runner', 'hunter', 'any'].includes(q.team) ? q.team : 'any',
        kind,
        minutes: Math.round(clampNum(q.minutes, 1, 120, 10)),
        points: Math.round(clampNum(q.points, 0, 1000, 50)),
        reward: q.reward === 'none' || ABILITIES[q.reward] ? q.reward : 'random',
      };
      if (kind === 'place') {
        c.lat = clampNum(q.lat, -90, 90, 0); c.lng = clampNum(q.lng, -180, 180, 0);
        c.radiusM = Math.round(clampNum(q.radiusM, 15, 500, 40));
        c.placeName = String(q.placeName || c.title).slice(0, 60);
      }
      return c;
    }).filter((q) => q.title);
  }
  if (input.quests && typeof input.quests === 'object') {
    for (const k of Object.keys(QUESTS)) {
      const v = input.quests[k]; if (!v || typeof v !== 'object') continue;
      const cur = out.quests[k];
      const reward = v.reward === 'random' || v.reward === 'none' || ABILITIES[v.reward] ? v.reward : cur.reward;
      out.quests[k] = {
        enabled: 'enabled' in v ? toBool(v.enabled) : cur.enabled,
        minutes: 'minutes' in v ? Math.round(clampNum(v.minutes, 1, 120, cur.minutes)) : cur.minutes,
        points: 'points' in v ? Math.round(clampNum(v.points, 0, 1000, cur.points)) : cur.points,
        reward,
      };
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Datenhaltung (JSON-Datei, atomar geschrieben)                        */
/* ------------------------------------------------------------------ */
const store = new Store(SQLITE_FILE);
if (store.migrateJson(DB_FILE)) console.log('[manhunt] Alte db.json nach SQLite übernommen (db.json.migrated).');
let db = store.load();
if (!db.secret) db.secret = crypto.randomBytes(32).toString('hex');
db.accounts ||= {}; db.gallery ||= []; db.reports ||= [];
// Ältere Spielstände auf das aktuelle Format bringen
for (const g of Object.values(db.games)) {
  g.settings = sanitizeSettings(g.settings, g.settings || DEFAULTS);
  g.effects ||= []; g.pickups ||= []; g.photos ||= []; g.messages ||= []; g.locations ||= []; g.chat ||= [];
  g.cohosts ||= []; g.banned ||= [];
  for (const p of Object.values(g.players)) { migratePlayer(p); p.gameCode = g.code; }
  indexLocations(g);
  // Dateigrößen für das Speicherkontingent nachtragen (ältere Spielstände)
  for (const ph of g.photos) if (ph.size === undefined) ph.size = fileSize(path.join(PHOTO_DIR, `${g.code}_${ph.id}.jpg`));
  for (const c of g.chat) if (c.voice && c.voice.size === undefined) c.voice.size = fileSize(path.join(VOICE_DIR, `${g.code}_${c.voice.id}.${c.voice.ext}`));
}
function fileSize(f) { try { return fs.statSync(f).size; } catch { return 0; } }
function migratePlayer(p) {
  p.abilities ||= {}; p.quests ||= []; p.inbox ||= []; p.flags ||= {}; p.points ||= 0; p.jokers ||= []; p.cooldowns ||= {};
  if (p.penalty === undefined) p.penalty = null;
  return p;
}

/* ---------------- Standorte: im Speicher pro Spieler indiziert, in SQLite angehängt ---------------- */
function indexLocations(g) {
  g._byPid = new Map();
  for (const l of g.locations) {
    if (!g._byPid.has(l.pid)) g._byPid.set(l.pid, []);
    g._byPid.get(l.pid).push(l);
  }
}
const locsOf = (g, pid) => (g._byPid && g._byPid.get(pid)) || [];
function addLocation(g, l) {
  g.locations.push(l);
  if (!g._byPid) indexLocations(g);
  if (!g._byPid.has(l.pid)) g._byPid.set(l.pid, []);
  const arr = g._byPid.get(l.pid);
  // Nachgereichte (offline gesammelte) Positionen chronologisch einsortieren
  if (arr.length && arr[arr.length - 1].ts > l.ts) { arr.push(l); arr.sort((a, b) => a.ts - b.ts); } else arr.push(l);
  store.addLocation(g.code, l);
  if (g.locations.length > MAX_LOCATIONS) {
    const cut = g.locations[g.locations.length - MAX_LOCATIONS].ts;
    g.locations = g.locations.filter((x) => x.ts >= cut);
    indexLocations(g);
    store.trimLocations(g.code, cut);
  }
}
function clearLocations(g, pid) {
  if (pid) g.locations = g.locations.filter((l) => l.pid !== pid); else g.locations = [];
  indexLocations(g);
  store.deleteLocations(g.code, pid);
}

let saveTimer = null;
function save() { if (!saveTimer) saveTimer = setTimeout(flush, 400); }
function flush() {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  try { store.flush(db); } catch (e) { console.error('[manhunt] Speichern fehlgeschlagen:', e); }
}
flush();
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { flush(); store.close(); process.exit(0); });

/* Datenschutz: Standortdaten beendeter Spiele nach RETENTION_DAYS löschen (stündlich geprüft) */
function applyRetention() {
  // Fotos/Sprachnachrichten beendeter Runden nach PHOTO_RETENTION_DAYS löschen (gibt Speicher frei)
  if (PHOTO_RETENTION_DAYS > 0) {
    const pcut = Date.now() - PHOTO_RETENTION_DAYS * 864e5;
    // 3 Tage vorher Bescheid geben (wer Fotos hat, kann sie noch als ZIP sichern)
    const noticeDays = PHOTO_RETENTION_DAYS >= 6 ? 3 : 0;
    if (noticeDays) {
      const ncut = pcut + noticeDays * 864e5;
      for (const g of Object.values(db.games)) {
        if (g.status !== 'ended' || !g.endedAt || g.endedAt >= ncut || g.endedAt < pcut || !g.photos.length || g.expiryNoticeAt) continue;
        g.expiryNoticeAt = Date.now(); save();
        const ids = new Set(Object.values(g.players).map((p) => p.accountId).filter(Boolean));
        if (g.ownerId) ids.add(g.ownerId);
        const days = Math.max(1, Math.ceil((g.endedAt - pcut) / 864e5));
        for (const id of ids) mailer.send(db.accounts[id], 'photosExpiring', { gameName: g.name, code: g.code, count: g.photos.length, days, retention: PHOTO_RETENTION_DAYS }).catch(() => {});
      }
    }
    for (const g of Object.values(db.games)) {
      if (g.status === 'ended' && g.endedAt && g.endedAt < pcut && (g.photos.length || g.chat.some((c) => c.voice))) {
        purgeGameMedia(g); g.photosExpiredAt = Date.now(); save();
      }
    }
  }
  // Unbestätigte Konten (nie bestätigte Registrierungen) nach UNVERIFIED_DAYS löschen
  if (UNVERIFIED_DAYS > 0) {
    const ucut = Date.now() - UNVERIFIED_DAYS * 864e5;
    for (const a of Object.values(db.accounts)) if (!a.verified && a.createdAt < ucut && !isAdminAccount(a)) { delete db.accounts[a.id]; save(); }
  }
  // Meldungen: erledigte nach 90, alle nach 180 Tagen löschen
  const before = (db.reports || []).length;
  db.reports = (db.reports || []).filter((r) => (r.resolved ? r.resolved > Date.now() - 90 * 864e5 : r.ts > Date.now() - 180 * 864e5));
  if (db.reports.length !== before) save();
  if (!(RETENTION_DAYS > 0)) return;
  const cutoff = Date.now() - RETENTION_DAYS * 864e5;
  for (const g of Object.values(db.games)) {
    if (g.status === 'ended' && g.endedAt && g.endedAt < cutoff && (g.locations.length || g.chat.length || !g.retentionDone)) {
      // Standorte, Chat, Meldungen und private Nachrichten beendeter Runden löschen; Ergebnis und Punkte bleiben
      clearLocations(g);
      g.chat = []; g.messages = g.messages.filter((m) => m.kind === 'system' && /^Spiel beendet/.test(m.text)); g.effects = []; g.pickups = [];
      for (const p of Object.values(g.players)) { p.lastLoc = null; p.inbox = []; p.flags = {}; }
      deleteVoiceFiles(g.code);
      g.retentionDone = Date.now();
      save();
    }
  }
}
setImmediate(applyRetention); // erst nach dem Laden aller Module (nutzt spätere Helfer)
setInterval(applyRetention, 3600e3).unref();

/* ------------------------------------------------------------------ */
/* Hilfsfunktionen                                                     */
/* ------------------------------------------------------------------ */
class HttpError extends Error { constructor(status, message, data) { super(message); this.status = status; this.data = data; } }
const rid = (n = 8) => crypto.randomBytes(n).toString('hex');
const hmac = (s) => crypto.createHmac('sha256', db.secret + '|' + ADMIN_PASSWORD).update(s).digest('hex');
// Abmelde-Links in Mails dürfen nicht ungültig werden, wenn sich ADMIN_PASSWORD ändert -> nur db.secret
const mailer = createMailer({ smtp, publicUrl: PUBLIC_URL, sign: (x) => crypto.createHmac('sha256', db.secret).update(x).digest('hex'), getDb: () => db, save: () => save() });
const berlinTime = (ts = Date.now()) => new Date(ts).toLocaleString('de-DE', { timeZone: 'Europe/Berlin', dateStyle: 'long', timeStyle: 'short' }) + ' Uhr';
function safeEq(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
/**
 * Admin-Token. Mit Account-Anmeldung steht der Name drin (exp.name.sig), damit der Server weiß,
 * wer die Spielleitung ist – wichtig, wenn sie selbst mitspielt. Mit Server-Passwort: exp.sig (ohne Namen).
 */
function makeAdminToken(username = '') {
  const exp = String(Date.now() + 7 * 864e5);
  if (!username) return `${exp}.${hmac(exp)}`;
  const u = Buffer.from(username).toString('base64url');
  return `${exp}.${u}.${hmac(`${exp}|${u}`)}`;
}
/** false, wenn ungültig; sonst { username } ('' = Server-Passwort) */
function checkAdminToken(t) {
  if (typeof t !== 'string') return false;
  const parts = t.split('.');
  const exp = parts[0];
  if (!/^\d+$/.test(exp || '') || Number(exp) <= Date.now()) return false;
  if (parts.length === 2) return safeEq(parts[1], hmac(exp)) ? { username: '' } : false;
  if (parts.length === 3) return safeEq(parts[2], hmac(`${exp}|${parts[1]}`)) ? { username: Buffer.from(parts[1], 'base64url').toString() } : false;
  return false;
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
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

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
/**
 * IP-Adresse des Clients. X-Forwarded-For wird nur ausgewertet, wenn die Anfrage von einem Proxy im eigenen Netz
 * kommt (z. B. Caddy im Docker-Netz). Sonst könnte jeder den Header fälschen und die Bremse gegen Durchprobieren umgehen.
 * TRUST_PROXY=always|never|private (Standard private).
 */
const TRUST_PROXY = process.env.TRUST_PROXY || 'private';
const PRIVATE_RE = /^(::ffff:)?(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)|^::1$|^f[cd]/i;
function clientIp(req) {
  const remote = String(req.socket.remoteAddress || '');
  const xff = String(req.headers['x-forwarded-for'] || '');
  const trust = TRUST_PROXY === 'always' || (TRUST_PROXY === 'private' && PRIVATE_RE.test(remote));
  if (trust && xff) {
    const parts = xff.split(',').map((x) => x.trim()).filter(Boolean);
    return parts[parts.length - 1] || remote; // letzter Eintrag = vom eigenen Proxy angehängt
  }
  return remote;
}

/* Einfacher Bremsklotz gegen Durchprobieren (pro IP und Zweck) */
const limiter = new Map();
function rateLimit(req, purpose, max, windowMs) {
  const key = purpose + '|' + clientIp(req);
  const now = Date.now();
  const e = limiter.get(key);
  if (!e || now > e.until) { limiter.set(key, { n: 1, until: now + windowMs }); return; }
  e.n++;
  if (e.n > max) throw new HttpError(429, 'Zu viele Versuche. Bitte kurz warten.');
}
setInterval(() => { const now = Date.now(); for (const [k, e] of limiter) if (now > e.until) limiter.delete(k); }, 60000).unref();

/* ------------------------------------------------------------------ */
/* Accounts mit E-Mail-Bestätigung                                     */
/* ------------------------------------------------------------------ */
const USERNAME_RE = /^[A-Za-z0-9_.-]{3,20}$/;
const EMAIL_RE = /^[^\s@<>()\[\],;:"]+@[^\s@<>()\[\],;:"]+\.[^\s@<>()\[\],;:"]{2,}$/;
const isAdminAccount = (a) => !!a && ADMIN_USERNAMES.includes(a.username.toLowerCase());
function emptyStats() {
  return {
    points: 0, games: 0, wins: 0, catches: 0, caught: 0, quests: 0, pickups: 0, photos: 0, abilities: 0, featured: 0, surviveMin: 0,
    cleanEscapes: 0, freezes: 0, radars: 0, revenge: 0, chats: 0,
  };
}
function hashPassword(pw, salt) { return crypto.scryptSync(String(pw), salt, 64).toString('hex'); }
function findAccount(login) {
  const l = String(login || '').trim().toLowerCase();
  return Object.values(db.accounts).find((a) => a.username.toLowerCase() === l || a.email.toLowerCase() === l) || null;
}
function makeAccountToken(a) {
  const exp = String(Date.now() + 90 * 864e5);
  return `acc.${a.id}.${exp}.${hmac(`acc|${a.id}|${exp}|${a.tokenVersion || 0}`)}`;
}
function accountFromToken(t) {
  if (typeof t !== 'string' || !t.startsWith('acc.')) return null;
  const [, id, exp, sig] = t.split('.');
  const a = db.accounts[id];
  if (!a || !exp || Number(exp) < Date.now()) return null;
  return safeEq(sig || '', hmac(`acc|${id}|${exp}|${a.tokenVersion || 0}`)) ? a : null;
}
function publicAccount(a) {
  return { id: a.id, username: a.username, email: a.email, verified: !!a.verified, isAdmin: isAdminAccount(a), stats: { ...emptyStats(), ...a.stats }, badges: Object.keys(a.badges || {}), avatar: a.avatar || null, createdAt: a.createdAt };
}
async function sendCode(a, purpose) {
  const code = String(crypto.randomInt(0, 1e6)).padStart(6, '0');
  a.code = { hash: hmac(`code|${a.id}|${code}`), exp: Date.now() + 30 * 60000, purpose, tries: 0 };
  save();
  try { await mailer.send(a, purpose === 'reset' ? 'reset' : 'verify', { code, username: a.username }); }
  catch (e) { console.error(`[manhunt] Mail an ${a.email} fehlgeschlagen: ${e.message}`); throw new HttpError(502, 'Die E-Mail konnte nicht verschickt werden. Bitte später erneut versuchen.'); }
}
function checkCode(a, code, purpose) {
  const c = a.code;
  if (!c || c.purpose !== purpose || Date.now() > c.exp) throw new HttpError(400, 'Der Code ist abgelaufen. Fordere einen neuen an.');
  if (c.tries >= 5) throw new HttpError(429, 'Zu viele falsche Versuche. Fordere einen neuen Code an.');
  c.tries++;
  if (!safeEq(c.hash, hmac(`code|${a.id}|${String(code || '').trim()}`))) { save(); throw new HttpError(400, 'Falscher Code'); }
  a.code = null;
}

async function handleAuth(req, res, p) {
  const m = req.method;
  if (p === '/api/auth/register' && m === 'POST') {
    rateLimit(req, 'register', 10, 3600e3);
    const b = await readJSON(req);
    const username = cleanText(b.username, 20), email = cleanText(b.email, 120).toLowerCase(), pw = String(b.password || '');
    if (!USERNAME_RE.test(username)) throw new HttpError(400, 'Benutzername: 3–20 Zeichen, nur Buchstaben, Zahlen, _ . -');
    if (!EMAIL_RE.test(email)) throw new HttpError(400, 'Bitte eine gültige E-Mail-Adresse eingeben');
    if (pw.length < 8) throw new HttpError(400, 'Das Passwort muss mindestens 8 Zeichen haben');
    // Kenntnisnahme der Datenschutzerklärung und Mindestalter (Art. 8 DSGVO: 16 Jahre) bestätigen
    if (b.acceptPrivacy !== true) throw new HttpError(400, 'Bitte bestätige, dass du die Datenschutzerklärung gelesen hast und mindestens 16 Jahre alt bist (oder deine Eltern einverstanden sind).', { needsConsent: true });
    if (findAccount(username)) throw new HttpError(409, 'Dieser Benutzername ist schon vergeben');
    if (findAccount(email)) throw new HttpError(409, 'Für diese E-Mail gibt es schon einen Account');
    // Admin-Namen sind reserviert: nur mit dem Server-Admin-Passwort registrierbar
    if (ADMIN_USERNAMES.includes(username.toLowerCase()) && !safeEq(String(b.adminKey || ''), ADMIN_PASSWORD)) {
      throw new HttpError(403, 'Dieser Name ist für die Spielleitung reserviert.', { needsAdminKey: true });
    }
    const salt = rid(16);
    const a = {
      id: rid(6), username, email, salt, hash: hashPassword(pw, salt), verified: false, createdAt: Date.now(), tokenVersion: 0, stats: emptyStats(), code: null,
      consents: { privacy: { at: Date.now(), version: PRIVACY_VERSION } },
      // Benachrichtigungs-Mails nur mit ausdrücklicher Einwilligung (Häkchen ist nicht vorausgewählt)
      mailPrefs: { friends: b.mailOptIn === true, invites: b.mailOptIn === true, games: b.mailOptIn === true, account: true }, mailPrefsAt: Date.now(),
    };
    db.accounts[a.id] = a; save();
    await sendCode(a, 'verify');
    return sendJSON(res, 201, { ok: true, needsVerification: true, email: a.email, mailConfigured: smtp.enabled() });
  }
  if (p === '/api/auth/verify' && m === 'POST') {
    rateLimit(req, 'verify', 30, 600e3);
    const b = await readJSON(req);
    const a = findAccount(b.login || b.email);
    if (!a) throw new HttpError(404, 'Account nicht gefunden');
    if (!a.verified) {
      checkCode(a, b.code, 'verify'); a.verified = true; save();
      mailer.send(a, 'welcome', { username: a.username, optedIn: !!a.mailPrefs?.friends }).catch(() => {});
    }
    return sendJSON(res, 200, loginResponse(a));
  }
  if (p === '/api/auth/resend' && m === 'POST') {
    rateLimit(req, 'resend', 5, 600e3);
    const b = await readJSON(req);
    const a = findAccount(b.login || b.email);
    if (a && !a.verified) await sendCode(a, 'verify');
    return sendJSON(res, 200, { ok: true });
  }
  if (p === '/api/auth/login' && m === 'POST') {
    rateLimit(req, 'login', 20, 600e3);
    const b = await readJSON(req);
    const a = findAccount(b.login);
    if (!a || !safeEq(a.hash, hashPassword(b.password || '', a.salt))) throw new HttpError(401, 'Benutzername oder Passwort falsch');
    if (!a.verified) throw new HttpError(403, 'Bitte bestätige zuerst deine E-Mail-Adresse.', { needsVerification: true, email: a.email });
    return sendJSON(res, 200, loginResponse(a));
  }
  if (p === '/api/auth/forgot' && m === 'POST') {
    rateLimit(req, 'forgot', 5, 600e3);
    const b = await readJSON(req);
    const a = findAccount(b.login || b.email);
    if (a) await sendCode(a, 'reset');
    return sendJSON(res, 200, { ok: true }); // nicht verraten, ob es den Account gibt
  }
  if (p === '/api/auth/reset' && m === 'POST') {
    rateLimit(req, 'reset', 20, 600e3);
    const b = await readJSON(req);
    const a = findAccount(b.login || b.email);
    if (!a) throw new HttpError(400, 'Falscher Code');
    if (String(b.password || '').length < 8) throw new HttpError(400, 'Das Passwort muss mindestens 8 Zeichen haben');
    checkCode(a, b.code, 'reset');
    a.salt = rid(16); a.hash = hashPassword(b.password, a.salt); a.verified = true; a.tokenVersion = (a.tokenVersion || 0) + 1; save();
    mailer.send(a, 'passwordChanged', { username: a.username, when: berlinTime() }).catch(() => {});
    return sendJSON(res, 200, loginResponse(a));
  }
  if (p === '/api/auth/me' && m === 'GET') {
    const a = accountFromToken(req.headers['x-account'] || req.headers['x-token']);
    if (!a) throw new HttpError(401, 'Nicht angemeldet');
    return sendJSON(res, 200, { account: publicAccount(a), adminToken: isAdminAccount(a) ? makeAdminToken(a.username) : undefined, mailPrefs: mailer.prefs(a) });
  }
  throw new HttpError(404, 'Nicht gefunden');
}
// Abzeichen für bestehende Accounts nachtragen
for (const a of Object.values(db.accounts)) { a.stats = { ...emptyStats(), ...(a.stats || {}) }; checkBadges(a, null); }

function loginResponse(a) {
  return { token: makeAccountToken(a), account: publicAccount(a), adminToken: isAdminAccount(a) ? makeAdminToken(a.username) : undefined };
}

/** Punkte und Statistik auf Spieler (für dieses Spiel) und Account (Bestenliste) buchen. */
function award(pl, field, points = 0, amount = 1) {
  pl.points = (pl.points || 0) + points;
  const a = pl.accountId && db.accounts[pl.accountId];
  if (a) {
    a.stats = { ...emptyStats(), ...(a.stats || {}) };
    a.stats.points += points;
    if (field) a.stats[field] = (a.stats[field] || 0) + amount;
    social.seasonAward(a, field, points, amount);
    checkBadges(a, pl);
  }
}
/** Neue Abzeichen vergeben (einmalig, mit Meldung an den Spieler). */
function checkBadges(a, pl) {
  a.badges ||= {};
  for (const b of BADGES) {
    if (a.badges[b.key] || (a.stats[b.stat] || 0) < b.min) continue;
    a.badges[b.key] = Date.now();
    if (pl && pl.inbox) inbox(pl, `🏅 Neues Abzeichen: ${b.icon} ${b.name} – ${b.desc}`, 'reward');
  }
}

/* ------------------------------------------------------------------ */
/* Spiel-Logik                                                         */
/* ------------------------------------------------------------------ */
function newGame(name, settings, owner = null) {
  const code = newCode();
  db.games[code] = {
    code, name, status: 'lobby', createdAt: Date.now(), startedAt: null, endedAt: null,
    ownerId: owner ? owner.id : null, ownerName: owner ? owner.username : null, cohosts: [], banned: [], place: null,
    settings: sanitizeSettings(settings), players: {}, locations: [], photos: [], messages: [],
    effects: [], pickups: [], nextPickupAt: 0, chat: [], _byPid: new Map(),
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
  // Wichtige Meldungen auch als Push an alle Spieler (Browser/iPhone-Web-App)
  if (kind === 'admin' || /^(Das Spiel läuft|Spiel beendet|📦)/.test(text)) {
    for (const p of Object.values(g.players)) {
      if (p.accountId) social.notifyAccount(p.accountId, { title: kind === 'admin' ? '📣 Spielleitung' : g.name, body: cleanText(text, 200), url: `/g/${g.code}`, tag: 'game', urgent: true });
    }
  }
  if (g.messages.length > 150) g.messages.splice(0, g.messages.length - 150);
}
/** Private Meldung nur für einen Spieler (App zeigt sie als Benachrichtigung). */
function inbox(pl, text, kind = 'info') {
  pl.inbox.push({ id: rid(3), ts: Date.now(), text: cleanText(text, 200), kind });
  if (pl.accountId) {
    const title = { quest: 'Neue Quest', reward: 'Belohnung', bad: 'Achtung!', good: 'Gute Nachricht' }[kind] || 'Manhunt';
    social.notifyAccount(pl.accountId, { title, body: cleanText(text, 200), url: pl.gameCode ? `/g/${pl.gameCode}` : '/', tag: 'inbox-' + kind, urgent: kind === 'bad' });
  }
  if (pl.inbox.length > 25) pl.inbox.splice(0, pl.inbox.length - 25);
}
const runnersOf = (g) => Object.values(g.players).filter((p) => p.role === 'runner');
/** Alle, die als Runner angefangen haben (auch gefangene, die zu Huntern übergelaufen sind) */
const originalRunners = (g) => Object.values(g.players).filter((p) => p.role === 'runner' || p.converted);
const isPlaying = (p) => p.role === 'runner' || p.role === 'hunter';
const huntersOf = (g) => Object.values(g.players).filter((p) => p.role === 'hunter');
const abilityCfg = (g, k) => g.settings.abilities[k] || { enabled: false };
const usableBy = (k, role) => ABILITIES[k] && (ABILITIES[k].team === role || ABILITIES[k].team === 'any');

function giveStartAbilities(g, pl) {
  if (pl.gotStart || !g.settings.abilitiesEnabled || !isPlaying(pl)) return;
  pl.gotStart = true;
  for (const k of Object.keys(ABILITIES)) {
    const c = abilityCfg(g, k);
    if (c.enabled && c.start > 0 && usableBy(k, pl.role)) pl.abilities[k] = (pl.abilities[k] || 0) + c.start;
  }
}
function obtainableFor(g, role) {
  return Object.keys(ABILITIES).filter((k) => { const c = abilityCfg(g, k); return c.enabled && c.obtainable && usableBy(k, role); });
}
function grantRandomAbility(g, pl, why) {
  if (!g.settings.abilitiesEnabled) return null;
  const list = obtainableFor(g, pl.role);
  if (!list.length) return null;
  // Nach Seltenheit gewichtet ziehen: epische Fähigkeiten (Freeze, Radar) kommen selten
  const weights = list.map((x) => RARITY[ABILITIES[x].rarity] || RARITY.common);
  let r = Math.random() * weights.reduce((a, b) => a + b, 0);
  let k = list[list.length - 1];
  for (let i = 0; i < list.length; i++) { r -= weights[i]; if (r < 0) { k = list[i]; break; } }
  pl.abilities[k] = (pl.abilities[k] || 0) + 1;
  inbox(pl, `${ABILITIES[k].icon} Neue Fähigkeit: ${ABILITIES[k].name}${why ? ` (${why})` : ''}`, 'reward');
  return k;
}

function startGame(g) {
  if (g.status !== 'lobby') throw new HttpError(409, 'Spiel wurde schon gestartet');
  g.status = 'running'; g.startedAt = Date.now();
  g.effects = []; g.pickups = []; g.nextPickupAt = g.startedAt + 30000;
  const s = g.settings;
  for (const p of Object.values(g.players)) {
    giveStartAbilities(g, p);
    p.nextQuestAt = g.startedAt + 60000 + Math.random() * 60000; // erste Quest nach 1–2 Minuten
  }
  const hs = s.headStartMin;
  pushMsg(g, hs > 0 ? `Das Spiel läuft! Runner haben ${hs} Minuten Vorsprung.` : 'Das Spiel läuft!');
  ensurePois(g);
}
function endGame(g, reason, winner = null) {
  if (g.status === 'ended') return;
  const now = Date.now();
  g.status = 'ended'; g.endedAt = now;
  pushMsg(g, `Spiel beendet: ${reason}`);
  g.winner = winner;
  for (const p of Object.values(g.players)) {
    p.penalty = null;
    if (!isPlaying(p)) continue; // Zuschauer
    award(p, 'games', 0);
    if ((p.role === 'runner' || p.converted) && g.startedAt) {
      const min = Math.floor(((p.caught || p.converted ? p.caughtAt || now : now) - g.startedAt) / 60000);
      award(p, 'surviveMin', min * POINTS.survivePerMin, min);
    }
    // Übergelaufene zählen beim Sieg der Hunter mit
    if (winner === 'hunters' && p.role === 'hunter') award(p, 'wins', POINTS.caughtByHunterWin);
    if (winner === 'runners' && p.role === 'runner' && !p.caught) {
      award(p, 'wins', POINTS.runnerWin);
      if (!p.wasLive) award(p, 'cleanEscapes', 0);
    }
  }
  social.recordGame(g, winner);
  for (const p of Object.values(g.players)) {
    if (!isPlaying(p) || !p.accountId) continue;
    const won = (winner === 'hunters' && p.role === 'hunter') || (winner === 'runners' && p.role === 'runner' && !p.caught);
    mailer.send(db.accounts[p.accountId], 'gameResult', {
      gameName: g.name, code: g.code, reason, won, points: p.points || 0, catches: p.gameCatches || 0,
      role: p.converted ? 'Runner (dann Hunter)' : p.role === 'runner' ? 'Runner' : 'Hunter', photoDays: g.photos.length && PHOTO_RETENTION_DAYS > 0 ? PHOTO_RETENTION_DAYS : 0,
    }).catch(() => {});
  }
}
function resetGame(g) {
  g.status = 'lobby'; g.startedAt = null; g.endedAt = null;
  clearLocations(g); g.photos = []; g.messages = []; g.effects = []; g.pickups = []; g.chat = [];
  deletePhotoFiles(g.code); deleteVoiceFiles(g.code);
  for (const p of Object.values(g.players)) {
    // Übergelaufene werden wieder Runner
    if (p.converted) p.role = 'runner';
    Object.assign(p, { gameCatches: 0, caught: false, caughtAt: null, caughtBy: null, converted: false, wasLive: false, lastLoc: null, abilities: {}, cooldowns: {}, quests: [], inbox: [], penalty: null, photoOrder: null, points: 0, gotStart: false, jokers: [], flags: {} });
  }
}
const chatLast = new Map();
function chatGate(pl) {
  const last = chatLast.get(pl.id) || 0;
  if (Date.now() - last < 1500) throw new HttpError(429, 'Nicht so schnell');
  chatLast.set(pl.id, Date.now());
}
/** channel: 'team' (nur das eigene Team) oder 'all' (alle im Spiel) */
function pushChat(g, pl, msg, channel = 'team') {
  g.chat.push({ id: rid(4), ts: Date.now(), pid: pl.id, name: pl.name, team: pl.role, channel, text: msg.text || '', voice: msg.voice || null });
  if (g.chat.length > 300) {
    for (const c of g.chat.splice(0, g.chat.length - 300)) if (c.voice) fs.unlink(path.join(VOICE_DIR, `${g.code}_${c.voice.id}.${c.voice.ext}`), () => {});
  }
  award(pl, 'chats', 0);
  for (const p of Object.values(g.players)) {
    if (p.id !== pl.id && (channel === 'all' || p.role === pl.role) && p.accountId) {
      social.notifyAccount(p.accountId, { title: `💬 ${channel === 'all' ? '[Alle] ' : ''}${pl.name}`, body: msg.voice ? '🎙️ Sprachnachricht' : cleanText(msg.text, 120), url: `/g/${g.code}`, tag: 'chat' });
    }
  }
}
/** Kanal prüfen. Zuschauer dürfen im Chat für alle nur mitlesen (sonst könnten sie Positionen verraten). */
function chatChannel(g, pl, requested) {
  if (requested !== 'all') return 'team';
  if (!g.settings.allChatEnabled) throw new HttpError(409, 'Der Chat für alle ist in diesem Spiel aus');
  if (!isPlaying(pl)) throw new HttpError(403, 'Zuschauer können im Chat für alle nur mitlesen');
  return 'all';
}
function deleteVoiceFiles(code) {
  try { for (const f of fs.readdirSync(VOICE_DIR)) if (f.startsWith(code + '_')) fs.unlinkSync(path.join(VOICE_DIR, f)); } catch { /* egal */ }
}
/** Fotos und Sprachnachrichten einer Runde löschen, Ergebnis und Verlauf bleiben */
function purgeGameMedia(g) {
  deletePhotoFiles(g.code); deleteVoiceFiles(g.code);
  g.photos = []; for (const c of g.chat) if (c.voice) { c.voice = null; c.text ||= '🎙️ (gelöscht)'; }
  g.quotaFullAt = null;
  db.reports = (db.reports || []).filter((r) => !(r.code === g.code && r.kind === 'photo'));
}
function deletePhotoFiles(code) {
  try {
    for (const f of fs.readdirSync(PHOTO_DIR)) if (f.startsWith(code + '_')) fs.unlinkSync(path.join(PHOTO_DIR, f));
  } catch { /* ignore */ }
}
function checkAllCaught(g) {
  if (g.status !== 'running' || !g.settings.caughtEnabled || !g.settings.autoEndWhenAllCaught) return;
  const runners = originalRunners(g);
  if (runners.length && runners.every((p) => p.caught || p.converted)) endGame(g, 'Alle Runner wurden gefangen. Die Hunter gewinnen!', 'hunters');
}
function setCaught(g, target, value, by) {
  const s = g.settings;
  const isCaught = target.caught || target.converted;
  if (isCaught === value) return;
  if (value) {
    target.caught = true; target.caughtAt = Date.now(); target.penalty = null; target.photoOrder = null;
    target.quests = target.quests.filter((q) => q.status !== 'active');
    award(target, 'caught', 0);
    if (by && by.role === 'hunter') {
      target.caughtBy = by.id;
      by.gameCatches = (by.gameCatches || 0) + 1;
      award(by, 'catches', POINTS.catch);
      if (by.converted) award(by, 'revenge', 0);
      completeQuestsOfKind(g, by, 'catch');
    }
    if (s.caughtBecomeHunter && g.status === 'running') {
      // Seitenwechsel: Runner-Fähigkeiten weg, Hunter-Startausstattung dazu
      target.converted = true; target.caught = false; target.role = 'hunter';
      target.abilities = {}; target.cooldowns = {}; target.gotStart = false;
      giveStartAbilities(g, target);
      target.nextQuestAt = Date.now() + 60000;
      inbox(target, '🔄 Du wurdest gefangen und jagst jetzt als Hunter mit!', 'bad');
      pushMsg(g, `${target.name} wurde gefangen und ist jetzt Hunter!`);
    } else {
      pushMsg(g, `${target.name} wurde gefangen!`);
    }
  } else {
    // Rückgängig: Punkte des Fängers wieder abziehen, ggf. zurück ins Runner-Team
    const by2 = target.caughtBy && g.players[target.caughtBy];
    if (by2) award(by2, 'catches', -POINTS.catch, -1);
    if (target.converted) {
      target.converted = false; target.role = 'runner'; target.abilities = {}; target.cooldowns = {}; target.gotStart = false;
      giveStartAbilities(g, target);
      target.quests = target.quests.filter((q) => q.status !== 'active');
    }
    target.caught = false; target.caughtBy = null; target.caughtAt = null;
    pushMsg(g, `${target.name} ist wieder als Runner im Spiel.`);
  }
  checkAllCaught(g);
}

/* ---------------- Fähigkeiten ---------------- */
const activeEffects = (g, now = Date.now()) => g.effects.filter((e) => e.until > now);
const hasEffect = (g, key, pid, now) => activeEffects(g, now).some((e) => e.key === key && e.targets.includes(pid));
const effectOn = (g, key, pid, now) => activeEffects(g, now).find((e) => e.key === key && e.targets.includes(pid));
const shielded = (g, pid, now) => hasEffect(g, 'shield', pid, now);
const frozenUntil = (g, pid, now) => Math.max(0, ...activeEffects(g, now).filter((e) => e.key === 'freeze' && e.targets.includes(pid)).map((e) => e.until));
const released = (g, now = Date.now()) => g.status === 'ended' || (g.status === 'running' && now >= g.startedAt + g.settings.headStartMin * 60000);

function addEffect(g, key, by, targets, durSec, data) {
  const now = Date.now();
  const e = { id: rid(4), key, by: by.id, byName: by.name, team: by.role, at: now, until: now + durSec * 1000, targets, data: data || null };
  g.effects.push(e);
  if (g.effects.length > 200) g.effects.splice(0, g.effects.length - 200);
  return e;
}

function useAbility(g, pl, key, targetId) {
  const now = Date.now();
  const def = ABILITIES[key];
  if (!def) throw new HttpError(404, 'Unbekannte Fähigkeit');
  if (!g.settings.abilitiesEnabled || !abilityCfg(g, key).enabled) throw new HttpError(409, 'Diese Fähigkeit ist in diesem Spiel ausgeschaltet');
  if (g.status !== 'running') throw new HttpError(409, 'Das Spiel läuft gerade nicht');
  if (!usableBy(key, pl.role)) throw new HttpError(403, 'Diese Fähigkeit ist nicht für dein Team');
  if (pl.caught) throw new HttpError(409, 'Du bist gefangen');
  if (!(pl.abilities[key] > 0)) throw new HttpError(409, 'Du hast diese Fähigkeit nicht (mehr)');
  const cdUntil = (pl.cooldowns || {})[key] || 0;
  if (cdUntil > now) throw new HttpError(409, `Noch ${Math.ceil((cdUntil - now) / 1000)} s Abklingzeit`, { cooldownUntil: cdUntil });
  if (pl.role === 'hunter' && frozenUntil(g, pl.id, now) > now && !['thaw', 'shield'].includes(key)) throw new HttpError(409, 'Du bist eingefroren');
  if (pl.role === 'hunter' && !released(g, now) && !['shield', 'thaw'].includes(key)) throw new HttpError(409, 'Erst nach dem Vorsprung der Runner');
  const dur = abilityCfg(g, key).durationSec || def.durationSec;
  const enemies = (pl.role === 'runner' ? huntersOf(g) : runnersOf(g)).filter((p) => !p.caught);
  const unshieldedEnemies = enemies.filter((p) => !shielded(g, p.id, now));
  let msg = null;

  switch (key) {
    case 'freeze': {
      // Kein Dauer-Freeze: wer gerade eingefroren ist oder es eben war, ist eine Weile immun
      const immune = (h) => g.effects.some((e) => e.key === 'freeze' && e.targets.includes(h.id) && (e.until > now || (e.data && e.data.immuneUntil > now)));
      const targets = unshieldedEnemies.filter((h) => !immune(h));
      if (!targets.length) throw new HttpError(409, unshieldedEnemies.length ? 'Die Hunter sind gerade noch immun gegen Freeze' : 'Alle Hunter sind gerade geschützt');
      const t = targets.map((p) => p.id);
      addEffect(g, key, pl, t, dur, { immuneUntil: now + (dur + g.settings.freezeImmunitySec) * 1000 });
      award(pl, 'freezes', 0);
      for (const p of targets) inbox(p, `🧊 Du bist ${Math.round(dur / 60 * 10) / 10} Minuten eingefroren!`, 'bad');
      msg = `🧊 Ein Runner hat die Hunter eingefroren!`;
      break;
    }
    case 'cloak': case 'fog': case 'shield':
      addEffect(g, key, pl, [pl.id], dur);
      break;
    case 'decoy': {
      const base = pl.lastLoc;
      if (!base) throw new HttpError(409, 'Erst braucht der Server deine Position');
      const [la, ln] = offset(base.lat, base.lng, 300 + Math.random() * 300, Math.random() * 360);
      addEffect(g, key, pl, [pl.id], dur, { lat: la, lng: ln });
      break;
    }
    case 'photoJoker':
      if (!g.settings.photosEnabled) throw new HttpError(409, 'Fotos sind in diesem Spiel aus');
      pl.jokers.push(now);
      if (pl.penalty && pl.penalty.reason === 'photo') { pl.penalty = null; inbox(pl, 'Live-Standort beendet.', 'good'); }
      if (pl.photoOrder) pl.photoOrder = null;
      if (pl.penalty && pl.penalty.reason === 'order') pl.penalty = null;
      break;
    case 'rescue': {
      const t = g.players[targetId];
      if (!t || !(t.converted || (t.role === 'runner' && t.caught))) throw new HttpError(400, 'Bitte einen gefangenen Runner auswählen');
      setCaught(g, t, false, null);
      inbox(t, `🔓 ${pl.name} hat dich befreit!`, 'good');
      msg = `🔓 ${pl.name} hat ${t.name} befreit!`;
      break;
    }
    case 'radar': {
      if (activeEffects(g, now).some((e) => e.key === 'radar')) throw new HttpError(409, 'Das Radar läuft schon');
      const t = unshieldedEnemies.map((p) => p.id);
      if (!t.length) throw new HttpError(409, 'Alle Runner sind gerade geschützt');
      addEffect(g, key, pl, t, dur);
      award(pl, 'radars', 0);
      for (const p of unshieldedEnemies) p.wasLive = true;
      for (const p of unshieldedEnemies) inbox(p, '📡 Radar! Dein Standort ist jetzt live für die Hunter sichtbar.', 'bad');
      msg = `📡 ${pl.name} hat das Radar eingeschaltet – alle Runner sind live sichtbar!`;
      break;
    }
    case 'ping': {
      const me = pl.lastLoc;
      const cand = unshieldedEnemies.filter((p) => p.lastLoc);
      if (!cand.length) throw new HttpError(409, 'Kein Runner kann gerade angepeilt werden');
      const t = me ? cand.reduce((a, b) => (haversine(me.lat, me.lng, a.lastLoc.lat, a.lastLoc.lng) <= haversine(me.lat, me.lng, b.lastLoc.lat, b.lastLoc.lng) ? a : b)) : pick(cand);
      addEffect(g, key, pl, [t.id], dur);
      t.wasLive = true;
      inbox(t, '🎯 Du wurdest angepeilt! Dein Standort ist eine Minute lang live.', 'bad');
      for (const h of huntersOf(g)) inbox(h, `🎯 ${pl.name} peilt ${t.name} an.`, 'info');
      break;
    }
    case 'photoOrder': {
      if (!g.settings.photosEnabled) throw new HttpError(409, 'Fotos sind in diesem Spiel aus');
      if (!unshieldedEnemies.length) throw new HttpError(409, 'Alle Runner sind gerade geschützt');
      addEffect(g, key, pl, unshieldedEnemies.map((p) => p.id), dur);
      for (const p of unshieldedEnemies) {
        p.photoOrder = { at: now, due: now + dur * 1000 };
        inbox(p, `📸 Fotobefehl! Lade innerhalb von ${Math.round(dur / 60 * 10) / 10} Minuten ein Foto hoch, sonst bist du live.`, 'bad');
      }
      msg = `📸 Fotobefehl: Alle Runner müssen jetzt ein Foto schicken!`;
      break;
    }
    case 'tracker':
      addEffect(g, key, pl, runnersOf(g).filter((p) => !shielded(g, p.id, now)).map((p) => p.id), dur);
      for (const h of huntersOf(g)) if (h.id !== pl.id) inbox(h, `🐾 ${pl.name} hat den Spurenleser aktiviert.`, 'info');
      break;
    case 'thaw': {
      const fr = activeEffects(g, now).filter((e) => e.key === 'freeze');
      if (!fr.length) throw new HttpError(409, 'Gerade ist niemand eingefroren');
      for (const e of fr) e.until = now;
      msg = `🔥 ${pl.name} hat den Freeze gebrochen!`;
      break;
    }
    default: throw new HttpError(404, 'Unbekannte Fähigkeit');
  }
  pl.abilities[key]--;
  if (pl.abilities[key] <= 0) delete pl.abilities[key];
  const cd = abilityCfg(g, key).cooldownSec ?? def.cooldownSec ?? 0;
  if (cd > 0) { pl.cooldowns ||= {}; pl.cooldowns[key] = now + cd * 1000; }
  award(pl, 'abilities', POINTS.abilityUsed);
  if (msg) pushMsg(g, msg);
}

/* ---------------- Foto-Runden und Live-Strafe ---------------- */
function roundOf(g, t) { return Math.floor((t - g.startedAt) / (g.settings.photoIntervalMin * 60000)); }
function hasCreditInRound(g, pl, slot) {
  const iv = g.settings.photoIntervalMin * 60000, rs = g.startedAt + slot * iv, re = rs + iv;
  return g.photos.some((ph) => ph.pid === pl.id && ph.ts >= rs && ph.ts < re) || pl.jokers.some((t) => t >= rs && t < re);
}
/** Nach einem Foto/Joker zum Zeitpunkt t prüfen, ob die Live-Strafe endet. */
function photoCredited(g, pl, t) {
  if (pl.photoOrder && t >= pl.photoOrder.at) pl.photoOrder = null;
  const pen = pl.penalty;
  if (!pen) return;
  if (pen.reason === 'order' || g.settings.livePenaltyUntil === 'upload' || roundOf(g, t) > pen.round) {
    pl.penalty = null;
    inbox(pl, '✅ Foto angekommen – dein Standort ist nicht mehr live.', 'good');
  }
}
function updatePenalties(g, now) {
  const s = g.settings;
  let changed = false;
  for (const pl of runnersOf(g)) {
    if (pl.caught) { if (pl.penalty) { pl.penalty = null; changed = true; } continue; }
    // Fotobefehl verpasst
    if (pl.photoOrder && now > pl.photoOrder.due) {
      pl.photoOrder = null;
      if (s.livePenaltyEnabled && !pl.penalty) {
        pl.penalty = { reason: 'order', since: now, round: roundOf(g, now) }; pl.wasLive = true;
        inbox(pl, '⚠️ Fotobefehl verpasst – dein Standort ist live, bis du ein Foto hochlädst.', 'bad');
        pushMsg(g, `📸 ${pl.name} hat den Fotobefehl verpasst – Standort ist live!`); changed = true;
      }
    }
    if (!s.photosEnabled || !s.livePenaltyEnabled) continue;
    const slot = roundOf(g, now);
    if (slot < 1) continue;
    const rs = g.startedAt + slot * s.photoIntervalMin * 60000;
    if (now < rs + s.photoGraceSec * 1000 || hasCreditInRound(g, pl, slot)) continue;
    if (!pl.penalty) {
      pl.penalty = { reason: 'photo', since: now, round: slot }; pl.wasLive = true;
      inbox(pl, s.livePenaltyUntil === 'upload'
        ? '⚠️ Foto zu spät – dein Standort ist live, bis du ein Foto hochlädst.'
        : '⚠️ Foto zu spät – dein Standort ist live, bis du in der nächsten Runde ein Foto hochlädst.', 'bad');
      pushMsg(g, `📸 ${pl.name} hat kein Foto geschickt – Standort ist jetzt live!`);
      changed = true;
    } else if (pl.penalty.reason === 'photo' && pl.penalty.round < slot) {
      pl.penalty.round = slot; changed = true;
    }
  }
  return changed;
}
/** Warum ist ein Runner gerade live (exakt, alle paar Sekunden)? */
function liveReason(g, pl, now) {
  if (g.status !== 'running' || pl.role !== 'runner' || pl.caught) return null;
  if (pl.penalty) return { reason: pl.penalty.reason, until: null };
  const r = effectOn(g, 'radar', pl.id, now) || effectOn(g, 'ping', pl.id, now);
  return r ? { reason: r.key, until: r.until } : null;
}

/* ---------------- Quests ---------------- */
/** Eingebaute oder eigene Quest (Schlüssel "c_<id>") als einheitliche Definition. */
function questDef(g, key) {
  if (QUESTS[key]) return QUESTS[key];
  const c = key.startsWith('c_') && (g.settings.customQuests || []).find((x) => 'c_' + x.id === key);
  if (!c) return { team: 'none', kind: 'gone', icon: '❓', title: 'Quest', desc: '', minutes: 10, points: 0 };
  return { team: c.team, kind: c.kind === 'place' ? 'fixed' : 'photo', icon: c.icon || '⭐', title: c.title, desc: c.desc, minutes: c.minutes, points: c.points, custom: c };
}
const questTitle = (g, key) => questDef(g, key).title;
const questCfg = (g, k) => {
  const c = k.startsWith('c_') && (g.settings.customQuests || []).find((x) => 'c_' + x.id === k);
  if (c) return { enabled: c.enabled, minutes: c.minutes, points: c.points, reward: c.reward };
  return g.settings.quests[k] || { enabled: false };
};
const allQuestKeys = (g) => [...Object.keys(QUESTS), ...(g.settings.customQuests || []).map((c) => 'c_' + c.id)];
function questFeasible(g, pl, key) {
  const q = questDef(g, key), s = g.settings;
  if (q.team !== pl.role && !(q.team === 'any' && isPlaying(pl))) return false;
  if (!questCfg(g, key).enabled) return false;
  switch (q.kind) {
    case 'edge': return s.zoneEnabled && !!pl.lastLoc;
    case 'checkpoint': case 'distance': case 'still': return !!pl.lastLoc;
    case 'poi': return !!(pl.lastLoc && nearestPoi(g, pl.lastLoc, 1500));
    case 'pickup': return s.pickupsEnabled && s.pickupMax > 0;
    case 'pincer': return huntersOf(g).length >= 2;
    case 'dare': return huntersOf(g).length >= 1 && !!pl.lastLoc;
    case 'near': case 'catch': return runnersOf(g).some((r) => !r.caught);
    case 'photo': return true;
    case 'fixed': return true;
    default: return false;
  }
}
function nearestPoi(g, loc, maxM) {
  const list = (g.pois && g.pois.list) || [];
  let best = null, bd = Infinity;
  for (const p of list) {
    const d = haversine(loc.lat, loc.lng, p.lat, p.lng);
    if (d < bd && d <= maxM && d > 80) { best = p; bd = d; }
  }
  return best;
}
function pointInZone(g, lat, lng) {
  const s = g.settings;
  return !s.zoneEnabled || haversine(lat, lng, s.zoneLat, s.zoneLng) <= s.zoneRadiusM * 0.92;
}
function assignQuest(g, pl, now) {
  const recent = new Set(pl.quests.slice(-4).map((q) => q.key));
  let keys = allQuestKeys(g).filter((k) => questFeasible(g, pl, k));
  if (!keys.length) return;
  const fresh = keys.filter((k) => !recent.has(k));
  if (fresh.length) keys = fresh;
  const key = pick(keys), def = questDef(g, key), cfg = questCfg(g, key);
  const q = { id: rid(4), key, start: now, until: now + cfg.minutes * 60000, status: 'active', target: null, progress: null };
  if (def.kind === 'checkpoint') {
    let pt = null;
    for (let i = 0; i < 25 && !pt; i++) {
      const [la, ln] = randomPointAround(pl.lastLoc.lat, pl.lastLoc.lng, def.minM, def.maxM);
      if (pointInZone(g, la, ln)) pt = [la, ln];
    }
    if (!pt) pt = randomPointAround(pl.lastLoc.lat, pl.lastLoc.lng, def.minM * 0.5, def.minM);
    q.target = { lat: pt[0], lng: pt[1], name: def.title, radiusM: 40 };
  } else if (def.kind === 'poi') {
    const p = nearestPoi(g, pl.lastLoc, 1500);
    q.target = { lat: p.lat, lng: p.lng, name: p.name, radiusM: 60 };
  } else if (def.kind === 'fixed') {
    const c = def.custom;
    q.target = { lat: c.lat, lng: c.lng, name: c.placeName || c.title, radiusM: c.radiusM };
  }
  pl.quests.push(q);
  if (pl.quests.length > 30) pl.quests.splice(0, pl.quests.length - 30);
  inbox(pl, `${def.icon} Neue Quest: ${def.title} – ${def.desc}`, 'quest');
}
function completeQuest(g, pl, q) {
  if (q.status !== 'active') return;
  const def = questDef(g, q.key), cfg = questCfg(g, q.key);
  q.status = 'done'; q.doneAt = Date.now(); q.pointsAwarded = cfg.points;
  award(pl, 'quests', cfg.points);
  let got = null;
  if (cfg.reward === 'random') got = grantRandomAbility(g, pl);
  else if (cfg.reward !== 'none' && ABILITIES[cfg.reward] && abilityCfg(g, cfg.reward).enabled && usableBy(cfg.reward, pl.role)) {
    pl.abilities[cfg.reward] = (pl.abilities[cfg.reward] || 0) + 1; got = cfg.reward;
  }
  q.rewardKey = got;
  inbox(pl, `🏆 Quest geschafft: ${def.title} (+${cfg.points} Punkte${got ? `, ${ABILITIES[got].icon} ${ABILITIES[got].name}` : ''})`, 'reward');
}
function completeQuestsOfKind(g, pl, kind) {
  for (const q of pl.quests) if (q.status === 'active' && questDef(g, q.key).kind === kind) completeQuest(g, pl, q);
}
const fresh = (loc, now, ms = 180000) => loc && now - loc.ts < ms;
function checkQuests(g, pl, now) {
  let changed = false;
  for (const q of pl.quests) {
    if (q.status !== 'active') continue;
    if (now > q.until) { q.status = 'failed'; inbox(pl, `⌛ Quest verpasst: ${questTitle(g, q.key)}`, 'info'); changed = true; continue; }
    const def = questDef(g, q.key);
    const me = pl.lastLoc;
    let ok = false;
    switch (def.kind) {
      case 'checkpoint': case 'poi': case 'fixed':
        ok = me && me.ts >= q.start && haversine(me.lat, me.lng, q.target.lat, q.target.lng) <= q.target.radiusM + Math.min(me.acc || 0, 30);
        break;
      case 'distance': {
        // wird in acceptLocation schrittweise mitgezählt (q.dist)
        q.progress = Math.round(q.dist || 0);
        ok = (q.dist || 0) >= def.meters;
        break;
      }
      case 'still': {
        // Nur die eigenen Positionen seit Quest-Start, rückwärts bis zur ersten Bewegung
        const mine = locsOf(g, pl.id);
        if (mine.length >= 2 && mine[mine.length - 1].ts >= q.start) {
          const last = mine[mine.length - 1];
          let first = last;
          for (let i = mine.length - 1; i >= 0 && mine[i].ts >= q.start; i--) {
            if (haversine(mine[i].lat, mine[i].lng, last.lat, last.lng) > def.radiusM) break;
            first = mine[i];
          }
          q.progress = Math.round((last.ts - first.ts) / 1000);
          ok = last.ts - first.ts >= def.holdMin * 60000 && fresh(last, now, 120000);
        }
        break;
      }
      case 'dare':
        ok = fresh(me, now) && huntersOf(g).some((h) => fresh(h.lastLoc, now) && haversine(me.lat, me.lng, h.lastLoc.lat, h.lastLoc.lng) <= def.meters);
        break;
      case 'near':
        ok = fresh(me, now) && runnersOf(g).some((r) => !r.caught && fresh(r.lastLoc, now) && haversine(me.lat, me.lng, r.lastLoc.lat, r.lastLoc.lng) <= def.meters);
        break;
      case 'pincer':
        ok = fresh(me, now) && runnersOf(g).some((r) => {
          if (r.caught || !fresh(r.lastLoc, now)) return false;
          if (haversine(me.lat, me.lng, r.lastLoc.lat, r.lastLoc.lng) > def.meters) return false;
          return huntersOf(g).some((h) => h.id !== pl.id && fresh(h.lastLoc, now) && haversine(h.lastLoc.lat, h.lastLoc.lng, r.lastLoc.lat, r.lastLoc.lng) <= def.meters);
        });
        break;
      case 'edge': {
        const s = g.settings;
        if (me && me.ts >= q.start) {
          const d = haversine(me.lat, me.lng, s.zoneLat, s.zoneLng);
          ok = d >= s.zoneRadiusM - def.meters && d <= s.zoneRadiusM + 15;
        }
        break;
      }
      default: break; // photo, catch, pickup werden direkt beim Ereignis erledigt
    }
    if (ok) { completeQuest(g, pl, q); changed = true; }
  }
  // Erledigte/verpasste Quests nach einer Weile ausblenden
  const before = pl.quests.length;
  pl.quests = pl.quests.filter((q) => q.status === 'active' || now - (q.doneAt || q.until) < 10 * 60000);
  return changed || before !== pl.quests.length;
}
function updateQuests(g, now) {
  if (!g.settings.questsEnabled) return false;
  let changed = false;
  for (const pl of Object.values(g.players)) {
    if (pl.caught || !isPlaying(pl)) continue;
    if (checkQuests(g, pl, now)) changed = true;
    const active = pl.quests.filter((q) => q.status === 'active').length;
    if (active < g.settings.questMaxActive && now >= (pl.nextQuestAt || 0) && (pl.role === 'runner' || released(g, now))) {
      pl.nextQuestAt = now + g.settings.questIntervalMin * 60000;
      const n = pl.quests.length;
      assignQuest(g, pl, now);
      if (pl.quests.length !== n) changed = true;
    }
  }
  return changed;
}

/* ---------------- Pickups (Fähigkeiten zum Einsammeln) ---------------- */
function gameCenter(g) {
  const s = g.settings;
  if (s.zoneEnabled) return { lat: s.zoneLat, lng: s.zoneLng, r: Math.min(s.pickupSearchM, s.zoneRadiusM) };
  const locs = Object.values(g.players).map((p) => p.lastLoc).filter(Boolean);
  if (!locs.length) return null;
  return { lat: locs.reduce((a, l) => a + l.lat, 0) / locs.length, lng: locs.reduce((a, l) => a + l.lng, 0) / locs.length, r: s.pickupSearchM };
}
async function ensurePois(g) {
  const c = gameCenter(g);
  if (!c || g._poiLoading) return;
  if (g.pois && Date.now() - g.pois.ts < 3600e3 && haversine(g.pois.lat, g.pois.lng, c.lat, c.lng) < 1000) return;
  g._poiLoading = true;
  try {
    const list = await fetchPois(c.lat, c.lng, c.r + 1500);
    g.pois = { ts: Date.now(), lat: c.lat, lng: c.lng, list };
  } finally { g._poiLoading = false; }
}
function spawnPickup(g, now) {
  const s = g.settings;
  const c = gameCenter(g);
  if (!c) return false;
  const active = g.pickups.filter((p) => !p.takenBy && p.until > now);
  if (active.filter((p) => !p.drop).length >= s.pickupMax) return false;
  const spacing = Math.max(1000, s.pickupSpacingM);
  const free = (lat, lng) => active.every((p) => haversine(p.lat, p.lng, lat, lng) >= spacing);
  const inArea = (lat, lng) => haversine(lat, lng, c.lat, c.lng) <= c.r && pointInZone(g, lat, lng);
  const pois = ((g.pois && g.pois.list) || []).filter((p) => inArea(p.lat, p.lng) && free(p.lat, p.lng));
  let spot = null;
  if (pois.length) { const p = pick(pois); spot = { lat: p.lat, lng: p.lng, name: p.name, kind: p.kind }; }
  else if (s.pickupRandomFallback) {
    for (let i = 0; i < 40 && !spot; i++) {
      const [la, ln] = randomPointAround(c.lat, c.lng, 0, c.r);
      if (inArea(la, ln) && free(la, ln)) spot = { lat: la, lng: ln, name: 'Versorgungskiste', kind: 'Kiste' };
    }
  }
  if (!spot) return false;
  g.pickups.push({ id: rid(4), ...spot, at: now, until: now + s.pickupLifetimeMin * 60000, takenBy: null });
  if (g.pickups.length > 100) g.pickups.splice(0, g.pickups.length - 100);
  return true;
}
/* ---------------- Versorgungsabwürfe (optional) ---------------- */
function updateDrops(g, now) {
  const s = g.settings;
  let changed = false;
  if (!g.nextDropAt) g.nextDropAt = (g.startedAt || now) + s.supplyDropIntervalMin * 60000;
  if (now >= g.nextDropAt) {
    g.nextDropAt = now + s.supplyDropIntervalMin * 60000;
    ensurePois(g).then(() => { if (g.status === 'running' && spawnDrop(g, Date.now())) { save(); notify(g.code); } }).catch(() => {});
  }
  for (const pu of g.pickups) {
    if (pu.drop && !pu.landed && !pu.takenBy && pu.activeAt <= now) {
      pu.landed = true; changed = true;
      pushMsg(g, `📦 Der Versorgungsabwurf bei „${pu.name}“ ist gelandet – wer zuerst da ist, bekommt ${s.supplyDropAbilities} Fähigkeiten!`);
    }
  }
  return changed;
}
function spawnDrop(g, now) {
  const s = g.settings;
  const c = gameCenter(g);
  if (!c) return false;
  const active = g.pickups.filter((p) => !p.takenBy && p.until > now);
  const free = (lat, lng) => active.every((p) => haversine(p.lat, p.lng, lat, lng) >= Math.max(1000, s.pickupSpacingM));
  const inArea = (lat, lng) => haversine(lat, lng, c.lat, c.lng) <= c.r && pointInZone(g, lat, lng);
  // Bevorzugt offene Plätze wie Märkte und Bahnhöfe – da treffen sich beide Teams
  const pois = ((g.pois && g.pois.list) || []).filter((p) => inArea(p.lat, p.lng));
  const good = pois.filter((p) => free(p.lat, p.lng));
  const pref = good.filter((p) => ['Markt', 'Bahnhof', 'Busbahnhof', 'Stadion'].includes(p.kind));
  let spot = null;
  const src = pref.length ? pref : good.length ? good : [];
  if (src.length) { const p = pick(src); spot = { lat: p.lat, lng: p.lng, name: p.name }; }
  for (let i = 0; i < 40 && !spot; i++) {
    const [la, ln] = randomPointAround(c.lat, c.lng, 0, c.r * 0.8);
    if (inArea(la, ln) && free(la, ln)) spot = { lat: la, lng: ln, name: 'Abwurfzone' };
  }
  if (!spot) { const [la, ln] = randomPointAround(c.lat, c.lng, 0, c.r * 0.5); spot = { lat: la, lng: ln, name: 'Abwurfzone' }; }
  const activeAt = now + s.supplyDropWarnMin * 60000;
  g.pickups.push({ id: rid(4), ...spot, kind: 'Abwurf', drop: true, landed: s.supplyDropWarnMin === 0, at: now, activeAt, until: activeAt + Math.max(15, s.pickupLifetimeMin) * 60000, takenBy: null });
  pushMsg(g, s.supplyDropWarnMin > 0
    ? `📦 Versorgungsabwurf in ${s.supplyDropWarnMin} Minuten bei „${spot.name}“ – mit ${s.supplyDropAbilities} Fähigkeiten!`
    : `📦 Versorgungsabwurf bei „${spot.name}“ – mit ${s.supplyDropAbilities} Fähigkeiten!`);
  return true;
}
function updatePickups(g, now) {
  const s = g.settings;
  let changed = false;
  const before = g.pickups.length;
  g.pickups = g.pickups.filter((p) => (p.takenBy ? now - p.takenAt < 60000 : p.until > now));
  if (g.pickups.length !== before) changed = true;
  if (s.supplyDropsEnabled && s.abilitiesEnabled && updateDrops(g, now)) changed = true;
  if (!s.pickupsEnabled || !s.abilitiesEnabled || s.pickupMax === 0) return changed;
  if (now >= (g.nextPickupAt || 0)) {
    g.nextPickupAt = now + s.pickupIntervalMin * 60000;
    ensurePois(g).then(() => { if (g.status === 'running' && spawnPickup(g, Date.now())) { save(); notify(g.code); } }).catch(() => {});
  }
  return changed;
}

/* ---------------- Takt: alle 5 Sekunden ---------------- */
setInterval(() => {
  const now = Date.now();
  for (const g of Object.values(db.games)) {
    if (g.status !== 'running') continue;
    let changed = false;
    if (g.settings.autoEndAfterMin > 0 && now >= g.startedAt + g.settings.autoEndAfterMin * 60000) {
      endGame(g, 'Die Zeit ist um. Die Runner gewinnen!', 'runners'); save(); notify(g.code); continue;
    }
    if (now >= g.startedAt + MAX_GAME_HOURS * 3600e3) {
      endGame(g, `Die Runde lief länger als ${MAX_GAME_HOURS} Stunden und wurde automatisch beendet.`); save(); notify(g.code); continue;
    }
    // abgelaufene Effekte melden
    for (const e of g.effects) {
      if (!e.done && e.until <= now) {
        e.done = true; changed = true;
        if (e.key === 'freeze') for (const id of e.targets) { const p = g.players[id]; if (p) inbox(p, '🧊 Freeze vorbei – du kannst wieder jagen!', 'good'); }
        if (e.key === 'radar') pushMsg(g, '📡 Radar aus.');
      }
    }
    g.effects = g.effects.filter((e) => now - e.until < 600000);
    if (updatePenalties(g, now)) changed = true;
    if (updateQuests(g, now)) changed = true;
    if (updatePickups(g, now)) changed = true;
    if (!released(g, now - TICK_MS) && released(g, now)) changed = true; // Vorsprung gerade vorbei
    if (changed) { save(); notify(g.code); }
  }
}, TICK_MS).unref();

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
  const isReleased = released(g, now);
  const viewerFrozen = viewer && viewer.role === 'hunter' && g.status === 'running' ? frozenUntil(g, viewer.id, now) : 0;
  // Zuschauer sehen alles exakt, aber zeitverzögert – so können sie Mitspielern nichts Aktuelles verraten
  const isSpectator = viewerRole === 'spectator';
  const spectatorCut = isSpectator && !ended ? now - s.spectatorDelaySec * 1000 : 0;
  const overview = isAdmin || isSpectator; // Rundumsicht wie die Spielleitung

  const canSee = (t) => {
    if (!isPlaying(t) && !(viewer && t.id === viewer.id)) return false; // andere Zuschauer haben keine Position
    if (ended || overview || (viewer && t.id === viewer.id)) return true;
    if (!active) return false;
    if (viewerRole === 'hunter') {
      if (t.role !== 'runner') return s.huntersVisibleToHunters;
      if (viewerFrozen > now) return false;
      if (!isReleased) return false;
      if (!liveReason(g, t, now) && hasEffect(g, 'cloak', t.id, now)) return false;
      return true;
    }
    return t.role === 'runner' ? s.runnersVisibleToRunners : s.huntersVisibleToRunners;
  };

  const photosBy = {}; for (const ph of g.photos) (photosBy[ph.pid] ||= []).push(ph);

  const players = Object.values(g.players).map((t) => {
    const vis = canSee(t);
    let pts = vis ? locsOf(g, t.id) : [];
    if (spectatorCut) pts = pts.filter((l) => l.ts <= spectatorCut); // Zuschauer sehen alles verzögert
    const hunterView = !ended && viewerRole === 'hunter' && t.role === 'runner';
    const live = liveReason(g, t, now);
    const decoy = hunterView && !live ? effectOn(g, 'decoy', t.id, now) : null;
    let fuzzM = 0;
    if (hunterView && !live) fuzzM = s.fuzzMeters + (hasEffect(g, 'fog', t.id, now) ? 400 : 0);
    const conv = (l) => (fuzzM > 0 ? fuzzPoint(`${t.id}:${l.ts}`, l.lat, l.lng, fuzzM) : [l.lat, l.lng]);
    let loc = null, trail = [], outside = false;
    if (pts.length) {
      const last = pts[pts.length - 1];
      if (decoy) {
        loc = { lat: decoy.data.lat, lng: decoy.data.lng, acc: Math.max(20, s.fuzzMeters), ts: last.ts };
      } else {
        const [la, ln] = conv(last);
        loc = { lat: la, lng: ln, acc: fuzzM > 0 ? Math.max(last.acc, fuzzM) : last.acc, ts: last.ts };
        const tracked = hunterView && hasEffect(g, 'tracker', t.id, now);
        if (s.showTrail || ended || tracked || overview) {
          trail = (tracked || ended || overview ? pts.slice(-1500) : pts.slice(-300)).map((l) => {
            const [a, b] = tracked ? [l.lat, l.lng] : conv(l); return [a, b, l.ts];
          });
        }
      }
      if (s.zoneEnabled && t.role === 'runner') outside = haversine(last.lat, last.lng, s.zoneLat, s.zoneLng) > s.zoneRadiusM;
    }
    const ph = vis ? photosBy[t.id] || [] : [];
    const out = {
      id: t.id, name: t.name, role: t.role, caught: t.caught,
      lastSeen: isAdmin ? t.lastSeen : undefined,
      hidden: active && !vis, loc, trail, outside,
      photoCount: ph.length, lastPhotoTs: ph.length ? ph[ph.length - 1].ts : null,
      points: t.points || 0,
      live: vis && live ? live.reason : null,
      frozen: t.role === 'hunter' && g.status === 'running' && frozenUntil(g, t.id, now) > now,
      converted: !!t.converted,
      avatar: (t.accountId && db.accounts[t.accountId]?.avatar) || null,
    };
    if (isAdmin) { out.flags = t.flags; out.abilities = t.abilities; out.penalty = t.penalty; }
    return out;
  });
  const visibleIds = new Set(players.filter((p) => !p.hidden).map((p) => p.id));

  // Effekte: eigenes Team, auf einen selbst gerichtete und (für Admins) alle
  const effects = activeEffects(g, now)
    .filter((e) => overview || ended || e.team === viewerRole || (viewer && e.targets.includes(viewer.id)) || ['freeze', 'radar', 'photoOrder'].includes(e.key))
    .map((e) => ({ id: e.id, key: e.key, team: e.team, byName: e.team === viewerRole || overview ? e.byName : null, at: e.at, until: e.until, onMe: !!(viewer && e.targets.includes(viewer.id)) }));

  let self;
  if (isAdmin) {
    self = { id: null, name: 'Spielleitung', role: 'admin', caught: false, lastLocTs: null };
  } else {
    const live = liveReason(g, viewer, now);
    self = {
      id: viewer.id, name: viewer.name, role: viewer.role, caught: viewer.caught, lastLocTs: viewer.lastLoc?.ts || null,
      points: viewer.points || 0,
      abilities: Object.entries(viewer.abilities).filter(([k, n]) => n > 0 && ABILITIES[k]).map(([key, count]) => ({ key, count })),
      quests: viewer.quests.map((q) => {
        const d = questDef(g, q.key);
        return {
          id: q.id, key: q.key, status: q.status, start: q.start, until: q.until, target: q.target, progress: q.progress,
          title: d.title, desc: d.desc, icon: d.icon, kind: d.kind, points: questCfg(g, q.key).points ?? d.points, custom: !!d.custom,
        };
      }),
      inbox: viewer.inbox.slice(-15),
      frozenUntil: viewerFrozen > now ? viewerFrozen : null,
      live: live ? live.reason : null,
      liveUntil: live ? live.until : null,
      penalty: viewer.penalty ? { reason: viewer.penalty.reason, since: viewer.penalty.since } : null,
      photoOrderDue: viewer.photoOrder ? viewer.photoOrder.due : null,
      sendIntervalSec: live ? s.liveIntervalSec : s.locationIntervalSec,
      converted: !!viewer.converted,
      cooldowns: Object.entries(viewer.cooldowns || {}).filter(([, t]) => t > now).map(([key, until]) => ({ key, until })),
      spectatorDelaySec: isSpectator ? s.spectatorDelaySec : 0,
    };
  }
  // Team-Chat: jeder sieht nur sein Team (Zuschauer unter sich), die Spielleitung alles
  const chatTeam = isAdmin ? null : viewerRole;
  const chat = (s.chatEnabled || isAdmin ? g.chat : [])
    .filter((c) => isAdmin || (c.channel === 'all' ? s.allChatEnabled : c.team === chatTeam))
    .slice(-120).map(({ id, ts, pid, name, team, channel, text, voice }) => ({ id, ts, pid, name, team, channel: channel || 'team', text, voice: voice || null }));
  const gallerySet = new Set(db.gallery.map((x) => x.photoId));
  return {
    now,
    game: {
      code: g.code, name: g.name, status: g.status, startedAt: g.startedAt, endedAt: g.endedAt, releaseAt, owner: g.ownerName || null,
      cohosts: (g.cohosts || []).map((id) => db.accounts[id]?.username).filter(Boolean),
    },
    // Spielleitung: darf Fotos in die Galerie übernehmen (nur Admins)?
    canFeature: isAdmin ? !!auth.mgr?.superAdmin : undefined,
    settings: s,
    self,
    players,
    photos: g.photos.filter((ph) => visibleIds.has(ph.pid)).map(({ id, pid, ts, quest, reactions }) => ({
      id, pid, ts, quest: quest || null, questTitle: quest ? questTitle(g, quest) : null,
      reactions: reactionCounts(reactions), myReaction: viewer && reactions ? reactions[viewer.id] || null : null, featured: isAdmin ? gallerySet.has(id) : undefined,
    })),
    messages: g.messages.filter((m) => isAdmin || m.kind !== 'cheat').slice(-40),
    effects,
    chat,
    pickups: g.status === 'running' ? g.pickups.filter((p) => !p.takenBy && p.until > now).map(({ id, lat, lng, name, kind, until, drop, activeAt }) => ({
      id, lat, lng, name, kind, until, drop: !!drop, activeAt: activeAt || null,
    })) : [],
  };
}
const roleText = (r) => (r === 'spectator' ? 'schaut jetzt zu' : `spielt jetzt als ${r === 'runner' ? 'Runner' : 'Hunter'}`);
/** { pid: emoji } -> { emoji: Anzahl } */
function reactionCounts(r) {
  const out = {};
  for (const e of Object.values(r || {})) out[e] = (out[e] || 0) + 1;
  return out;
}

/* ------------------------------------------------------------------ */
/* Anti-Cheat                                                          */
/* ------------------------------------------------------------------ */
function cheatMsg(g, pl, kind, reason) {
  const key = `${kind}:${reason}`;
  if (pl.flags._lastMsg === key && Date.now() - (pl.flags._lastMsgAt || 0) < 300000) return;
  pl.flags._lastMsg = key; pl.flags._lastMsgAt = Date.now();
  pushMsg(g, `⚠️ ${pl.name}: ${reason}`, 'cheat');
}
async function vpnGate(req, g, pl) {
  const mode = g.settings.antiVpn;
  if (mode === 'off') return;
  const r = await detectVpn(req, clientIp(req));
  if (!r.vpn) return;
  if (pl) {
    pl.flags.vpn = Date.now(); pl.flags.vpnReason = r.reason;
    cheatMsg(g, pl, 'vpn', `VPN/Proxy erkannt (${r.reason})`);
  }
  if (mode === 'block') throw new HttpError(403, 'VPN oder Proxy erkannt. Bitte schalte dein VPN aus, um mitzuspielen.', { vpn: true });
}

/* ------------------------------------------------------------------ */
/* API                                                                 */
/* ------------------------------------------------------------------ */
/* ------------------------------------------------------------------ */
/* Profilbild (Issue #7), persönliche Galerie und Vitrine (Issue #8)   */
/* ------------------------------------------------------------------ */
const isJpeg = (b) => b.length > 100 && b[0] === 0xff && b[1] === 0xd8;
/** Alle Fotos, die dieser Account in (noch vorhandenen) Spielen gemacht hat */
function myPhotos(a) {
  const out = [];
  const shown = new Set((a.showcase || []).map((x) => `${x.code}:${x.photoId}`));
  for (const g of Object.values(db.games)) {
    const mine = new Set(Object.values(g.players).filter((p) => p.accountId === a.id).map((p) => p.id));
    if (!mine.size) continue;
    for (const ph of g.photos) {
      if (!mine.has(ph.pid)) continue;
      out.push({
        code: g.code, gameName: g.name, id: ph.id, ts: ph.ts, quest: ph.quest || null, questTitle: ph.quest ? questTitle(g, ph.quest) : null,
        reactions: reactionCounts(ph.reactions), showcased: shown.has(`${g.code}:${ph.id}`),
      });
    }
  }
  return out.sort((x, y) => y.ts - x.ts);
}
/**
 * Konto mit allen personenbezogenen Daten löschen (Art. 17 DSGVO).
 * In Runden anderer bleibt nur ein anonymer Platzhalter, damit deren Ergebnisse stimmen.
 */
async function deleteAccountData(a) {
  await fsp.unlink(path.join(AVATAR_DIR, `${a.id}.jpg`)).catch(() => {});
  for (const x of a.showcase || []) await fsp.unlink(path.join(SHOWCASE_DIR, `${x.id}.jpg`)).catch(() => {});
  for (const o of Object.values(db.accounts)) {
    for (const k of ['friends', 'friendIn', 'friendOut']) if (o[k]) o[k] = o[k].filter((id) => id !== a.id);
    if (o.invites) o.invites = o.invites.filter((i) => i.from !== a.id);
  }
  releaseOwnedGames(a);
  for (const g of Object.values(db.games)) {
    g.banned = (g.banned || []).filter((id) => id !== a.id);
    for (const pl of Object.values(g.players)) {
      if (pl.accountId !== a.id) continue;
      // Standorte, Fotos, Chat und Sprachnachrichten dieses Spielers löschen, Namen anonymisieren
      clearLocations(g, pl.id);
      for (const ph of g.photos.filter((x) => x.pid === pl.id)) await fsp.unlink(path.join(PHOTO_DIR, `${g.code}_${ph.id}.jpg`)).catch(() => {});
      g.photos = g.photos.filter((x) => x.pid !== pl.id);
      for (const c of g.chat.filter((x) => x.pid === pl.id && x.voice)) await fsp.unlink(path.join(VOICE_DIR, `${g.code}_${c.voice.id}.${c.voice.ext}`)).catch(() => {});
      g.chat = g.chat.filter((x) => x.pid !== pl.id);
      for (const ph of g.photos) if (ph.reactions) delete ph.reactions[pl.id];
      const old = pl.name;
      pl.name = 'Gelöschter Spieler'; pl.accountId = null; pl.lastLoc = null; pl.inbox = []; pl.flags = {}; pl.token = rid(18);
      g.messages = g.messages.map((m) => (old && m.text.includes(old) ? { ...m, text: m.text.split(old).join('Gelöschter Spieler') } : m));
      notify(g.code);
    }
  }
  // Galerie-Fotos dieses Kontos (mit Namen) entfernen, eigene Meldungen löschen
  for (const x of db.gallery.filter((y) => y.accountId === a.id)) await fsp.unlink(path.join(GALLERY_DIR, `${x.id}.jpg`)).catch(() => {});
  db.gallery = db.gallery.filter((y) => y.accountId !== a.id);
  db.reports = (db.reports || []).filter((r) => r.by !== a.id && r.targetAccountId !== a.id);
  delete db.accounts[a.id];
}

/** Datenauskunft (Art. 15/20 DSGVO): alles zu einem Konto als ZIP mit data.json und eigenen Fotos */
async function exportAccount(a, res) {
  const games = [];
  const files = [];
  for (const g of Object.values(db.games)) {
    const mine = Object.values(g.players).filter((p) => p.accountId === a.id);
    const owned = g.ownerId === a.id, cohost = (g.cohosts || []).includes(a.id);
    if (!mine.length && !owned && !cohost) continue;
    const pids = new Set(mine.map((p) => p.id));
    games.push({
      code: g.code, name: g.name, status: g.status, createdAt: g.createdAt, startedAt: g.startedAt, endedAt: g.endedAt,
      youCreated: owned, youCohost: cohost,
      you: mine.map((p) => ({ name: p.name, role: p.role, points: p.points, caught: p.caught, caughtAt: p.caughtAt, joinedAt: p.joinedAt, converted: !!p.converted })),
      yourLocations: g.locations.filter((l) => pids.has(l.pid)).map(({ lat, lng, acc, ts }) => ({ lat, lng, acc, ts })),
      yourPhotos: g.photos.filter((ph) => pids.has(ph.pid)).map((ph) => ({ id: ph.id, ts: ph.ts, quest: ph.quest, file: `fotos/${g.code}_${ph.id}.jpg` })),
      yourChat: g.chat.filter((c) => pids.has(c.pid)).map(({ ts, channel, text, voice }) => ({ ts, channel, text, voice: voice ? `sprachnachricht (${voice.dur} s)` : null })),
      settings: owned ? g.settings : undefined,
    });
    for (const ph of g.photos.filter((x) => pids.has(x.pid))) files.push([`fotos/${g.code}_${ph.id}.jpg`, path.join(PHOTO_DIR, `${g.code}_${ph.id}.jpg`), ph.ts]);
  }
  const name = (id) => db.accounts[id]?.username || null;
  const data = {
    exportedAt: new Date().toISOString(),
    hinweis: 'Alle Daten, die Manhunt zu deinem Konto gespeichert hat (Art. 15 und 20 DSGVO). Passwort nur als Hash gespeichert und hier nicht enthalten.',
    account: {
      id: a.id, username: a.username, email: a.email, verified: !!a.verified, createdAt: a.createdAt, isAdmin: isAdminAccount(a),
      consents: a.consents || null, mailPrefs: mailer.prefs(a), mailPrefsChangedAt: a.mailPrefsAt || null,
      quotaMb: a.quotaMb || null, storage: storageInfo(a),
    },
    stats: a.stats, badges: a.badges || {}, seasons: a.seasons || {}, history: a.history || [],
    friends: (a.friends || []).map(name).filter(Boolean), friendRequestsIn: (a.friendIn || []).map(name).filter(Boolean), friendRequestsOut: (a.friendOut || []).map(name).filter(Boolean),
    invites: (a.invites || []).map(({ fromName, code, gameName, ts }) => ({ from: fromName, code, gameName, ts })),
    pushDevices: (a.push || []).length,
    templates: (a.templates || []).map(({ name: n, settings, createdAt }) => ({ name: n, createdAt, settings })),
    showcase: (a.showcase || []).map(({ id, gameName, ts, caption, quest }) => ({ gameName, ts, caption, quest, file: `vitrine/${id}.jpg` })),
    gallery: db.gallery.filter((x) => x.accountId === a.id).map(({ id, gameName, ts, caption, featuredAt }) => ({ gameName, ts, caption, featuredAt, file: `galerie/${id}.jpg` })),
    reportsYouMade: (db.reports || []).filter((r) => r.by === a.id).map(({ ts, kind, gameName, reason, note, targetName, resolved }) => ({ ts, kind, gameName, reason, note, about: targetName, resolved })),
    games,
  };
  for (const x of a.showcase || []) files.push([`vitrine/${x.id}.jpg`, path.join(SHOWCASE_DIR, `${x.id}.jpg`), x.ts]);
  for (const x of db.gallery.filter((y) => y.accountId === a.id)) files.push([`galerie/${x.id}.jpg`, path.join(GALLERY_DIR, `${x.id}.jpg`), x.ts]);
  if (a.avatar) files.push(['profilbild.jpg', path.join(AVATAR_DIR, `${a.id}.jpg`), a.avatar]);
  const day = new Date().toISOString().slice(0, 10);
  res.writeHead(200, { 'Content-Type': 'application/zip', 'Cache-Control': 'no-store', 'Content-Disposition': `attachment; filename="manhunt-daten-${safeName(a.username)}-${day}.zip"` });
  const zip = new ZipWriter(res);
  await zip.add('daten.json', Buffer.from(JSON.stringify(data, null, 2), 'utf8'), Date.now());
  for (const [n, f, ts] of files) { const buf = await fsp.readFile(f).catch(() => null); if (buf) await zip.add(n, buf, ts || Date.now()); }
  await zip.finish();
}

async function handleMe(req, res, url) {
  const m = req.method, p = url.pathname;
  // Öffentlich: Profilbild und ausgestellte Fotos
  const av = p.match(/^\/api\/avatar\/([A-Za-z0-9_.-]{3,20})$/);
  if (av && m === 'GET') {
    const a = findAccount(av[1]);
    const data = a && a.avatar && await fsp.readFile(path.join(AVATAR_DIR, `${a.id}.jpg`)).catch(() => null);
    if (!data) throw new HttpError(404, 'Kein Profilbild');
    res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': data.length, 'Cache-Control': 'public, max-age=86400' });
    return res.end(data);
  }
  const sc = p.match(/^\/api\/showcase\/([a-f0-9]{12})\.jpg$/);
  if (sc && m === 'GET') {
    const data = await fsp.readFile(path.join(SHOWCASE_DIR, `${sc[1]}.jpg`)).catch(() => null);
    if (!data) throw new HttpError(404, 'Foto nicht gefunden');
    res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': data.length, 'Cache-Control': 'public, max-age=604800, immutable' });
    return res.end(data);
  }
  // Konto-Token oder Admin-Token mit Namen (Website /admin)
  const tok = req.headers['x-account'] || req.headers['x-token'] || (p === '/api/me/export' ? url.searchParams.get('t') : null);
  const a = accountFromToken(tok) || (checkAdminToken(tok)?.username ? findAccount(checkAdminToken(tok).username) : null);
  if (!a) throw new HttpError(401, 'Bitte melde dich an');
  if (p === '/api/me/avatar' && m === 'POST') {
    rateLimit(req, 'avatar', 20, 3600e3);
    const buf = await readBody(req, 512 * 1024);
    if (!isJpeg(buf)) throw new HttpError(400, 'Bitte ein JPEG-Bild senden');
    await fsp.writeFile(path.join(AVATAR_DIR, `${a.id}.jpg`), buf);
    a.avatar = Date.now(); save();
    return sendJSON(res, 200, { ok: true, avatar: a.avatar });
  }
  if (p === '/api/me/avatar' && m === 'DELETE') {
    await fsp.unlink(path.join(AVATAR_DIR, `${a.id}.jpg`)).catch(() => {});
    a.avatar = null; save();
    return sendJSON(res, 200, { ok: true });
  }
  if (p === '/api/me/photos' && m === 'GET') return sendJSON(res, 200, { photos: myPhotos(a) });
  // Datenauskunft als ZIP (Art. 15/20 DSGVO)
  if (p === '/api/me/export' && m === 'GET') { rateLimit(req, 'export', 10, 3600e3); return exportAccount(a, res); }
  // E-Mail-Einstellungen (Einwilligungen, jederzeit widerrufbar)
  if (p === '/api/me/prefs' && m === 'GET') return sendJSON(res, 200, { mailPrefs: mailer.prefs(a), categories: Object.fromEntries(Object.entries(mailer.CATEGORIES).map(([k, c]) => [k, c.label])), mailConfigured: smtp.enabled() });
  if (p === '/api/me/prefs' && m === 'POST') { const b = await readJSON(req); return sendJSON(res, 200, { mailPrefs: mailer.setPrefs(a, b.mailPrefs || b) }); }
  // Vorlagen: eigene Regelwerke speichern und für neue Runden wiederverwenden
  if (p === '/api/me/templates' && m === 'GET') return sendJSON(res, 200, { templates: (a.templates || []).map(({ id, name, createdAt }) => ({ id, name, createdAt })) });
  if (p === '/api/me/templates' && m === 'POST') {
    const b = await readJSON(req);
    const name = cleanText(b.name, 40);
    if (!name) throw new HttpError(400, 'Bitte einen Namen eingeben');
    a.templates ||= [];
    const settings = sanitizeSettings(b.settings);
    const old = a.templates.find((t) => t.name.toLowerCase() === name.toLowerCase());
    if (old) { old.settings = settings; old.createdAt = Date.now(); }
    else {
      if (a.templates.length >= MAX_TEMPLATES) throw new HttpError(409, `Höchstens ${MAX_TEMPLATES} Vorlagen`);
      a.templates.push({ id: rid(4), name, settings, createdAt: Date.now() });
    }
    save();
    return sendJSON(res, 201, { ok: true, templates: a.templates.map(({ id, name: n, createdAt }) => ({ id, name: n, createdAt })) });
  }
  const tm = p.match(/^\/api\/me\/templates\/([a-f0-9]{8})$/);
  if (tm) {
    const t = (a.templates || []).find((x) => x.id === tm[1]);
    if (!t) throw new HttpError(404, 'Vorlage nicht gefunden');
    if (m === 'GET') return sendJSON(res, 200, { id: t.id, name: t.name, settings: sanitizeSettings(t.settings) });
    if (m === 'DELETE') { a.templates = a.templates.filter((x) => x !== t); save(); return sendJSON(res, 200, { ok: true }); }
  }
  // Konto selbst löschen (Datenschutz): Passwort zur Bestätigung. Admin-Konten nur über den Server.
  if (p === '/api/me/delete' && m === 'POST') {
    rateLimit(req, 'delete', 10, 3600e3);
    const b = await readJSON(req);
    if (!safeEq(a.hash, hashPassword(b.password || '', a.salt))) throw new HttpError(401, 'Falsches Passwort');
    if (isAdminAccount(a)) throw new HttpError(409, 'Admin-Konten können nicht in der App gelöscht werden');
    await mailer.send(a, 'accountDeleted', { username: a.username }).catch(() => {});
    await deleteAccountData(a);
    save();
    return sendJSON(res, 200, { ok: true });
  }
  // Passwort ändern (eingeloggt, mit altem Passwort)
  if (p === '/api/me/password' && m === 'POST') {
    rateLimit(req, 'pwchange', 10, 3600e3);
    const b = await readJSON(req);
    if (!safeEq(a.hash, hashPassword(b.oldPassword || '', a.salt))) throw new HttpError(401, 'Das bisherige Passwort stimmt nicht');
    if (String(b.newPassword || '').length < 8) throw new HttpError(400, 'Das neue Passwort muss mindestens 8 Zeichen haben');
    a.salt = rid(16); a.hash = hashPassword(b.newPassword, a.salt); a.tokenVersion = (a.tokenVersion || 0) + 1; save();
    mailer.send(a, 'passwordChanged', { username: a.username, when: berlinTime() }).catch(() => {});
    return sendJSON(res, 200, loginResponse(a)); // neues Token, alte Anmeldungen auf anderen Geräten werden ungültig
  }
  if (p === '/api/me/showcase' && m === 'POST') {
    const b = await readJSON(req);
    const g = db.games[String(b.code || '').toUpperCase()];
    const ph = g && g.photos.find((x) => x.id === b.photoId);
    if (!ph || g.players[ph.pid]?.accountId !== a.id) throw new HttpError(404, 'Das ist keins deiner Fotos');
    a.showcase ||= [];
    if (a.showcase.some((x) => x.code === g.code && x.photoId === ph.id)) throw new HttpError(409, 'Das Foto ist schon ausgestellt');
    if (a.showcase.length >= MAX_SHOWCASE) throw new HttpError(409, `Höchstens ${MAX_SHOWCASE} Fotos auf dem Profil`);
    const id = rid(6);
    await fsp.copyFile(path.join(PHOTO_DIR, `${g.code}_${ph.id}.jpg`), path.join(SHOWCASE_DIR, `${id}.jpg`));
    a.showcase.unshift({ id, code: g.code, photoId: ph.id, gameName: g.name, ts: ph.ts, caption: cleanText(b.caption, 120), quest: ph.quest ? questTitle(g, ph.quest) : null });
    save();
    return sendJSON(res, 201, { ok: true, showcase: a.showcase });
  }
  const del = p.match(/^\/api\/me\/showcase\/([a-f0-9]{12})$/);
  if (del && m === 'DELETE') {
    a.showcase = (a.showcase || []).filter((x) => x.id !== del[1]);
    await fsp.unlink(path.join(SHOWCASE_DIR, `${del[1]}.jpg`)).catch(() => {});
    save();
    return sendJSON(res, 200, { ok: true, showcase: a.showcase });
  }
  throw new HttpError(404, 'Nicht gefunden');
}

/** Ein-Klick-Abmeldung aus Mails: GET zeigt eine Bestätigungsseite (Link-Scanner lösen nichts aus), POST meldet ab (RFC 8058) */
async function handleUnsubscribe(req, res, url) {
  const u = url.searchParams.get('u') || '', c = url.searchParams.get('c') || '', sig = url.searchParams.get('s') || '';
  const a = mailer.checkUnsub(u, c, sig);
  const page = (title, body) => {
    res.writeHead(a ? 200 : 400, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(`<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><link rel="stylesheet" href="/style.css"></head><body><main class="wrap"><div class="card stack"><h1>${title}</h1>${body}<p><a href="/">Zur Startseite</a> · <a href="/profile">E-Mail-Einstellungen</a></p></div></main></body></html>`);
  };
  if (!a) return page('Link ungültig', '<p>Dieser Abmeldelink ist ungültig oder das Konto existiert nicht mehr.</p>');
  const what = c === 'all' ? 'alle Benachrichtigungs-Mails' : `Mails zu „${mailer.CATEGORIES[c].label}“`;
  if (req.method === 'POST') {
    mailer.unsubscribe(a, c);
    return page('Abgemeldet', `<p>Du bekommst keine ${what.replace(/^alle /, '')} mehr. Pflicht-Mails (z. B. Passwort zurücksetzen) kommen weiterhin.</p>`);
  }
  const action = `/api/mail/unsubscribe?u=${encodeURIComponent(u)}&c=${encodeURIComponent(c)}&s=${encodeURIComponent(sig)}`;
  return page('Mails abbestellen', `<p>Möchtest du ${what} abbestellen?</p><form method="post" action="${action}"><button class="btn" type="submit">Ja, abbestellen</button></form>`);
}

const social = createSocial({
  mail: (accountId, type, data) => mailer.send(db.accounts[accountId], type, data).catch(() => {}),
  getDb: () => db, save, HttpError, readJSON, sendJSON, accountFromToken, findAccount, isAdminAccount, rateLimit,
});

async function handleApi(req, res, url) {
  const m = req.method, p = url.pathname;
  if (m === 'GET' && p === '/api/health') return sendJSON(res, 200, { ok: true });
  if (m === 'GET' && p === '/api/catalog') return sendJSON(res, 200, catalogForClients());
  if (p === '/api/mail/unsubscribe') return handleUnsubscribe(req, res, url);
  // Angaben für Impressum und Datenschutzerklärung (vom Betreiber per Umgebungsvariablen gesetzt)
  if (m === 'GET' && p === '/api/legal') {
    return sendJSON(res, 200, {
      operator: { name: process.env.OPERATOR_NAME || '', address: process.env.OPERATOR_ADDRESS || '', email: process.env.OPERATOR_EMAIL || '', phone: process.env.OPERATOR_PHONE || '' },
      privacyVersion: PRIVACY_VERSION, publicUrl: PUBLIC_URL,
      retention: { locationsDays: RETENTION_DAYS, photosDays: PHOTO_RETENTION_DAYS, unverifiedDays: UNVERIFIED_DAYS, reportsDays: 180 },
      mailConfigured: smtp.enabled(), vpnCheck: process.env.VPN_CHECK === 'ipapi', tileServer: 'tile.openstreetmap.org',
      quotaMb: USER_QUOTA_MB,
    });
  }
  if (p.startsWith('/api/auth/')) return handleAuth(req, res, p);
  if (p === '/api/seasons' || p.startsWith('/api/profile/') || p.startsWith('/api/friends') || p.startsWith('/api/push/')) return social.handle(req, res, url);

  if (m === 'GET' && p === '/api/leaderboard') {
    const sort = ['points', 'wins', 'catches', 'quests', 'surviveMin', 'pickups', 'featured'].includes(url.searchParams.get('sort')) ? url.searchParams.get('sort') : 'points';
    // season: leer/all = ewige Bestenliste, current = aktueller Monat, oder z. B. 2026-11
    let season = url.searchParams.get('season') || 'all';
    if (season === 'current') season = social.seasonKey();
    let rows;
    if (/^\d{4}-\d{2}$/.test(season)) rows = social.seasonRows(season);
    else {
      season = 'all';
      rows = Object.values(db.accounts).filter((a) => a.verified)
        .map((a) => ({ username: a.username, isAdmin: isAdminAccount(a), ...emptyStats(), ...a.stats, badges: Object.keys(a.badges || {}), avatar: a.avatar || null }))
        .filter((r) => r.games > 0 || r.points > 0);
    }
    rows = rows.sort((a, b) => (b[sort] || 0) - (a[sort] || 0) || b.points - a.points).slice(0, 100);
    return sendJSON(res, 200, { sort, season, currentSeason: social.seasonKey(), rows });
  }
  if (p.startsWith('/api/me/') || p.startsWith('/api/avatar/') || p.startsWith('/api/showcase/')) return handleMe(req, res, url);
  // Offene Runden: öffentlich gelistete Runden (Lobby oder laufend), nach Entfernung sortiert
  if (m === 'GET' && p === '/api/public-games') {
    const lat = Number(url.searchParams.get('lat')), lng = Number(url.searchParams.get('lng'));
    const here = Number.isFinite(lat) && Number.isFinite(lng) && (lat || lng);
    const maxKm = Math.min(500, Math.max(1, Number(url.searchParams.get('km')) || 50));
    const acc = accountFromToken(req.headers['x-account'] || req.headers['x-token']);
    let rows = Object.values(db.games)
      .filter((g) => g.settings.publicListed && g.status !== 'ended' && Object.keys(g.players).length < MAX_PLAYERS && !(acc && (g.banned || []).includes(acc.id)))
      .map((g) => {
        const ps = Object.values(g.players);
        const c = g.settings.zoneEnabled ? { lat: g.settings.zoneLat, lng: g.settings.zoneLng } : g.place;
        const km = here && c ? haversine(lat, lng, c.lat, c.lng) / 1000 : null;
        return {
          code: g.code, name: g.name, status: g.status, owner: g.ownerName || null, createdAt: g.createdAt, startedAt: g.startedAt,
          runners: ps.filter((x) => x.role === 'runner').length, hunters: ps.filter((x) => x.role === 'hunter').length,
          place: g.place?.name || null, km: km == null ? null : Math.round(km * 10) / 10,
          joined: !!(acc && ps.some((x) => x.accountId === acc.id)),
        };
      });
    if (here) rows = rows.filter((r) => r.km == null || r.km <= maxKm).sort((a, b) => (a.km ?? 1e9) - (b.km ?? 1e9));
    else rows.sort((a, b) => b.createdAt - a.createdAt);
    return sendJSON(res, 200, { games: rows.slice(0, 50) });
  }

  if (m === 'GET' && p === '/api/gallery') {
    return sendJSON(res, 200, { items: [...db.gallery].sort((a, b) => b.featuredAt - a.featuredAt).map(({ id, username, gameName, ts, caption, featuredAt, quest }) => ({ id, username, gameName, ts, caption, featuredAt, quest })) });
  }
  const gi = p.match(/^\/api\/gallery\/([a-f0-9]{12})\.jpg$/);
  if (gi && m === 'GET') {
    const item = db.gallery.find((x) => x.id === gi[1]);
    const data = item && await fsp.readFile(path.join(GALLERY_DIR, `${item.id}.jpg`)).catch(() => null);
    if (!data) throw new HttpError(404, 'Foto nicht gefunden');
    res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': data.length, 'Cache-Control': 'public, max-age=86400' });
    return res.end(data);
  }

  if (m === 'POST' && p === '/api/admin/login') {
    rateLimit(req, 'adminlogin', 5, 60000);
    const b = await readJSON(req);
    if (b.username) {
      const a = findAccount(b.username);
      if (!a || !safeEq(a.hash, hashPassword(b.password || '', a.salt))) throw new HttpError(401, 'Benutzername oder Passwort falsch');
      if (!a.verified) throw new HttpError(403, 'Bitte bestätige zuerst deine E-Mail-Adresse.');
      // Admins bekommen ein Admin-Token, alle anderen ihr normales Konto-Token (verwalten damit ihre eigenen Runden)
      return sendJSON(res, 200, { token: isAdminAccount(a) ? makeAdminToken(a.username) : makeAccountToken(a), username: a.username, superAdmin: isAdminAccount(a) });
    }
    if (!safeEq(String(b.password ?? ''), ADMIN_PASSWORD)) throw new HttpError(401, 'Falsches Passwort');
    return sendJSON(res, 200, { token: makeAdminToken() });
  }
  if (p.startsWith('/api/admin/')) return handleAdmin(req, res, url);

  const gm = p.match(/^\/api\/g\/([A-Za-z0-9]{3,10})(?:\/(.*))?$/);
  if (gm) return handleGame(req, res, url, gm[1].toUpperCase(), gm[2] || '');
  throw new HttpError(404, 'Nicht gefunden');
}

/* ------------------------------------------------------------------ */
/* Spielleitung: Admins dürfen alles, jeder Account seine eigenen Runden */
/* ------------------------------------------------------------------ */
/**
 * Wer steckt hinter einem Token? null = niemand.
 * superAdmin: Server-Passwort oder Admin-Account (alle Runden, Accounts, Galerie).
 * account: der Account (bei Admin-Token mit Namen ebenfalls aufgelöst).
 */
function managerFor(t) {
  const c = checkAdminToken(t);
  if (c) {
    const a = c.username ? findAccount(c.username) : null;
    return { superAdmin: true, account: a, name: c.username };
  }
  const a = accountFromToken(t);
  if (!a || !a.verified) return null;
  return { superAdmin: isAdminAccount(a), account: a, name: a.username };
}
const isOwner = (mgr, g) => !!(mgr && mgr.account && g.ownerId && g.ownerId === mgr.account.id);
/** Mit-Spielleitung: vom Besitzer ernannt, darf alles außer Runde löschen und Mit-Spielleitung ändern */
const isCohost = (mgr, g) => !!(mgr && mgr.account && (g.cohosts || []).includes(mgr.account.id));
const canManage = (mgr, g) => !!mgr && (mgr.superAdmin || isOwner(mgr, g) || isCohost(mgr, g));
/**
 * Spielt die Spielleitung in diesem Spiel selbst mit (als Runner/Hunter, Spiel nicht beendet)?
 * Dann bekommt sie keine Vorteile: keine Rundumsicht, keine Geschenke, kein Fangen/Entfernen usw.
 */
function managerPlaysIn(g, mgr) {
  if (!mgr || g.status === 'ended') return false;
  const id = mgr.account?.id, name = (mgr.name || '').toLowerCase();
  if (!id && !name) return false;
  return Object.values(g.players).some((p) => isPlaying(p) && p.accountId && (p.accountId === id || db.accounts[p.accountId]?.username.toLowerCase() === name));
}
const PLAYING_ADMIN = 'Du spielst in diesem Spiel selbst mit – Spielleitungs-Vorteile sind gesperrt.';

/* ---------------- Speicherkontingent ---------------- */
function gameBytes(g) {
  let n = 0;
  for (const ph of g.photos) n += ph.size || 0;
  for (const c of g.chat) if (c.voice) n += c.voice.size || 0;
  return n;
}
/** Kontingent in Bytes (Infinity für Admins) */
const quotaOf = (a) => (!a ? Infinity : isAdminAccount(a) ? Infinity : (a.quotaMb || USER_QUOTA_MB) * MB);
const usageOf = (a) => Object.values(db.games).reduce((n, g) => (g.ownerId === a.id ? n + gameBytes(g) : n), 0);
function storageInfo(a) {
  const quota = quotaOf(a);
  return { used: a ? usageOf(a) : 0, quota: Number.isFinite(quota) ? quota : null, unlimited: !Number.isFinite(quota) };
}
/** Konto wird gelöscht: eigene Runden beenden, deren Fotos löschen; Ergebnis und Verlauf bleiben für die Mitspieler */
function releaseOwnedGames(a) {
  for (const g of Object.values(db.games)) {
    g.cohosts = (g.cohosts || []).filter((id) => id !== a.id);
    if (g.ownerId !== a.id) continue;
    if (g.status === 'running') endGame(g, 'Die Spielleitung hat ihr Konto gelöscht.');
    if (g.status === 'lobby') { deletePhotoFiles(g.code); deleteVoiceFiles(g.code); delete db.games[g.code]; continue; }
    deletePhotoFiles(g.code); deleteVoiceFiles(g.code);
    g.photos = []; for (const c of g.chat) if (c.voice) c.voice = null;
    g.ownerId = null; g.ownerName = null;
    notify(g.code);
  }
}
const ownerOf = (g) => (g.ownerId && db.accounts[g.ownerId]) || null;
/** Passt eine weitere Datei dieser Größe noch ins Kontingent der Spielleitung? (Runden ohne Besitzer: unbegrenzt) */
function hasRoomFor(g, bytes) {
  const o = ownerOf(g);
  return !o || usageOf(o) + bytes <= quotaOf(o);
}
const fmtMb = (b) => `${Math.round(b / MB)} MB`;
/** Bei 80 % einmal warnen */
function quotaCheck(g) {
  const o = ownerOf(g);
  if (!o || !Number.isFinite(quotaOf(o))) return;
  const used = usageOf(o), quota = quotaOf(o);
  if (used < quota * 0.8) { if (o.quotaWarned) { o.quotaWarned = 0; save(); } return; }
  if (o.quotaWarned) return;
  o.quotaWarned = Date.now();
  social.notifyAccount(o.id, { title: '💾 Speicher fast voll', body: `Deine Runden belegen ${fmtMb(used)} von ${fmtMb(quota)}. Lösche alte Runden oder deren Fotos.`, url: '/admin', tag: 'quota' });
  mailer.send(o, 'quotaWarning', { used, quota }).catch(() => {});
}
/** Speicher voll: Spielleitung und Spieler einmal pro Runde informieren */
function quotaFull(g) {
  if (g.quotaFullAt) return;
  g.quotaFullAt = Date.now();
  const o = ownerOf(g);
  pushMsg(g, '💾 Der Speicherplatz der Spielleitung ist voll. Fotos zählen weiter, werden aber nicht mehr gespeichert.');
  if (o) social.notifyAccount(o.id, { title: '💾 Speicher voll', body: `In „${g.name}“ werden keine Fotos mehr gespeichert. Lösche alte Runden oder deren Fotos.`, url: '/admin', tag: 'quota', urgent: true });
  if (o) mailer.send(o, 'quotaFull', { gameName: g.name, code: g.code }).catch(() => {});
}
function adminSummary(g, mgr = null) {
  const ps = Object.values(g.players);
  return {
    code: g.code, name: g.name, status: g.status, createdAt: g.createdAt, startedAt: g.startedAt, endedAt: g.endedAt,
    settings: g.settings, runners: ps.filter((p) => p.role === 'runner').length, hunters: ps.filter((p) => p.role === 'hunter').length,
    caught: ps.filter((p) => p.caught || p.converted).length, photos: g.photos.length,
    spectators: ps.filter((p) => p.role === 'spectator').length,
    flagged: ps.filter((p) => p.flags && (p.flags.vpn || p.flags.spoof)).map((p) => ({ id: p.id, name: p.name, flags: p.flags })),
    owner: g.ownerName || null, bytes: gameBytes(g),
    mine: mgr ? isOwner(mgr, g) : undefined,
    cohost: mgr ? isCohost(mgr, g) : undefined,
    cohosts: (g.cohosts || []).map((id) => db.accounts[id]?.username).filter(Boolean),
    banned: (g.banned || []).map((id) => ({ id, username: db.accounts[id]?.username || '?' })),
    place: g.place || null,
    openReports: (db.reports || []).filter((r) => r.code === g.code && !r.resolved).length,
    youPlay: mgr ? managerPlaysIn(g, mgr) : undefined,
  };
}
/** Gibt es noch Platz für eine neue Runde? (Admins: immer) */
function checkCanCreate(mgr) {
  if (mgr.superAdmin) return;
  const a = mgr.account;
  const open = Object.values(db.games).filter((g) => g.ownerId === a.id && g.status !== 'ended').length;
  if (open >= MAX_OPEN_GAMES) throw new HttpError(409, `Du hast schon ${open} offene Runden. Beende oder lösche zuerst eine (höchstens ${MAX_OPEN_GAMES} gleichzeitig).`);
  if (usageOf(a) >= quotaOf(a) * 0.95) throw new HttpError(507, `Dein Speicherplatz (${fmtMb(quotaOf(a))}) ist voll. Lösche alte Runden oder deren Fotos.`);
}

/** Ungefährer Ort der Runde für „Offene Runden“ (auf ~1 km gerundet, damit niemand genau weiß, wo man wohnt) */
function setPlace(g, pl) {
  if (!pl) { g.place = null; return; }
  const lat = Number(pl.lat), lng = Number(pl.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) throw new HttpError(400, 'Ungültiger Ort');
  g.place = { lat: Math.round(lat * 100) / 100, lng: Math.round(lng * 100) / 100, name: cleanText(pl.name, 60) || null };
}
function banPlayer(g, pl) {
  delete g.players[pl.id]; clearLocations(g, pl.id); g.photos = g.photos.filter((x) => x.pid !== pl.id);
  g.banned ||= [];
  if (pl.accountId && !g.banned.includes(pl.accountId)) g.banned.push(pl.accountId);
  pushMsg(g, `🚫 ${pl.name} wurde aus der Runde entfernt und gesperrt.`);
}
function reportView(r) {
  const g = db.games[r.code];
  return {
    id: r.id, kind: r.kind, code: r.code, gameName: g?.name || r.gameName, ts: r.ts, reason: r.reason, note: r.note || '',
    by: db.accounts[r.by]?.username || '?', photoId: r.photoId || null, playerId: r.playerId || null,
    target: r.targetName || null, resolved: r.resolved || null, action: r.action || null,
    photoAvailable: !!(r.kind === 'photo' && g && g.photos.some((x) => x.id === r.photoId)),
  };
}
const REPORT_REASONS = ['Unangemessen', 'Privatsphäre', 'Beleidigung', 'Schummeln', 'Spam', 'Sonstiges'];
function addReport(req, g, pl, data) {
  rateLimit(req, 'report', 20, 3600e3);
  if (!pl.accountId) throw new HttpError(403, 'Melden nur mit Account');
  const key = data.photoId || data.playerId;
  if (db.reports.some((r) => r.by === pl.accountId && r.code === g.code && (r.photoId || r.playerId) === key && !r.resolved)) throw new HttpError(409, 'Das hast du schon gemeldet');
  const reason = REPORT_REASONS.includes(data.reason) ? data.reason : 'Sonstiges';
  const r = { ...data, id: rid(5), ts: Date.now(), code: g.code, gameName: g.name, by: pl.accountId, reason, note: cleanText(data.note, 300), resolved: null };
  db.reports.push(r);
  if (db.reports.length > 1000) db.reports.splice(0, db.reports.length - 1000);
  // Admins benachrichtigen; bei Spieler-Meldungen auch die Spielleitung der Runde
  const body = `${pl.name} meldet ${data.kind === 'photo' ? 'ein Foto' : data.targetName} in „${g.name}“: ${reason}`;
  for (const a of Object.values(db.accounts)) if (isAdminAccount(a)) social.notifyAccount(a.id, { title: '🚩 Neue Meldung', body, url: '/admin', tag: 'report' });
  if (data.kind === 'player') for (const id of [g.ownerId, ...(g.cohosts || [])].filter(Boolean)) social.notifyAccount(id, { title: '🚩 Spieler gemeldet', body, url: '/admin', tag: 'report' });
  save();
}

async function handleAdmin(req, res, url) {
  const token = req.headers['x-token'] || url.searchParams.get('t');
  const mgr = managerFor(token);
  if (!mgr) throw new HttpError(401, 'Nicht angemeldet');
  const m = req.method, p = url.pathname;
  const superOnly = () => { if (!mgr.superAdmin) throw new HttpError(403, 'Nur für Admins'); };

  if (p === '/api/admin/catalog' && m === 'GET') {
    return sendJSON(res, 200, {
      ...catalogForClients(), defaults: DEFAULTS, mailConfigured: smtp.enabled(),
      superAdmin: mgr.superAdmin, username: mgr.name || null, maxOpenGames: MAX_OPEN_GAMES,
      storage: mgr.account ? storageInfo(mgr.account) : { used: 0, quota: null, unlimited: true },
    });
  }
  if (p === '/api/admin/games' && m === 'GET') {
    // Admins sehen alle Runden (mit ?mine=1 nur die eigenen), alle anderen nur ihre eigenen
    const onlyMine = !mgr.superAdmin || url.searchParams.get('mine') === '1';
    const games = Object.values(db.games).filter((g) => (onlyMine ? isOwner(mgr, g) || isCohost(mgr, g) : true))
      .sort((a, b) => b.createdAt - a.createdAt).map((g) => adminSummary(g, mgr));
    return sendJSON(res, 200, {
      games, superAdmin: mgr.superAdmin, maxOpenGames: MAX_OPEN_GAMES,
      storage: mgr.account ? storageInfo(mgr.account) : { used: 0, quota: null, unlimited: true },
    });
  }
  if (p === '/api/admin/games' && m === 'POST') {
    if (!mgr.superAdmin) rateLimit(req, 'creategame', 20, 3600e3);
    checkCanCreate(mgr);
    const b = await readJSON(req);
    const g = newGame(cleanText(b.name, 40) || 'Manhunt', b.settings, mgr.account);
    if (b.place) setPlace(g, b.place);
    return sendJSON(res, 201, adminSummary(g, mgr));
  }
  if (p.startsWith('/api/admin/accounts') || p.startsWith('/api/admin/gallery') || p.startsWith('/api/admin/photos') || p === '/api/admin/storage' || p.startsWith('/api/admin/reports')) superOnly();
  // Meldungen (nur Admins): Fotos und Spieler
  if (p === '/api/admin/reports' && m === 'GET') {
    const all = url.searchParams.get('all') === '1';
    return sendJSON(res, 200, { reports: db.reports.filter((r) => all || !r.resolved).sort((a, b) => b.ts - a.ts).slice(0, 200).map(reportView) });
  }
  const rr = p.match(/^\/api\/admin\/reports\/([a-f0-9]+)$/);
  if (rr && m === 'POST') {
    const rep = db.reports.find((x) => x.id === rr[1]);
    if (!rep) throw new HttpError(404, 'Meldung nicht gefunden');
    const b = await readJSON(req);
    const g = db.games[rep.code];
    if (b.action === 'deletephoto' && rep.kind === 'photo' && g) {
      const i = g.photos.findIndex((x) => x.id === rep.photoId);
      if (i >= 0) {
        const [ph] = g.photos.splice(i, 1);
        await fsp.unlink(path.join(PHOTO_DIR, `${g.code}_${ph.id}.jpg`)).catch(() => {});
        const owner = g.players[ph.pid];
        if (owner) inbox(owner, '🚫 Eins deiner Fotos wurde nach einer Meldung von den Admins entfernt.', 'bad');
        notify(g.code);
      }
    } else if (b.action === 'ban' && rep.kind === 'player' && g) {
      const pl = g.players[rep.playerId];
      if (pl) banPlayer(g, pl);
    } else if (b.action !== 'dismiss') throw new HttpError(400, 'Unbekannte Aktion');
    // Alle offenen Meldungen zum selben Foto/Spieler mit erledigen
    for (const x of db.reports) if (x.code === rep.code && x.kind === rep.kind && (x.photoId || x.playerId) === (rep.photoId || rep.playerId)) { x.resolved = Date.now(); x.action = b.action; }
    save();
    return sendJSON(res, 200, { ok: true });
  }
  // Speicherübersicht aller Accounts (nur Admins)
  if (p === '/api/admin/storage' && m === 'GET') {
    const rows = Object.values(db.accounts).map((a) => ({ id: a.id, username: a.username, ...storageInfo(a), games: Object.values(db.games).filter((g) => g.ownerId === a.id).length }))
      .filter((r) => r.games > 0).sort((x, y) => y.used - x.used);
    const total = Object.values(db.games).reduce((n, g) => n + gameBytes(g), 0);
    return sendJSON(res, 200, { total, rows, defaultQuotaMb: USER_QUOTA_MB });
  }
  // Accounts
  if (p === '/api/admin/accounts' && m === 'GET') {
    return sendJSON(res, 200, { accounts: Object.values(db.accounts).sort((a, b) => b.createdAt - a.createdAt).map((a) => ({ ...publicAccount(a), storage: storageInfo(a), quotaMb: a.quotaMb || null })) });
  }
  const am = p.match(/^\/api\/admin\/accounts\/([a-f0-9]+)(?:\/(\w+))?$/);
  if (am) {
    const a = db.accounts[am[1]];
    if (!a) throw new HttpError(404, 'Account nicht gefunden');
    if (!am[2] && m === 'DELETE') {
      if (isAdminAccount(a)) throw new HttpError(409, 'Admin-Accounts können nicht gelöscht werden');
      await deleteAccountData(a);
      save(); return sendJSON(res, 200, { ok: true });
    }
    if (am[2] === 'verify' && m === 'POST') { a.verified = true; a.code = null; save(); return sendJSON(res, 200, publicAccount(a)); }
    if (am[2] === 'resetstats' && m === 'POST') { a.stats = emptyStats(); save(); return sendJSON(res, 200, publicAccount(a)); }
    // Eigenes Kontingent für einen Account (MB, leer/0 = Standard)
    if (am[2] === 'quota' && m === 'POST') {
      const b = await readJSON(req);
      const mb = Math.round(Number(b.mb) || 0);
      if (mb < 0 || mb > 1024 * 1024) throw new HttpError(400, 'Ungültige Größe');
      a.quotaMb = mb || null; a.quotaWarned = 0; save();
      return sendJSON(res, 200, { ...publicAccount(a), storage: storageInfo(a), quotaMb: a.quotaMb });
    }
    throw new HttpError(404, 'Unbekannte Aktion');
  }
  // Galerie
  const gm = p.match(/^\/api\/admin\/gallery\/([a-f0-9]{12})$/);
  if (gm && m === 'DELETE') {
    const i = db.gallery.findIndex((x) => x.id === gm[1]);
    if (i < 0) throw new HttpError(404, 'Nicht in der Galerie');
    const [item] = db.gallery.splice(i, 1);
    await fsp.unlink(path.join(GALLERY_DIR, `${item.id}.jpg`)).catch(() => {});
    const acc = item.accountId && db.accounts[item.accountId];
    if (acc) { acc.stats.featured = Math.max(0, (acc.stats.featured || 0) - 1); acc.stats.points -= POINTS.featured; }
    save(); return sendJSON(res, 200, { ok: true });
  }
  // Alle Fotos auf dem Server löschen
  if (p === '/api/admin/photos/purge' && m === 'POST') {
    const b = await readJSON(req);
    let n = 0;
    for (const f of fs.readdirSync(PHOTO_DIR)) { try { fs.unlinkSync(path.join(PHOTO_DIR, f)); n++; } catch { /* egal */ } }
    for (const g of Object.values(db.games)) { g.photos = []; g.quotaFullAt = null; notify(g.code); }
    if (b.includeGallery) {
      for (const f of fs.readdirSync(GALLERY_DIR)) { try { fs.unlinkSync(path.join(GALLERY_DIR, f)); n++; } catch { /* egal */ } }
      db.gallery = [];
    }
    save();
    return sendJSON(res, 200, { ok: true, deleted: n });
  }

  const r = p.match(/^\/api\/admin\/games\/([A-Za-z0-9]+)(?:\/(\w+))?$/);
  if (!r) throw new HttpError(404, 'Nicht gefunden');
  const g = getGame(r[1]); const act = r[2];
  // Fremde Runden: für normale Accounts so, als gäbe es sie nicht
  if (!canManage(mgr, g)) throw new HttpError(404, 'Spiel nicht gefunden');

  // Löschen: Admins jede Runde, alle anderen ihre eigenen (gibt den Speicher frei)
  if (!act && m === 'DELETE') {
    if (!mgr.superAdmin && !isOwner(mgr, g)) throw new HttpError(403, 'Nur wer die Runde angelegt hat, kann sie löschen.');
    if (g.status === 'running' && !mgr.superAdmin) throw new HttpError(409, 'Beende die Runde zuerst, bevor du sie löschst.');
    deletePhotoFiles(g.code); deleteVoiceFiles(g.code); delete db.games[g.code]; save();
    for (const res2 of sseClients.get(g.code) || []) res2.end();
    sseClients.delete(g.code);
    return sendJSON(res, 200, { ok: true });
  }
  const playing = managerPlaysIn(g, mgr);
  if (!act && m === 'PATCH') {
    const b = await readJSON(req);
    if (playing && g.status !== 'lobby' && b.settings) throw new HttpError(403, `${PLAYING_ADMIN} Einstellungen nur in der Lobby.`);
    if (b.name !== undefined) g.name = cleanText(b.name, 40) || g.name;
    if (b.settings) g.settings = sanitizeSettings(b.settings, g.settings);
    if (b.place !== undefined) setPlace(g, b.place);
    save(); notify(g.code);
    return sendJSON(res, 200, adminSummary(g, mgr));
  }
  if (m === 'POST') {
    const b = await readJSON(req);
    // Mitspielende Spielleitung: nur neutrale Aktionen (starten, beenden, zurücksetzen, Durchsage)
    if (playing && !['start', 'end', 'reset', 'announce', 'purgephotos', 'cohost', 'unban'].includes(act)) throw new HttpError(403, PLAYING_ADMIN);
    if (act === 'start') startGame(g);
    else if (act === 'end') endGame(g, 'Beendet von der Spielleitung.');
    else if (act === 'reset') resetGame(g);
    else if (act === 'purgephotos') {
      // Fotos und Sprachnachrichten dieser Runde löschen, Ergebnis und Verlauf bleiben (gibt Speicher frei)
      if (g.status === 'running') throw new HttpError(409, 'Fotos lassen sich erst nach Spielende löschen.');
      purgeGameMedia(g); g.photosPurgedAt = Date.now();
    }
    else if (act === 'announce') { const t = cleanText(b.text, 300); if (!t) throw new HttpError(400, 'Nachricht fehlt'); pushMsg(g, t, 'admin'); }
    else if (act === 'kick') { delete g.players[b.playerId]; clearLocations(g, b.playerId); g.photos = g.photos.filter((x) => x.pid !== b.playerId); }
    else if (act === 'ban') {
      // Entfernen und sperren: kann mit diesem Account nicht wieder beitreten
      const pl = g.players[b.playerId];
      if (!pl) throw new HttpError(404, 'Spieler nicht gefunden');
      if (pl.accountId && (pl.accountId === g.ownerId || (mgr.account && pl.accountId === mgr.account.id))) throw new HttpError(409, 'Die Spielleitung kann nicht gesperrt werden');
      banPlayer(g, pl);
    } else if (act === 'unban') {
      g.banned = (g.banned || []).filter((id) => id !== b.accountId);
    } else if (act === 'cohost') {
      // Mit-Spielleitung ernennen/entfernen: nur Besitzer oder Admins
      if (!mgr.superAdmin && !isOwner(mgr, g)) throw new HttpError(403, 'Nur wer die Runde angelegt hat, kann die Mit-Spielleitung ändern.');
      const a = findAccount(b.username);
      if (!a || !a.verified) throw new HttpError(404, 'Account nicht gefunden');
      if (a.id === g.ownerId) throw new HttpError(409, 'Das ist schon die Spielleitung');
      g.cohosts ||= [];
      if (b.remove) g.cohosts = g.cohosts.filter((id) => id !== a.id);
      else {
        if (g.cohosts.includes(a.id)) throw new HttpError(409, `${a.username} ist schon Mit-Spielleitung`);
        if (g.cohosts.length >= MAX_COHOSTS) throw new HttpError(409, `Höchstens ${MAX_COHOSTS} Mit-Spielleiter`);
        g.cohosts.push(a.id);
        social.notifyAccount(a.id, { title: '🎮 Mit-Spielleitung', body: `${mgr.name || 'Die Spielleitung'} hat dich zur Mit-Spielleitung von „${g.name}“ gemacht.`, url: '/admin', tag: 'cohost' });
        mailer.send(a, 'cohostAdded', { from: mgr.name || 'Die Spielleitung', gameName: g.name, code: g.code }).catch(() => {});
      }
    }
    else if (act === 'give') {
      if (!g.settings.adminGiftsEnabled) throw new HttpError(403, 'Fähigkeiten verschenken ist in diesem Spiel aus (Einstellung „Spielleitung darf Fähigkeiten verschenken“).');
      const pl = g.players[b.playerId];
      if (!pl || !ABILITIES[b.ability]) throw new HttpError(404, 'Spieler oder Fähigkeit nicht gefunden');
      if (!usableBy(b.ability, pl.role)) throw new HttpError(400, 'Die Fähigkeit passt nicht zur Rolle');
      pl.abilities[b.ability] = Math.max(0, (pl.abilities[b.ability] || 0) + (Number(b.count) || 1));
      inbox(pl, `${ABILITIES[b.ability].icon} Die Spielleitung schenkt dir: ${ABILITIES[b.ability].name}`, 'reward');
    } else if (act === 'clearflags') {
      const pl = g.players[b.playerId];
      if (pl) pl.flags = {};
    } else if (act === 'rejectphoto') {
      // Foto entfernen; war es ein Quest-Foto, werden Punkte und Belohnung zurückgenommen
      const i = g.photos.findIndex((x) => x.id === b.photoId);
      if (i < 0) throw new HttpError(404, 'Foto nicht gefunden');
      const [ph] = g.photos.splice(i, 1);
      await fsp.unlink(path.join(PHOTO_DIR, `${g.code}_${ph.id}.jpg`)).catch(() => {});
      const pl = g.players[ph.pid];
      if (pl) {
        const q = pl.quests.find((x) => x.photoId === ph.id && x.status === 'done');
        if (q) {
          q.status = 'rejected';
          award(pl, 'quests', -(q.pointsAwarded || 0), -1);
          if (q.rewardKey && pl.abilities[q.rewardKey] > 0) { pl.abilities[q.rewardKey]--; if (!pl.abilities[q.rewardKey]) delete pl.abilities[q.rewardKey]; }
          inbox(pl, `❌ Die Spielleitung hat dein Foto für „${questTitle(g, q.key)}“ abgelehnt. Punkte und Belohnung wurden zurückgenommen.`, 'bad');
        } else {
          award(pl, 'photos', -POINTS.photo, -1);
          inbox(pl, '❌ Die Spielleitung hat eins deiner Fotos abgelehnt.', 'bad');
        }
      }
    } else if (act === 'feature') {
      if (!mgr.superAdmin) throw new HttpError(403, 'Nur Admins wählen Fotos für die Galerie aus.');
      const ph = g.photos.find((x) => x.id === b.photoId);
      if (!ph) throw new HttpError(404, 'Foto nicht gefunden');
      if (db.gallery.some((x) => x.photoId === ph.id)) throw new HttpError(409, 'Das Foto ist schon in der Galerie');
      const pl = g.players[ph.pid];
      const id = rid(6);
      await fsp.copyFile(path.join(PHOTO_DIR, `${g.code}_${ph.id}.jpg`), path.join(GALLERY_DIR, `${id}.jpg`));
      db.gallery.push({
        id, photoId: ph.id, gameCode: g.code, gameName: g.name, ts: ph.ts, featuredAt: Date.now(),
        accountId: pl?.accountId || null, username: pl ? pl.name : 'Unbekannt', caption: cleanText(b.caption, 120),
        quest: ph.quest ? questTitle(g, ph.quest) : null,
      });
      if (pl) { award(pl, 'featured', POINTS.featured); inbox(pl, '⭐ Eins deiner Fotos ist jetzt in der Galerie der besten Fotos!', 'reward'); }
    } else throw new HttpError(404, 'Unbekannte Aktion');
    checkAllCaught(g); save(); notify(g.code);
    return sendJSON(res, 200, adminSummary(g, mgr));
  }
  throw new HttpError(405, 'Methode nicht erlaubt');
}

/** Eine Position übernehmen (mit Anti-Cheat-Prüfung). Gibt false zurück, wenn sie verworfen wurde. */
function acceptLocation(g, pl, lat, lng, acc, mock, ts = Date.now(), checkNow = true) {
  const s = g.settings;
  const prevLoc = pl.lastLoc;
  const reason = s.antiSpoof === 'off' ? null : checkSpoof(pl, prevLoc, lat, lng, acc, mock, s.maxSpeedKmh, ts);
  if (reason) {
    pl.flags.spoof = Date.now(); pl.flags.spoofReason = reason; pl.flags.spoofCount = (pl.flags.spoofCount || 0) + 1;
    cheatMsg(g, pl, 'spoof', `Verdacht auf GPS-Fälschung – ${reason}`);
    if (s.antiSpoof === 'block') { save(); throw new HttpError(409, `Position abgelehnt: ${reason}`, { spoof: true }); }
  }
  pl.lastLoc = { lat, lng, acc, ts };
  // Distanz-Quests schrittweise mitzählen
  if (prevLoc && acc < 80 && (prevLoc.acc || 0) < 80) {
    const d = haversine(prevLoc.lat, prevLoc.lng, lat, lng);
    for (const q of pl.quests) if (q.status === 'active' && questDef(g, q.key).kind === 'distance' && ts >= q.start) q.dist = (q.dist || 0) + d;
  }
  addLocation(g, { pid: pl.id, lat, lng, acc: Math.round(acc), ts });
  if (checkNow && s.questsEnabled) checkQuests(g, pl, Date.now());
  return true;
}

function parseLoc(b) {
  const lat = Number(b.lat), lng = Number(b.lng), acc = Math.min(10000, Math.max(0, Number(b.acc) || 0));
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) throw new HttpError(400, 'Ungültige Position');
  return { lat, lng, acc, mock: b.mock === true };
}

async function handleGame(req, res, url, code, rest) {
  const g = getGame(code);
  const m = req.method;

  if (rest === 'info' && m === 'GET') {
    const ps = Object.values(g.players);
    const s = g.settings;
    return sendJSON(res, 200, {
      code: g.code, name: g.name, status: g.status,
      runners: ps.filter((p) => p.role === 'runner').length, hunters: ps.filter((p) => p.role === 'hunter').length,
      settings: {
        locationIntervalSec: s.locationIntervalSec, photosEnabled: s.photosEnabled,
        photoIntervalMin: s.photoIntervalMin, headStartMin: s.headStartMin,
        fuzzMeters: s.fuzzMeters, zoneEnabled: s.zoneEnabled,
        livePenaltyEnabled: s.livePenaltyEnabled, photoGraceSec: s.photoGraceSec, livePenaltyUntil: s.livePenaltyUntil,
        abilitiesEnabled: s.abilitiesEnabled, questsEnabled: s.questsEnabled, pickupsEnabled: s.pickupsEnabled,
        antiVpn: s.antiVpn, antiSpoof: s.antiSpoof,
        caughtBecomeHunter: s.caughtBecomeHunter, chatEnabled: s.chatEnabled, voiceEnabled: s.voiceEnabled, allChatEnabled: s.allChatEnabled,
        spectatorsEnabled: s.spectatorsEnabled, spectatorDelaySec: s.spectatorDelaySec,
        supplyDropsEnabled: s.supplyDropsEnabled, supplyDropIntervalMin: s.supplyDropIntervalMin,
      },
    });
  }
  if (rest === 'join' && m === 'POST') {
    const b = await readJSON(req);
    const acc = accountFromToken(req.headers['x-account'] || b.accountToken);
    if (!acc) throw new HttpError(401, 'Bitte melde dich zuerst mit deinem Account an.', { needsAccount: true });
    if (!acc.verified) throw new HttpError(403, 'Bitte bestätige zuerst deine E-Mail-Adresse.', { needsVerification: true });
    if (!['runner', 'hunter', 'spectator'].includes(b.role)) throw new HttpError(400, 'Bitte eine Rolle wählen');
    if (b.role === 'spectator' && !g.settings.spectatorsEnabled) throw new HttpError(403, 'In diesem Spiel sind keine Zuschauer erlaubt');
    if ((g.banned || []).includes(acc.id)) throw new HttpError(403, 'Du wurdest aus dieser Runde gesperrt.');
    // Schon in diesem Spiel? Dann wieder anmelden (Rolle nur in der Lobby änderbar)
    const existing = Object.values(g.players).find((p) => p.accountId === acc.id);
    if (existing) {
      if (g.status === 'lobby' && existing.role !== b.role) { existing.role = b.role; existing.abilities = {}; existing.gotStart = false; pushMsg(g, `${existing.name} ${roleText(b.role)}.`); }
      save(); notify(g.code);
      return sendJSON(res, 200, { token: existing.token, id: existing.id, name: existing.name, role: existing.role, rejoined: true });
    }
    if (g.status === 'ended') throw new HttpError(409, 'Das Spiel ist schon beendet');
    if (Object.keys(g.players).length >= MAX_PLAYERS) throw new HttpError(409, 'Das Spiel ist voll');
    if (b.role !== 'spectator') await vpnGate(req, g, null);
    const name = acc.username;
    if (Object.values(g.players).some((p) => p.name.toLowerCase() === name.toLowerCase())) throw new HttpError(409, 'Dieser Name ist schon im Spiel');
    const player = migratePlayer({ id: rid(4), name, role: b.role, token: rid(18), accountId: acc.id, gameCode: g.code, caught: false, joinedAt: Date.now(), lastSeen: Date.now(), lastLoc: null });
    g.players[player.id] = player;
    if (g.status === 'running') { giveStartAbilities(g, player); player.nextQuestAt = Date.now() + 60000; }
    pushMsg(g, `${name} ${b.role === 'spectator' ? 'schaut zu' : `ist als ${b.role === 'runner' ? 'Runner' : 'Hunter'} beigetreten`}.`);
    save(); notify(g.code);
    return sendJSON(res, 201, { token: player.token, id: player.id, name, role: player.role });
  }

  // Ab hier ist eine Anmeldung nötig
  const t = req.headers['x-token'] || url.searchParams.get('t') || '';
  let auth = null;
  const mgr0 = managerFor(t);
  const mgr = canManage(mgr0, g) ? mgr0 : null;
  if (mgr && !managerPlaysIn(g, mgr)) auth = { admin: true, mgr };
  else if (mgr && checkAdminToken(t)) throw new HttpError(403, `${PLAYING_ADMIN} Öffne das Spiel mit deinem Spieler-Zugang.`);
  else {
    let player = Object.values(g.players).find((pl) => safeEq(pl.token, t));
    if (player) player.lastSeen = Date.now();
    // Mit dem Account-Token kommt man an seine eigenen Spiele (auch vergangene: Spielverlauf, Issue #7)
    if (!player) { const acc = accountFromToken(t); if (acc) player = Object.values(g.players).find((pl) => pl.accountId === acc.id); }
    if (player) auth = { player };
  }
  if (!auth) throw new HttpError(401, 'Nicht angemeldet oder aus dem Spiel entfernt');

  if (rest === 'state' && m === 'GET') return sendJSON(res, 200, buildState(g, auth));
  if (rest === 'events' && m === 'GET') return openSSE(req, res, g);

  const pl = auth.player;
  if (pl && !isPlaying(pl) && ['location', 'locations', 'photo', 'ability', 'pickup', 'caught'].includes(rest) && m === 'POST') {
    throw new HttpError(403, 'Zuschauer können nur zuschauen');
  }
  if (rest === 'location' && m === 'POST') {
    if (!pl) throw new HttpError(403, 'Nur für Spieler');
    if (g.status !== 'running') throw new HttpError(409, 'Das Spiel läuft gerade nicht');
    if (pl.caught) throw new HttpError(409, 'Du bist gefangen');
    const b = await readJSON(req);
    const { lat, lng, acc, mock } = parseLoc(b);
    await vpnGate(req, g, pl);
    const now = Date.now();
    const live = liveReason(g, pl, now);
    const interval = live ? g.settings.liveIntervalSec : g.settings.locationIntervalSec;
    const minGap = live ? 2000 : Math.max(5000, interval * 1000 * 0.8);
    if (pl.lastLoc && now - pl.lastLoc.ts < minGap) return sendJSON(res, 200, { ok: false, nextInMs: pl.lastLoc.ts + minGap - now, live: !!live });
    acceptLocation(g, pl, lat, lng, acc, mock);
    save(); notify(g.code);
    return sendJSON(res, 200, { ok: true, nextInMs: interval * 1000, live: !!live });
  }

  // Offline gesammelte Positionen nachreichen (z. B. nach einem Funkloch). ts in Server-Zeit.
  if (rest === 'locations' && m === 'POST') {
    if (!pl) throw new HttpError(403, 'Nur für Spieler');
    if (g.status !== 'running') throw new HttpError(409, 'Das Spiel läuft gerade nicht');
    if (pl.caught) throw new HttpError(409, 'Du bist gefangen');
    const b = await readJSON(req);
    if (!Array.isArray(b.points)) throw new HttpError(400, 'points fehlt');
    await vpnGate(req, g, pl);
    const now = Date.now();
    const pts = b.points.slice(0, 500).map((x) => ({ ...parseLoc(x), ts: Math.round(Number(x.ts)) }))
      .filter((x) => Number.isFinite(x.ts) && x.ts > now - 30 * 60000 && x.ts <= now + 10000 && x.ts > (g.startedAt || 0))
      .sort((a, c) => a.ts - c.ts);
    let accepted = 0, rejected = 0;
    for (const x of pts) {
      if (pl.lastLoc && x.ts <= pl.lastLoc.ts) continue;
      try { acceptLocation(g, pl, x.lat, x.lng, x.acc, x.mock, Math.min(x.ts, now), false); accepted++; }
      catch (e) { if (e instanceof HttpError) rejected++; else throw e; }
    }
    if (g.settings.questsEnabled) checkQuests(g, pl, now);
    save(); notify(g.code);
    return sendJSON(res, 200, { ok: true, accepted, rejected });
  }

  // Team-Chat (Text)
  if (rest === 'chat' && m === 'POST') {
    if (!pl) throw new HttpError(403, 'Nur für Spieler');
    if (!g.settings.chatEnabled) throw new HttpError(409, 'Der Chat ist in diesem Spiel aus');
    const b = await readJSON(req);
    const text = cleanText(b.text, 300);
    if (!text) throw new HttpError(400, 'Nachricht fehlt');
    const channel = chatChannel(g, pl, b.channel);
    chatGate(pl);
    pushChat(g, pl, { text }, channel);
    save(); notify(g.code);
    return sendJSON(res, 201, { ok: true });
  }
  // Team-Chat (Sprachnachricht, wie ein Walkie-Talkie): Audio als Body, ?dur=Sekunden
  if (rest === 'chat/voice' && m === 'POST') {
    if (!pl) throw new HttpError(403, 'Nur für Spieler');
    if (!g.settings.chatEnabled || !g.settings.voiceEnabled) throw new HttpError(409, 'Sprachnachrichten sind in diesem Spiel aus');
    const type = String(req.headers['content-type'] || '').split(';')[0].trim();
    const ext = { 'audio/mp4': 'm4a', 'audio/aac': 'm4a', 'audio/m4a': 'm4a', 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mpeg': 'mp3' }[type];
    if (!ext) throw new HttpError(415, 'Unbekanntes Audioformat');
    chatGate(pl);
    const buf = await readBody(req, MAX_VOICE_BYTES);
    if (buf.length < 200) throw new HttpError(400, 'Aufnahme zu kurz');
    if (!hasRoomFor(g, buf.length)) throw new HttpError(507, 'Der Speicherplatz der Spielleitung ist voll – Sprachnachrichten gehen gerade nicht, Text schon.');
    const id = rid(6);
    await fsp.writeFile(path.join(VOICE_DIR, `${g.code}_${id}.${ext}`), buf);
    const dur = Math.max(1, Math.min(60, Math.round(Number(url.searchParams.get('dur')) || 0)));
    pushChat(g, pl, { text: '', voice: { id, ext, type, dur, size: buf.length } }, chatChannel(g, pl, url.searchParams.get('channel')));
    save(); notify(g.code);
    return sendJSON(res, 201, { ok: true, id });
  }
  const vm = rest.match(/^chat\/voice\/([a-f0-9]{12})$/);
  if (vm && m === 'GET') {
    const c = g.chat.find((x) => x.voice && x.voice.id === vm[1]);
    if (!c || !(auth.admin || (pl && (c.channel === 'all' ? g.settings.allChatEnabled : c.team === pl.role)))) throw new HttpError(404, 'Nicht gefunden');
    const data = await fsp.readFile(path.join(VOICE_DIR, `${g.code}_${c.voice.id}.${c.voice.ext}`)).catch(() => null);
    if (!data) throw new HttpError(404, 'Nicht gefunden');
    res.writeHead(200, { 'Content-Type': c.voice.type, 'Content-Length': data.length, 'Cache-Control': 'private, max-age=86400' });
    return res.end(data);
  }

  if (rest === 'photo' && m === 'POST') {
    if (!pl) throw new HttpError(403, 'Nur für Spieler');
    if (g.status !== 'running') throw new HttpError(409, 'Das Spiel läuft gerade nicht');
    if (pl.caught) throw new HttpError(409, 'Du bist gefangen');
    const questId = url.searchParams.get('quest');
    const quest = questId ? pl.quests.find((q) => q.id === questId && q.status === 'active' && questDef(g, q.key).kind === 'photo') : null;
    if (questId && !quest) throw new HttpError(409, 'Diese Quest ist nicht (mehr) aktiv');
    if (!quest) {
      if (pl.role !== 'runner') throw new HttpError(403, 'Nur Runner laden Fotos hoch');
      if (!g.settings.photosEnabled) throw new HttpError(409, 'Fotos sind in diesem Spiel ausgeschaltet');
    }
    const buf = await readBody(req, MAX_PHOTO_BYTES);
    if (buf.length < 100 || buf[0] !== 0xff || buf[1] !== 0xd8) throw new HttpError(400, 'Bitte ein JPEG-Foto senden');
    const now = Date.now();
    // Speicher der Spielleitung voll: Das Foto zählt trotzdem (keine Live-Strafe, Quest erfüllt), wird aber nicht gespeichert.
    if (!hasRoomFor(g, buf.length)) {
      quotaFull(g);
      if (pl.role === 'runner') photoCredited(g, pl, now);
      if (quest) completeQuest(g, pl, quest);
      save(); notify(g.code);
      return sendJSON(res, 201, { ok: true, id: null, stored: false, warning: 'Foto gezählt, aber nicht gespeichert: Der Speicherplatz der Spielleitung ist voll.' });
    }
    const id = rid(6);
    await fsp.writeFile(path.join(PHOTO_DIR, `${g.code}_${id}.jpg`), buf);
    g.photos.push({ id, pid: pl.id, ts: now, quest: quest ? quest.key : null, size: buf.length });
    if (quest) quest.photoId = id;
    award(pl, 'photos', POINTS.photo);
    if (pl.role === 'runner') photoCredited(g, pl, now);
    if (quest) completeQuest(g, pl, quest);
    quotaCheck(g);
    save(); notify(g.code);
    return sendJSON(res, 201, { ok: true, id, stored: true });
  }

  // Alle Fotos als ZIP: nach Spielende für alle Mitspieler, für die Spielleitung jederzeit.
  // Ordner pro Fotograf, Dateiname mit Uhrzeit und ggf. Quest.
  if (rest === 'photos.zip' && m === 'GET') {
    if (!auth.admin && g.status !== 'ended') throw new HttpError(409, 'Die Fotos gibt es nach Spielende als ZIP');
    const photos = [...buildState(g, auth).photos].sort((a, c) => a.ts - c.ts);
    if (!photos.length) throw new HttpError(404, 'Keine Fotos in diesem Spiel');
    const day = new Date(g.startedAt || g.createdAt).toISOString().slice(0, 10);
    res.writeHead(200, {
      'Content-Type': 'application/zip', 'Cache-Control': 'no-store',
      'Content-Disposition': `attachment; filename="manhunt-${g.code}-${day}.zip"; filename*=UTF-8''${encodeURIComponent(`Manhunt ${g.name} ${day}.zip`)}`,
    });
    const zip = new ZipWriter(res);
    const used = new Set();
    for (const ph of photos) {
      const data = await fsp.readFile(path.join(PHOTO_DIR, `${g.code}_${ph.id}.jpg`)).catch(() => null);
      if (!data) continue;
      const who = safeName(g.players[ph.pid]?.name || 'Unbekannt');
      const t = new Date(ph.ts);
      const hhmm = `${String(t.getHours()).padStart(2, '0')}-${String(t.getMinutes()).padStart(2, '0')}-${String(t.getSeconds()).padStart(2, '0')}`;
      const q = ph.quest ? `_${safeName(questTitle(g, ph.quest))}` : '';
      let name = `${who}/${hhmm}${q}.jpg`;
      for (let i = 2; used.has(name); i++) name = `${who}/${hhmm}${q}_${i}.jpg`;
      used.add(name);
      await zip.add(name, data, ph.ts);
    }
    await zip.finish();
    return;
  }

  // Emoji-Reaktion auf ein Foto (wie bei WhatsApp): eine pro Person, gleiches Emoji nochmal = entfernen
  const rm = rest.match(/^photo\/([a-f0-9]{12})\/react$/);
  if (rm && m === 'POST') {
    if (!pl) throw new HttpError(403, 'Nur für Spieler');
    const photo = g.photos.find((x) => x.id === rm[1]);
    if (!photo || !buildState(g, auth).photos.some((x) => x.id === photo.id)) throw new HttpError(404, 'Foto nicht gefunden');
    if (photo.pid === pl.id) throw new HttpError(409, 'Auf eigene Fotos kannst du nicht reagieren');
    const b = await readJSON(req);
    const emoji = b.emoji ? String(b.emoji) : '';
    if (emoji && !REACTIONS.includes(emoji)) throw new HttpError(400, 'Diese Reaktion gibt es nicht');
    photo.reactions ||= {};
    const before = photo.reactions[pl.id];
    if (!emoji || before === emoji) delete photo.reactions[pl.id]; else photo.reactions[pl.id] = emoji;
    const owner = g.players[photo.pid];
    if (owner && emoji && before !== emoji) inbox(owner, `${emoji} ${pl.name} reagiert auf dein Foto`, 'info');
    save(); notify(g.code);
    return sendJSON(res, 200, { ok: true, reaction: photo.reactions[pl.id] || null });
  }

  // Foto melden (an die Admins)
  const rpm = rest.match(/^photo\/([a-f0-9]{12})\/report$/);
  if (rpm && m === 'POST') {
    if (!pl) throw new HttpError(403, 'Nur für Spieler');
    const photo = g.photos.find((x) => x.id === rpm[1]);
    if (!photo || !buildState(g, auth).photos.some((x) => x.id === photo.id)) throw new HttpError(404, 'Foto nicht gefunden');
    const b = await readJSON(req);
    addReport(req, g, pl, { kind: 'photo', photoId: photo.id, targetName: g.players[photo.pid]?.name || null, reason: b.reason, note: b.note });
    return sendJSON(res, 201, { ok: true });
  }
  // Spieler melden (an Admins und Spielleitung)
  if (rest === 'report' && m === 'POST') {
    if (!pl) throw new HttpError(403, 'Nur für Spieler');
    const b = await readJSON(req);
    const target = g.players[b.playerId];
    if (!target || target.id === pl.id) throw new HttpError(404, 'Spieler nicht gefunden');
    addReport(req, g, pl, { kind: 'player', playerId: target.id, targetAccountId: target.accountId || null, targetName: target.name, reason: b.reason, note: b.note });
    return sendJSON(res, 201, { ok: true });
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
    if (!target || !(target.role === 'runner' || target.converted)) throw new HttpError(404, 'Runner nicht gefunden');
    const value = b.caught !== false;
    const isHunterOrAdmin = auth.admin || pl.role === 'hunter';
    const isSelf = pl && pl.id === target.id;
    if (!isHunterOrAdmin && !(isSelf && value)) throw new HttpError(403, 'Nicht erlaubt');
    if (pl && pl.role === 'hunter' && frozenUntil(g, pl.id, Date.now()) > Date.now()) throw new HttpError(409, 'Du bist eingefroren und kannst gerade niemanden fangen');
    setCaught(g, target, value, pl && pl.role === 'hunter' ? pl : null);
    save(); notify(g.code);
    return sendJSON(res, 200, { ok: true });
  }

  if (rest === 'ability' && m === 'POST') {
    if (!pl) throw new HttpError(403, 'Nur für Spieler');
    const b = await readJSON(req);
    useAbility(g, pl, String(b.key || ''), b.targetId);
    save(); notify(g.code);
    return sendJSON(res, 200, { ok: true });
  }

  if (rest === 'pickup' && m === 'POST') {
    if (!pl) throw new HttpError(403, 'Nur für Spieler');
    if (g.status !== 'running') throw new HttpError(409, 'Das Spiel läuft gerade nicht');
    if (pl.caught) throw new HttpError(409, 'Du bist gefangen');
    if (pl.role === 'hunter' && frozenUntil(g, pl.id, Date.now()) > Date.now()) throw new HttpError(409, 'Du bist eingefroren');
    const b = await readJSON(req);
    const pu = g.pickups.find((x) => x.id === b.id && !x.takenBy && x.until > Date.now());
    if (!pu) throw new HttpError(404, 'Hier liegt nichts (mehr)');
    // Aktuelle Position mitschicken: wird geprüft und gespeichert
    if (b.lat !== undefined) {
      const { lat, lng, acc, mock } = parseLoc(b);
      await vpnGate(req, g, pl);
      acceptLocation(g, pl, lat, lng, acc, mock);
    }
    const me = pl.lastLoc;
    if (!me || Date.now() - me.ts > 60000) throw new HttpError(409, 'Deine Position ist zu alt. Warte auf GPS.');
    const d = haversine(me.lat, me.lng, pu.lat, pu.lng);
    const reach = g.settings.pickupCollectM + Math.min(me.acc || 0, 25);
    if (d > reach) throw new HttpError(409, `Noch ${Math.round(d - reach)} m – komm näher heran!`);
    if (pu.drop && pu.activeAt > Date.now()) throw new HttpError(409, `Der Abwurf landet erst in ${Math.ceil((pu.activeAt - Date.now()) / 1000)} s`);
    const n = pu.drop ? g.settings.supplyDropAbilities : 1;
    const gotAll = [];
    for (let i = 0; i < n; i++) { const k = grantRandomAbility(g, pl, pu.drop ? `Versorgungsabwurf bei ${pu.name}` : `eingesammelt bei ${pu.name}`); if (k) gotAll.push(k); }
    const got = gotAll[0];
    if (!got) throw new HttpError(409, 'Für dein Team gibt es keine Fähigkeiten zum Einsammeln');
    pu.takenBy = pl.id; pu.takenAt = Date.now();
    award(pl, 'pickups', POINTS.pickup * (pu.drop ? 3 : 1));
    completeQuestsOfKind(g, pl, 'pickup');
    pushMsg(g, pu.drop ? `📦 ${pl.name} hat den Versorgungsabwurf bei „${pu.name}“ geschnappt!` : `🎁 ${pl.name} hat eine Fähigkeit bei „${pu.name}“ eingesammelt.`);
    save(); notify(g.code);
    return sendJSON(res, 200, { ok: true, ability: got, abilities: gotAll });
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
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://tile.openstreetmap.org https://*.tile.openstreetmap.org",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
].join('; ');

// Android-App-Links: Einladungslinks /g/CODE öffnen direkt die App, wenn deren Signatur-Fingerabdruck
// (SHA-256, mehrere mit Komma getrennt) in ANDROID_CERT_SHA256 steht.
const ANDROID_PACKAGE = process.env.ANDROID_PACKAGE || 'eu.nebendahl.manhunt';
const ANDROID_CERTS = String(process.env.ANDROID_CERT_SHA256 || '').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);

async function serveStatic(req, res, url) {
  if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Methode nicht erlaubt');
  if (url.pathname === '/.well-known/assetlinks.json') {
    if (!ANDROID_CERTS.length) throw new HttpError(404, 'Nicht gefunden');
    return sendJSON(res, 200, [{
      relation: ['delegate_permission/common.handle_all_urls'],
      target: { namespace: 'android_app', package_name: ANDROID_PACKAGE, sha256_cert_fingerprints: ANDROID_CERTS },
    }]);
  }
  let p = decodeURIComponent(url.pathname);
  if (p === '/') p = '/index.html';
  else if (p === '/admin') p = '/admin.html';
  else if (p === '/gallery' || p === '/galerie') p = '/gallery.html';
  else if (p === '/leaderboard' || p === '/bestenliste') p = '/leaderboard.html';
  else if (p === '/profile' || p === '/profil') p = '/profile.html';
  else if (p === '/datenschutz' || p === '/privacy') p = '/datenschutz.html';
  else if (p === '/impressum' || p === '/imprint') p = '/impressum.html';
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
  res.setHeader('Permissions-Policy', 'geolocation=(self), camera=(self), microphone=(self)');
  res.setHeader('Content-Security-Policy', CSP);
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) await handleApi(req, res, url);
    else await serveStatic(req, res, url);
  } catch (e) {
    if (res.headersSent) return res.end();
    if (e instanceof HttpError) {
      if (req.url.startsWith('/api/')) return sendJSON(res, e.status, { error: e.message, ...(e.data || {}) });
      res.writeHead(e.status, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end(e.message);
    }
    console.error(e);
    sendJSON(res, 500, { error: 'Serverfehler' });
  }
});
server.listen(PORT, HOST, () => console.log(`[manhunt] läuft auf http://${HOST}:${PORT}  (Daten: ${DATA_DIR}, Mail: ${smtp.enabled() ? 'SMTP' : 'nur Log'})`));
