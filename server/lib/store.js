'use strict';
/**
 * Datenspeicher auf SQLite (in Node.js ab 22 eingebaut, keine Abhängigkeit).
 *
 * Spiele, Accounts und Einstellungen liegen als JSON-Zeilen in eigenen Tabellen; geschrieben wird nur,
 * was sich geändert hat. Standorte (der größte Teil der Daten) liegen in einer eigenen Tabelle und werden
 * nur angehängt statt jedes Mal komplett neu geschrieben.
 * Eine alte db.json wird beim ersten Start automatisch übernommen.
 */
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');

class Store {
  constructor(file) {
    this.db = new DatabaseSync(file);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS games (code TEXT PRIMARY KEY, json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY, json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS locations (
        id INTEGER PRIMARY KEY AUTOINCREMENT, game TEXT NOT NULL, pid TEXT NOT NULL,
        lat REAL NOT NULL, lng REAL NOT NULL, acc REAL NOT NULL, ts INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS loc_game ON locations (game, ts);
    `);
    this.q = {
      kvGet: this.db.prepare('SELECT v FROM kv WHERE k = ?'),
      kvSet: this.db.prepare('INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v'),
      gameSet: this.db.prepare('INSERT INTO games (code, json) VALUES (?, ?) ON CONFLICT(code) DO UPDATE SET json = excluded.json'),
      gameDel: this.db.prepare('DELETE FROM games WHERE code = ?'),
      accSet: this.db.prepare('INSERT INTO accounts (id, json) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET json = excluded.json'),
      accDel: this.db.prepare('DELETE FROM accounts WHERE id = ?'),
      locAdd: this.db.prepare('INSERT INTO locations (game, pid, lat, lng, acc, ts) VALUES (?, ?, ?, ?, ?, ?)'),
      locDelGame: this.db.prepare('DELETE FROM locations WHERE game = ?'),
      locDelPid: this.db.prepare('DELETE FROM locations WHERE game = ? AND pid = ?'),
      locTrim: this.db.prepare('DELETE FROM locations WHERE game = ? AND ts < ?'),
    };
    this.written = new Map(); // "g:CODE" / "a:ID" / "kv:KEY" -> zuletzt geschriebenes JSON
  }

  /** Alles laden. Gibt { secret, gallery, games, accounts } zurück. */
  load() {
    const games = {}, accounts = {};
    for (const r of this.db.prepare('SELECT code, json FROM games').all()) {
      games[r.code] = JSON.parse(r.json); games[r.code].locations = [];
      this.written.set('g:' + r.code, r.json);
    }
    for (const r of this.db.prepare('SELECT game, pid, lat, lng, acc, ts FROM locations ORDER BY id').iterate()) {
      const g = games[r.game];
      if (g) g.locations.push({ pid: r.pid, lat: r.lat, lng: r.lng, acc: r.acc, ts: r.ts });
    }
    for (const r of this.db.prepare('SELECT id, json FROM accounts').all()) {
      accounts[r.id] = JSON.parse(r.json);
      this.written.set('a:' + r.id, r.json);
    }
    const kv = (k, def) => { const r = this.q.kvGet.get(k); if (r) this.written.set('kv:' + k, r.v); return r ? JSON.parse(r.v) : def; };
    return { secret: kv('secret', ''), gallery: kv('gallery', []), vapid: kv('vapid', null), games, accounts };
  }

  /** Übernimmt eine alte db.json (nur wenn die Datenbank noch leer ist). */
  migrateJson(file) {
    if (!fs.existsSync(file)) return false;
    const empty = !this.db.prepare('SELECT 1 FROM games LIMIT 1').get() && !this.db.prepare('SELECT 1 FROM accounts LIMIT 1').get();
    if (!empty) return false;
    const old = JSON.parse(fs.readFileSync(file, 'utf8'));
    this.db.exec('BEGIN');
    try {
      for (const g of Object.values(old.games || {})) {
        for (const l of g.locations || []) this.q.locAdd.run(g.code, l.pid, l.lat, l.lng, l.acc || 0, l.ts);
        const { locations, ...rest } = g;
        this.q.gameSet.run(g.code, JSON.stringify(rest));
      }
      for (const a of Object.values(old.accounts || {})) this.q.accSet.run(a.id, JSON.stringify(a));
      if (old.secret) this.q.kvSet.run('secret', JSON.stringify(old.secret));
      this.q.kvSet.run('gallery', JSON.stringify(old.gallery || []));
      this.db.exec('COMMIT');
    } catch (e) { this.db.exec('ROLLBACK'); throw e; }
    fs.renameSync(file, file + '.migrated');
    return true;
  }

  /** Schreibt alles, was sich seit dem letzten Mal geändert hat, in einer Transaktion. */
  flush({ secret, gallery, vapid, games, accounts }) {
    const skip = (k, v) => (k === 'locations' || k.startsWith('_') ? undefined : v);
    const writes = [];
    const seenG = new Set(), seenA = new Set();
    for (const g of Object.values(games)) {
      const j = JSON.stringify(g, skip); seenG.add(g.code);
      if (this.written.get('g:' + g.code) !== j) writes.push(() => { this.q.gameSet.run(g.code, j); this.written.set('g:' + g.code, j); });
    }
    for (const a of Object.values(accounts)) {
      const j = JSON.stringify(a); seenA.add(a.id);
      if (this.written.get('a:' + a.id) !== j) writes.push(() => { this.q.accSet.run(a.id, j); this.written.set('a:' + a.id, j); });
    }
    for (const key of [...this.written.keys()]) {
      if (key.startsWith('g:') && !seenG.has(key.slice(2))) writes.push(() => { this.q.gameDel.run(key.slice(2)); this.q.locDelGame.run(key.slice(2)); this.written.delete(key); });
      if (key.startsWith('a:') && !seenA.has(key.slice(2))) writes.push(() => { this.q.accDel.run(key.slice(2)); this.written.delete(key); });
    }
    for (const [k, v] of [['secret', secret], ['gallery', gallery], ['vapid', vapid || null]]) {
      const j = JSON.stringify(v);
      if (this.written.get('kv:' + k) !== j) writes.push(() => { this.q.kvSet.run(k, j); this.written.set('kv:' + k, j); });
    }
    if (!writes.length) return 0;
    this.db.exec('BEGIN');
    try { for (const w of writes) w(); this.db.exec('COMMIT'); } catch (e) { this.db.exec('ROLLBACK'); throw e; }
    return writes.length;
  }

  addLocation(code, l) { this.q.locAdd.run(code, l.pid, l.lat, l.lng, l.acc, l.ts); }
  deleteLocations(code, pid) { if (pid) this.q.locDelPid.run(code, pid); else this.q.locDelGame.run(code); }
  trimLocations(code, beforeTs) { this.q.locTrim.run(code, beforeTs); }
  close() { this.db.close(); }
}

module.exports = { Store };
