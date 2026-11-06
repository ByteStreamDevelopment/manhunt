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

  async function api(path, { method = 'GET', body, token, contentType } = {}) {
    const headers = {};
    if (token) headers['x-token'] = token;
    let payload;
    if (body instanceof Blob) { payload = body; headers['content-type'] = contentType || body.type; }
    else if (body !== undefined) { payload = JSON.stringify(body); headers['content-type'] = 'application/json'; }
    let res;
    try { res = await fetch(path, { method, headers, body: payload }); }
    catch { const e = new Error('Keine Verbindung zum Server'); e.status = 0; throw e; }
    let data = {};
    try { data = await res.json(); } catch { /* leer */ }
    if (!res.ok) { const e = new Error(data.error || `Fehler ${res.status}`); e.status = res.status; throw e; }
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

  return { $, h, api, dur, ago, clock, toast };
})();
