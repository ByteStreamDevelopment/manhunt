'use strict';
/**
 * Profile, Spielverlauf, Saisons (monatliche Bestenliste), Freunde, Einladungen und Web-Push-Abos.
 * Bekommt die gemeinsamen Helfer des Servers über ctx, damit dieses Modul keine eigene Datenhaltung braucht.
 */
const webpush = require('./webpush');

/** Saison = Kalendermonat (deutsche Zeit), z. B. "2026-11". */
function seasonKey(ts = Date.now()) {
  const d = new Date(ts);
  const parts = new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit' }).formatToParts(d);
  const y = parts.find((p) => p.type === 'year').value, m = parts.find((p) => p.type === 'month').value;
  return `${y}-${m}`;
}
const SEASON_FIELDS = ['points', 'games', 'wins', 'catches', 'quests', 'pickups', 'surviveMin', 'featured'];
const emptySeason = () => Object.fromEntries(SEASON_FIELDS.map((f) => [f, 0]));
const INVITE_TTL = 24 * 3600e3;
const ONLINE_MS = 5 * 60000;

function createSocial(ctx) {
  const { getDb, save, HttpError, readJSON, sendJSON, accountFromToken, findAccount, isAdminAccount, rateLimit } = ctx;
  const PUBLIC_URL = process.env.PUBLIC_URL || 'https://manhunt.nebendahl.eu';
  const VAPID_SUBJECT = process.env.VAPID_SUBJECT || PUBLIC_URL;

  function vapid() {
    const db = getDb();
    if (!db.vapid) { db.vapid = webpush.generateVapidKeys(); save(); }
    return db.vapid;
  }

  /* ---------------- Saisons ---------------- */
  function seasonAward(a, field, points, amount) {
    const k = seasonKey();
    a.seasons ||= {};
    const s = (a.seasons[k] ||= emptySeason());
    s.points += points;
    if (field && SEASON_FIELDS.includes(field) && field !== 'points') s[field] = (s[field] || 0) + amount;
  }
  function seasonList() {
    const set = new Set([seasonKey()]);
    for (const a of Object.values(getDb().accounts)) for (const k of Object.keys(a.seasons || {})) set.add(k);
    return [...set].sort().reverse();
  }
  function seasonRows(season) {
    return Object.values(getDb().accounts).filter((a) => a.verified && a.seasons && a.seasons[season])
      .map((a) => ({ username: a.username, isAdmin: isAdminAccount(a), ...emptySeason(), ...a.seasons[season], badges: Object.keys(a.badges || {}) }))
      .filter((r) => r.games > 0 || r.points > 0);
  }
  function rankIn(season, username) {
    const rows = seasonRows(season).sort((x, y) => y.points - x.points);
    const i = rows.findIndex((r) => r.username === username);
    return i < 0 ? null : { rank: i + 1, of: rows.length };
  }

  /* ---------------- Spielverlauf ---------------- */
  /** Nach Spielende für jeden Spieler mit Account einen Eintrag anlegen. */
  function recordGame(g, winner) {
    const db = getDb();
    for (const p of Object.values(g.players)) {
      const a = p.accountId && db.accounts[p.accountId];
      if (!a || (p.role !== 'runner' && p.role !== 'hunter')) continue;
      const startRole = p.converted ? 'runner' : p.role;
      const won = (winner === 'hunters' && p.role === 'hunter') || (winner === 'runners' && p.role === 'runner' && !p.caught);
      a.history ||= [];
      a.history.unshift({
        code: g.code, name: g.name, startedAt: g.startedAt, endedAt: g.endedAt,
        role: startRole, converted: !!p.converted, caught: !!(p.caught || p.converted),
        result: winner ? (won ? 'win' : 'loss') : 'none', points: p.points || 0, catches: p.gameCatches || 0,
      });
      if (a.history.length > 50) a.history.length = 50;
    }
  }

  /* ---------------- Push ---------------- */
  const lastPush = new Map();
  /** Benachrichtigung an alle Geräte eines Accounts (im Hintergrund, Fehler werden ignoriert). */
  function notifyAccount(accountId, data) {
    const a = getDb().accounts[accountId];
    if (!a || !a.push || !a.push.length) return;
    // gleiche Art nicht öfter als alle 2 s (z. B. viele Chat-Nachrichten hintereinander)
    const key = accountId + '|' + (data.tag || '');
    if (Date.now() - (lastPush.get(key) || 0) < 2000) return;
    lastPush.set(key, Date.now());
    const jwk = vapid();
    for (const sub of [...a.push]) {
      webpush.send(sub, data, jwk, VAPID_SUBJECT).then((r) => {
        if (r === 'gone') { a.push = a.push.filter((s) => s.endpoint !== sub.endpoint); save(); }
      });
    }
  }

  /* ---------------- Profile ---------------- */
  function profile(a, viewer) {
    const now = Date.now();
    const seasons = Object.keys(a.seasons || {}).sort().reverse().slice(0, 12)
      .map((k) => ({ season: k, ...emptySeason(), ...a.seasons[k], ...(rankIn(k, a.username) || {}) }));
    let friendship = null;
    if (viewer && viewer.id !== a.id) {
      if ((viewer.friends || []).includes(a.id)) friendship = 'friends';
      else if ((viewer.friendOut || []).includes(a.id)) friendship = 'requested';
      else if ((viewer.friendIn || []).includes(a.id)) friendship = 'incoming';
      else friendship = 'none';
    }
    return {
      username: a.username, isAdmin: isAdminAccount(a), createdAt: a.createdAt,
      stats: a.stats, badges: a.badges || {}, history: (a.history || []).slice(0, 30), seasons,
      online: !!(a.lastSeen && now - a.lastSeen < ONLINE_MS), self: !!(viewer && viewer.id === a.id), friendship,
    };
  }

  /* ---------------- Freunde ---------------- */
  const byId = (id) => getDb().accounts[id];
  function friendsView(a) {
    const now = Date.now();
    a.invites = (a.invites || []).filter((i) => now - i.ts < INVITE_TTL);
    const mini = (id) => { const f = byId(id); return f && { username: f.username, online: !!(f.lastSeen && now - f.lastSeen < ONLINE_MS), lastSeen: f.lastSeen || null }; };
    return {
      friends: (a.friends || []).map(mini).filter(Boolean).sort((x, y) => Number(y.online) - Number(x.online) || x.username.localeCompare(y.username)),
      incoming: (a.friendIn || []).map(mini).filter(Boolean),
      outgoing: (a.friendOut || []).map(mini).filter(Boolean),
      invites: a.invites.map(({ id, fromName, code, gameName, ts }) => ({ id, from: fromName, code, gameName, ts })),
    };
  }
  const link = (a, b) => {
    a.friends = [...new Set([...(a.friends || []), b.id])]; b.friends = [...new Set([...(b.friends || []), a.id])];
    a.friendIn = (a.friendIn || []).filter((x) => x !== b.id); a.friendOut = (a.friendOut || []).filter((x) => x !== b.id);
    b.friendIn = (b.friendIn || []).filter((x) => x !== a.id); b.friendOut = (b.friendOut || []).filter((x) => x !== a.id);
  };

  async function handle(req, res, url) {
    const m = req.method, p = url.pathname;
    const db = getDb();
    const me = accountFromToken(req.headers['x-account'] || req.headers['x-token']);
    if (me) me.lastSeen = Date.now();

    if (p === '/api/seasons' && m === 'GET') return sendJSON(res, 200, { current: seasonKey(), seasons: seasonList() });
    const pm = p.match(/^\/api\/profile\/([A-Za-z0-9_.-]{3,20})$/);
    if (pm && m === 'GET') {
      const a = findAccount(pm[1]);
      if (!a || !a.verified) throw new HttpError(404, 'Spieler nicht gefunden');
      return sendJSON(res, 200, profile(a, me));
    }
    if (p === '/api/push/key' && m === 'GET') return sendJSON(res, 200, { key: webpush.vapidPublicKey(vapid()) });

    // Ab hier: angemeldet
    if (!me) throw new HttpError(401, 'Bitte melde dich an');
    if (p === '/api/push/subscribe' && m === 'POST') {
      const b = await readJSON(req);
      if (!webpush.validSubscription(b.subscription)) throw new HttpError(400, 'Ungültiges Abo');
      const s = b.subscription;
      me.push = [{ endpoint: s.endpoint, keys: { p256dh: s.keys.p256dh, auth: s.keys.auth }, ts: Date.now() },
        ...(me.push || []).filter((x) => x.endpoint !== s.endpoint)].slice(0, 5);
      save();
      return sendJSON(res, 200, { ok: true });
    }
    if (p === '/api/push/unsubscribe' && m === 'POST') {
      const b = await readJSON(req);
      me.push = (me.push || []).filter((x) => x.endpoint !== b.endpoint); save();
      return sendJSON(res, 200, { ok: true });
    }
    if (p === '/api/push/test' && m === 'POST') {
      notifyAccount(me.id, { title: 'Manhunt', body: 'Benachrichtigungen funktionieren! 🎉', url: '/', tag: 'test' });
      return sendJSON(res, 200, { ok: true, devices: (me.push || []).length });
    }

    if (p === '/api/friends' && m === 'GET') return sendJSON(res, 200, friendsView(me));
    if (m === 'POST' && p.startsWith('/api/friends/')) {
      rateLimit(req, 'friends', 60, 60000);
      const b = await readJSON(req);
      const act = p.slice('/api/friends/'.length);
      if (act === 'invites/dismiss') {
        me.invites = (me.invites || []).filter((i) => i.id !== b.id); save();
        return sendJSON(res, 200, friendsView(me));
      }
      const other = findAccount(b.username);
      if (!other || !other.verified) throw new HttpError(404, 'Diesen Spieler gibt es nicht');
      if (other.id === me.id) throw new HttpError(400, 'Das bist du selbst 😉');
      if (act === 'request') {
        if ((me.friends || []).includes(other.id)) throw new HttpError(409, 'Ihr seid schon befreundet');
        if ((me.friendIn || []).includes(other.id)) link(me, other); // hat mich schon angefragt -> sofort Freunde
        else {
          me.friendOut = [...new Set([...(me.friendOut || []), other.id])];
          other.friendIn = [...new Set([...(other.friendIn || []), me.id])];
          notifyAccount(other.id, { title: 'Freundschaftsanfrage', body: `${me.username} möchte mit dir befreundet sein.`, url: '/profile', tag: 'friend' });
        }
      } else if (act === 'respond') {
        if (!(me.friendIn || []).includes(other.id)) throw new HttpError(404, 'Keine Anfrage von diesem Spieler');
        if (b.accept) {
          link(me, other);
          notifyAccount(other.id, { title: 'Neue Freundschaft', body: `${me.username} hat deine Anfrage angenommen.`, url: '/profile', tag: 'friend' });
        } else {
          me.friendIn = me.friendIn.filter((x) => x !== other.id);
          other.friendOut = (other.friendOut || []).filter((x) => x !== me.id);
        }
      } else if (act === 'remove') {
        for (const [x, y] of [[me, other], [other, me]]) {
          x.friends = (x.friends || []).filter((id) => id !== y.id);
          x.friendIn = (x.friendIn || []).filter((id) => id !== y.id);
          x.friendOut = (x.friendOut || []).filter((id) => id !== y.id);
        }
      } else if (act === 'invite') {
        if (!(me.friends || []).includes(other.id)) throw new HttpError(403, 'Du kannst nur Freunde einladen');
        const g = db.games[String(b.code || '').toUpperCase()];
        if (!g || g.status === 'ended') throw new HttpError(404, 'Dieses Spiel gibt es nicht (mehr)');
        other.invites = [{ id: Math.random().toString(36).slice(2, 10), from: me.id, fromName: me.username, code: g.code, gameName: g.name, ts: Date.now() },
          ...(other.invites || []).filter((i) => !(i.code === g.code && i.from === me.id))].slice(0, 20);
        notifyAccount(other.id, { title: '🎮 Einladung', body: `${me.username} lädt dich zu „${g.name}“ ein.`, url: `/g/${g.code}`, tag: 'invite', urgent: true });
      } else throw new HttpError(404, 'Unbekannte Aktion');
      save();
      return sendJSON(res, 200, friendsView(me));
    }
    throw new HttpError(404, 'Nicht gefunden');
  }

  return { handle, seasonAward, seasonKey, seasonList, seasonRows, recordGame, notifyAccount, publicUrl: PUBLIC_URL };
}

module.exports = { createSocial, seasonKey };
