'use strict';
/* Gemeinsame Helfer für alle Seiten */
window.MH = (() => {
  const $ = (sel, root = document) => root.querySelector(sel);

  function h(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === false || v == null) continue;
      if (k === 'class') e.className = v;
      else if (k === 'text') e.textContent = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else if (v === true) e.setAttribute(k, '');
      else e.setAttribute(k, v);
    }
    for (const kid of kids.flat(Infinity)) {
      if (kid == null || kid === false) continue;
      e.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
    return e;
  }

  /* Account (Anmeldung bleibt auf diesem Gerät gespeichert) */
  const ACC = 'manhunt:account';
  const account = {
    get() { try { return JSON.parse(localStorage.getItem(ACC)); } catch { return null; } },
    set(v) { if (v) localStorage.setItem(ACC, JSON.stringify(v)); else localStorage.removeItem(ACC); },
    token() { const a = account.get(); return a && a.token; },
  };

  /** Grund für eine Meldung abfragen (null = abgebrochen) */
  const REPORT_REASONS = ['Unangemessen', 'Privatsphäre', 'Beleidigung', 'Schummeln', 'Spam', 'Sonstiges'];
  function askReport(what) {
    const n = prompt(`${what} melden – warum?\n${REPORT_REASONS.map((r, i) => `${i + 1} = ${r}`).join('\n')}\n\nZahl eingeben:`, '1');
    if (n === null) return null;
    const reason = REPORT_REASONS[Number(n) - 1] || 'Sonstiges';
    const note = prompt('Optional: kurze Beschreibung für die Admins', '') ?? '';
    return { reason, note };
  }
  async function api(path, { method = 'GET', body, token, contentType, acc } = {}) {
    const headers = {};
    if (token) headers['x-token'] = token;
    if (acc) headers['x-account'] = acc;
    let payload;
    if (body instanceof Blob) { payload = body; headers['content-type'] = contentType || body.type; }
    else if (body !== undefined) { payload = JSON.stringify(body); headers['content-type'] = 'application/json'; }
    let res;
    try { res = await fetch(path, { method, headers, body: payload }); }
    catch { const e = new Error('Keine Verbindung zum Server'); e.status = 0; throw e; }
    let data = {};
    try { data = await res.json(); } catch { /* leer */ }
    if (!res.ok) { const e = new Error(data.error || `Fehler ${res.status}`); e.status = res.status; e.data = data; throw e; }
    return data;
  }

  const pad = (n) => String(n).padStart(2, '0');
  function dur(ms) {
    ms = Math.max(0, Math.round(ms / 1000));
    const hh = Math.floor(ms / 3600), mm = Math.floor((ms % 3600) / 60), ss = ms % 60;
    return hh ? `${hh}:${pad(mm)}:${pad(ss)}` : `${pad(mm)}:${pad(ss)}`;
  }
  function ago(ms) {
    const s = Math.max(0, Math.round(ms / 1000));
    if (s < 60) return `vor ${s} s`;
    if (s < 3600) return `vor ${Math.round(s / 60)} min`;
    return `vor ${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min`;
  }
  const clock = (ts) => new Date(ts).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });

  function toast(text, ms = 3500) {
    let box = $('#toasts');
    if (!box) { box = h('div', { id: 'toasts', 'aria-live': 'polite' }); document.body.append(box); }
    const t = h('div', { class: 'toast', text });
    box.append(t);
    while (box.children.length > 3) box.firstChild.remove();
    setTimeout(() => t.remove(), ms);
  }

  /* ---------------- Web-App (PWA) und Push ---------------- */
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const pushSupported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

  /** Push für den angemeldeten Account einschalten. Gibt eine Meldung zurück. */
  async function enablePush() {
    const acc = account.token();
    if (!acc) return 'Bitte zuerst anmelden.';
    if (isIos && !standalone) return 'Auf dem iPhone gehen Benachrichtigungen nur in der installierten Web-App: Teilen → „Zum Home-Bildschirm“, dann Manhunt vom Home-Bildschirm öffnen.';
    if (!pushSupported) return 'Dieser Browser unterstützt keine Benachrichtigungen.';
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') return 'Benachrichtigungen wurden nicht erlaubt.';
    const reg = await navigator.serviceWorker.ready;
    const { key } = await api('/api/push/key');
    const sub = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({
      userVisibleOnly: true, applicationServerKey: Uint8Array.from(atob(key.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)),
    });
    await api('/api/push/subscribe', { method: 'POST', acc, body: { subscription: sub.toJSON() } });
    localStorage.setItem('manhunt:push', '1');
    return null;
  }
  const pushEnabled = () => pushSupported && Notification.permission === 'granted' && localStorage.getItem('manhunt:push') === '1';

  /** Karte „Benachrichtigungen“ bzw. „Zum Home-Bildschirm“ (nur wenn sinnvoll). */
  function pushCard() {
    if (!account.token() || pushEnabled()) return null;
    const msg = h('p', { class: 'small' });
    const iosHint = isIos && !standalone;
    return h('div', { class: 'card gold stack' },
      h('h3', {}, iosHint ? '📲 Als App installieren' : '🔔 Benachrichtigungen'),
      h('p', {}, iosHint
        ? 'Tippe unten auf „Teilen“ und dann „Zum Home-Bildschirm“. Danach Manhunt vom Home-Bildschirm öffnen – dann bekommst du Benachrichtigungen (ab iOS 16.4).'
        : 'Bekomme Einladungen, Durchsagen, Chat und Spielereignisse auch, wenn die Seite zu ist.'),
      !iosHint && h('button', { class: 'btn', onclick: async (e) => {
        e.target.disabled = true;
        try { const m = await enablePush(); msg.textContent = m || 'Benachrichtigungen sind an ✅'; } catch (x) { msg.textContent = x.message; }
        e.target.disabled = false;
      } }, 'Benachrichtigungen einschalten'),
      msg);
  }

  return { $, h, api, dur, ago, clock, toast, account, enablePush, pushCard, isIos, standalone, askReport };
})();
