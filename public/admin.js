'use strict';
(() => {
  const { $, h, api, toast } = MH;
  const KEY = 'manhunt:admin';
  let token = localStorage.getItem(KEY);

  /* Alle Einstellungen. Jedes Feature lässt sich hier an- oder ausschalten. */
  const FIELDS = [
    { group: 'Standort', items: [
      { k: 'locationIntervalSec', t: 'num', label: 'Standort-Intervall (Sekunden)', hint: 'So oft wird der Standort der Runner aktualisiert. 120 = alle 2 Minuten.' },
      { k: 'headStartMin', t: 'num', label: 'Vorsprung für Runner (Minuten)', hint: 'Hunter sehen die Runner erst nach dieser Zeit. 0 = aus.' },
      { k: 'fuzzMeters', t: 'num', label: 'Standort verwischen (Meter)', hint: 'Hunter sehen die Runner nur ungefähr, um bis zu X Meter versetzt. 0 = aus. Nach Spielende wird alles exakt gezeigt.' },
      { k: 'showTrail', t: 'bool', label: 'Spur der bisherigen Route anzeigen' },
      { k: 'showDistance', t: 'bool', label: 'Hunter sehen Entfernung und Richtung zum nächsten Runner' },
      { k: 'runnersVisibleToRunners', t: 'bool', label: 'Runner sehen sich gegenseitig auf der Karte' },
      { k: 'huntersVisibleToHunters', t: 'bool', label: 'Hunter sehen sich gegenseitig auf der Karte' },
      { k: 'huntersVisibleToRunners', t: 'bool', label: 'Runner sehen die Hunter auf der Karte' },
    ] },
    { group: 'Fotos', items: [
      { k: 'photosEnabled', t: 'bool', label: 'Regelmäßige Foto-Aufforderung für Runner' },
      { k: 'photoIntervalMin', t: 'num', label: 'Foto-Intervall (Minuten)', hint: 'Runner bekommen Alarm und müssen ein Foto hochladen.' },
    ] },
    { group: 'Spielende', items: [
      { k: 'caughtEnabled', t: 'bool', label: '„Gefangen“-Funktion (Hunter markieren Runner als gefangen)' },
      { k: 'autoEndWhenAllCaught', t: 'bool', label: 'Spiel endet, sobald alle Runner gefangen sind' },
      { k: 'autoEndAfterMin', t: 'num', label: 'Spiel endet automatisch nach (Minuten)', hint: '0 = kein Zeitlimit. Bei Zeitablauf gewinnen die Runner.' },
    ] },
    { group: 'Spielzone', items: [
      { k: 'zoneEnabled', t: 'bool', label: 'Spielzone als Kreis auf der Karte, Warnung beim Verlassen' },
      { k: 'zoneLat', t: 'num', step: 'any', label: 'Mittelpunkt: Breitengrad' },
      { k: 'zoneLng', t: 'num', step: 'any', label: 'Mittelpunkt: Längengrad' },
      { k: 'zoneRadiusM', t: 'num', label: 'Radius (Meter)' },
      { k: '_here', t: 'button', label: 'Meinen aktuellen Standort als Mittelpunkt übernehmen' },
    ] },
  ];
  const DEFAULTS = {
    locationIntervalSec: 120, headStartMin: 0, autoEndAfterMin: 0, showTrail: true, fuzzMeters: 0,
    huntersVisibleToHunters: true, huntersVisibleToRunners: false, runnersVisibleToRunners: true, showDistance: true,
    photosEnabled: true, photoIntervalMin: 15, caughtEnabled: true, autoEndWhenAllCaught: true,
    zoneEnabled: false, zoneLat: 0, zoneLng: 0, zoneRadiusM: 1000,
  };

  let uid = 0;
  function settingsForm(values) {
    const inputs = {};
    const root = h('div', { class: 'stack' });
    for (const g of FIELDS) {
      const box = h('div', { class: 'fields' }, h('h3', {}, g.group));
      for (const f of g.items) {
        const id = `f${++uid}`;
        if (f.t === 'bool') {
          const i = h('input', { type: 'checkbox', id, checked: !!values[f.k] });
          inputs[f.k] = i;
          box.append(h('div', { class: 'field-bool' }, i, h('div', {}, h('label', { for: id }, f.label), f.hint && h('div', { class: 'hint' }, f.hint))));
        } else if (f.t === 'num') {
          const i = h('input', { type: 'number', id, value: values[f.k], step: f.step || '1', inputmode: 'decimal' });
          inputs[f.k] = i;
          box.append(h('div', { class: 'field-num' }, h('label', { for: id }, f.label), i, f.hint && h('div', { class: 'hint' }, f.hint)));
        } else if (f.t === 'button') {
          box.append(h('button', {
            class: 'btn small light', type: 'button', onclick: () => {
              navigator.geolocation.getCurrentPosition((p) => {
                inputs.zoneLat.value = p.coords.latitude.toFixed(6); inputs.zoneLng.value = p.coords.longitude.toFixed(6);
                inputs.zoneEnabled.checked = true;
              }, () => toast('Standort nicht verfügbar. Bitte Koordinaten von Hand eintragen.'), { enableHighAccuracy: true, timeout: 15000 });
            },
          }, f.label));
        }
      }
      root.append(box);
    }
    const read = () => {
      const out = {};
      for (const [k, i] of Object.entries(inputs)) out[k] = i.type === 'checkbox' ? i.checked : Number(i.value);
      return out;
    };
    return { el: root, read };
  }

  /* --- Anmeldung --- */
  function showLogin() { $('#login').hidden = false; $('#dash').hidden = true; $('#logout').hidden = true; }
  async function login() {
    $('#loginErr').textContent = '';
    try {
      const r = await api('/api/admin/login', { method: 'POST', body: { password: $('#pw').value } });
      token = r.token; localStorage.setItem(KEY, token); $('#pw').value = ''; start();
    } catch (e) { $('#loginErr').textContent = e.message; }
  }
  $('#loginBtn').addEventListener('click', login);
  $('#pw').addEventListener('keydown', (e) => { if (e.key === 'Enter') login(); });
  $('#logout').addEventListener('click', () => { localStorage.removeItem(KEY); token = null; showLogin(); });

  /* --- Neues Spiel --- */
  const newForm = settingsForm(DEFAULTS);
  $('#newForm').append(newForm.el);
  $('#createBtn').addEventListener('click', async () => {
    $('#newErr').textContent = '';
    try {
      await api('/api/admin/games', { method: 'POST', token, body: { name: $('#newName').value, settings: newForm.read() } });
      $('#newWrap').open = false; toast('Spiel angelegt'); load();
    } catch (e) { $('#newErr').textContent = e.message; }
  });

  /* --- Spieleliste --- */
  const STATUS = { lobby: 'Wartet auf Start', running: 'Läuft', ended: 'Beendet' };
  const openEdit = new Set();

  async function act(code, action, body = {}) {
    try { await api(`/api/admin/games/${code}/${action}`, { method: 'POST', token, body }); load(); }
    catch (e) { toast(e.message); }
  }

  function gameCard(g) {
    const link = `${location.origin}/g/${g.code}`;
    const card = h('article', { class: 'card gamecard stack' });
    card.append(
      h('div', { class: 'row between' },
        h('h3', {}, `${g.name} `, h('span', { class: 'code' }, g.code)),
        h('span', { class: `chip ${g.status === 'running' ? 'runner' : g.status === 'ended' ? 'plain' : 'gold'}` }, STATUS[g.status])),
      h('p', { class: 'small muted' }, `${g.runners} Runner, ${g.hunters} Hunter, ${g.caught} gefangen, ${g.photos} Fotos`),
      h('div', { class: 'row' },
        h('input', { type: 'text', readonly: true, value: link, 'aria-label': 'Einladungslink', class: 'grow' }),
        h('button', { class: 'btn small light', onclick: async () => { try { await navigator.clipboard.writeText(link); toast('Link kopiert'); } catch { toast('Bitte den Link von Hand kopieren'); } } }, 'Link kopieren')),
    );
    const actions = h('div', { class: 'row' }, h('a', { class: 'btn small', href: `/g/${g.code}?admin=1` }, 'Live-Karte'));
    if (g.status === 'lobby') actions.append(h('button', { class: 'btn small runner', onclick: () => act(g.code, 'start') }, 'Spiel starten'));
    if (g.status === 'running') actions.append(h('button', { class: 'btn small hunter', onclick: () => confirm('Spiel jetzt beenden?') && act(g.code, 'end') }, 'Spiel beenden'));
    actions.append(
      h('button', { class: 'btn small light', onclick: () => { const t = prompt('Nachricht an alle Spieler:'); if (t) act(g.code, 'announce', { text: t }); } }, 'Nachricht senden'),
      h('button', { class: 'btn small light', onclick: () => { openEdit.has(g.code) ? openEdit.delete(g.code) : openEdit.add(g.code); load(); } }, 'Einstellungen'),
      h('button', { class: 'btn small light', onclick: () => confirm('Alle Positionen, Fotos und Nachrichten löschen und zurück in die Lobby?') && act(g.code, 'reset') }, 'Zurücksetzen'),
      h('button', {
        class: 'btn small light', onclick: async () => {
          if (!confirm(`Spiel „${g.name}“ samt Fotos endgültig löschen?`)) return;
          try { await api(`/api/admin/games/${g.code}`, { method: 'DELETE', token }); openEdit.delete(g.code); load(); } catch (e) { toast(e.message); }
        },
      }, 'Löschen'),
    );
    card.append(actions);
    if (openEdit.has(g.code)) {
      const form = settingsForm(g.settings);
      const name = h('input', { type: 'text', value: g.name, maxlength: '40' });
      card.append(
        h('hr'), h('div', {}, h('label', {}, 'Name'), name), form.el,
        h('button', {
          class: 'btn', onclick: async () => {
            try { await api(`/api/admin/games/${g.code}`, { method: 'PATCH', token, body: { name: name.value, settings: form.read() } }); openEdit.delete(g.code); toast('Gespeichert'); load(); } catch (e) { toast(e.message); }
          },
        }, 'Einstellungen speichern'),
      );
    }
    return card;
  }

  let loading = false;
  async function load() {
    if (loading || !token) return;
    loading = true;
    try {
      const { games } = await api('/api/admin/games', { token });
      const box = $('#games'); box.replaceChildren();
      if (!games.length) box.append(h('div', { class: 'card' }, h('p', {}, 'Noch kein Spiel angelegt. Lege oben dein erstes Spiel an.')));
      else box.append(...games.map(gameCard));
    } catch (e) {
      if (e.status === 401) { localStorage.removeItem(KEY); token = null; showLogin(); }
      else toast(e.message);
    } finally { loading = false; }
  }

  function start() {
    $('#login').hidden = true; $('#dash').hidden = false; $('#logout').hidden = false; load();
  }
  if (token) start(); else showLogin();
  setInterval(() => { if (!document.hidden && !document.querySelector('#games input:focus, #games details[open]') && !openEdit.size) load(); }, 10000);
})();
