'use strict';
(() => {
  const { $, h, api, toast, clock } = MH;
  const KEY = 'manhunt:admin';
  let token = localStorage.getItem(KEY);
  let CAT = null; // Katalog: abilities, quests, defaults

  /* Alle Einstellungen. Jedes Feature lässt sich hier an- oder ausschalten. */
  const FIELDS = [
    { group: 'Standort', items: [
      { k: 'locationIntervalSec', t: 'num', label: 'Standort-Intervall (Sekunden)', hint: 'So oft wird der Standort normal geteilt. 60 = jede Minute.' },
      { k: 'headStartMin', t: 'num', label: 'Vorsprung für Runner (Minuten)', hint: 'Hunter sehen die Runner erst nach dieser Zeit. 0 = aus.' },
      { k: 'fuzzMeters', t: 'num', label: 'Standort verwischen (Meter)', hint: 'Hunter sehen die Runner nur ungefähr, um bis zu X Meter versetzt. 0 = aus.' },
      { k: 'showTrail', t: 'bool', label: 'Spur der bisherigen Route anzeigen' },
      { k: 'showDistance', t: 'bool', label: 'Hunter sehen Entfernung und Richtung zum nächsten Runner' },
      { k: 'runnersVisibleToRunners', t: 'bool', label: 'Runner sehen sich gegenseitig auf der Karte' },
      { k: 'huntersVisibleToHunters', t: 'bool', label: 'Hunter sehen sich gegenseitig auf der Karte' },
      { k: 'huntersVisibleToRunners', t: 'bool', label: 'Runner sehen die Hunter auf der Karte' },
    ] },
    { group: 'Fotos und Live-Strafe', items: [
      { k: 'photosEnabled', t: 'bool', label: 'Regelmäßige Foto-Aufforderung für Runner' },
      { k: 'photoIntervalMin', t: 'num', label: 'Foto-Intervall (Minuten)' },
      { k: 'livePenaltyEnabled', t: 'bool', label: 'Live-Standort als Strafe, wenn das Foto zu spät kommt' },
      { k: 'photoGraceSec', t: 'num', label: 'Schonfrist nach Fälligkeit (Sekunden)', hint: 'Danach wird der Standort des Runners live (exakt, alle paar Sekunden) geteilt.' },
      { k: 'livePenaltyUntil', t: 'select', label: 'Live bis …', options: [['nextRound', 'zum Foto der nächsten Runde'], ['upload', 'zum nächsten hochgeladenen Foto']] },
      { k: 'liveIntervalSec', t: 'num', label: 'Intervall im Live-Modus (Sekunden)', hint: 'Gilt auch für Radar und Peilung.' },
    ] },
    { group: 'Quests', items: [
      { k: 'questsEnabled', t: 'bool', label: 'Quests (Challenges) an' },
      { k: 'questIntervalMin', t: 'num', label: 'Neue Quest alle (Minuten)' },
      { k: 'questMaxActive', t: 'num', label: 'Höchstens gleichzeitig aktive Quests pro Spieler' },
      { k: 'quests', t: 'quests' },
      { k: 'customQuests', t: 'custom' },
    ] },
    { group: 'Fähigkeiten', items: [
      { k: 'abilitiesEnabled', t: 'bool', label: 'Fähigkeiten an' },
      { k: 'adminGiftsEnabled', t: 'bool', label: 'Spielleitung darf Fähigkeiten verschenken', hint: 'Standardmäßig aus. Spielt die Spielleitung selbst mit, ist es immer gesperrt.' },
      { k: 'freezeImmunitySec', t: 'num', label: 'Nach einem Freeze sind Hunter so lange immun (Sekunden)', hint: 'Verhindert Dauer-Freeze durch mehrere Runner hintereinander.' },
      { k: 'abilities', t: 'abilities' },
    ] },
    { group: 'Fähigkeiten auf der Karte (Pickups)', items: [
      { k: 'pickupsEnabled', t: 'bool', label: 'An großen Orten (Supermärkte, Märkte, Bahnhöfe …) tauchen Fähigkeiten zum Einsammeln auf' },
      { k: 'pickupIntervalMin', t: 'num', label: 'Neue alle (Minuten)' },
      { k: 'pickupMax', t: 'num', label: 'Höchstens gleichzeitig' },
      { k: 'pickupSpacingM', t: 'num', label: 'Mindestabstand (Meter)', hint: 'Höchstens eine pro Umkreis. Mindestens 1000 m.' },
      { k: 'pickupCollectM', t: 'num', label: 'Einsammel-Radius (Meter)' },
      { k: 'pickupLifetimeMin', t: 'num', label: 'Liegt so lange (Minuten)' },
      { k: 'pickupSearchM', t: 'num', label: 'Suchradius um die Spielmitte (Meter)' },
      { k: 'pickupRandomFallback', t: 'bool', label: 'Gibt es keine großen Orte, zufällige Punkte verwenden' },
      { k: 'supplyDropsEnabled', t: 'bool', label: '📦 Versorgungsabwürfe: angekündigt, mit mehreren Fähigkeiten – lockt beide Teams an einen Ort' },
      { k: 'supplyDropIntervalMin', t: 'num', label: 'Abwurf alle (Minuten)' },
      { k: 'supplyDropWarnMin', t: 'num', label: 'Ankündigung vorher (Minuten)' },
      { k: 'supplyDropAbilities', t: 'num', label: 'Fähigkeiten pro Abwurf' },
    ] },
    { group: 'Spielende', items: [
      { k: 'caughtEnabled', t: 'bool', label: '„Gefangen“-Funktion (Hunter markieren Runner als gefangen)' },
      { k: 'caughtBecomeHunter', t: 'bool', label: 'Gefangene Runner spielen automatisch als Hunter weiter' },
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
    { group: 'Chat und Zuschauer', items: [
      { k: 'chatEnabled', t: 'bool', label: 'Team-Chat (jedes Team sieht nur seinen eigenen Chat)' },
      { k: 'allChatEnabled', t: 'bool', label: 'Zusätzlich ein Chat für alle (Zuschauer lesen nur mit)' },
      { k: 'voiceEnabled', t: 'bool', label: 'Sprachnachrichten im Team-Chat (wie ein Walkie-Talkie)' },
      { k: 'spectatorsEnabled', t: 'bool', label: 'Zuschauer dürfen beitreten' },
      { k: 'spectatorDelaySec', t: 'num', label: 'Zuschauer sehen alles verzögert um (Sekunden)', hint: 'Damit Zuschauer den Spielern nichts Aktuelles verraten können.' },
    ] },
    { group: 'Anti-Cheat', items: [
      { k: 'antiVpn', t: 'select', label: 'VPN/Proxy', options: [['off', 'nicht prüfen'], ['warn', 'erkennen und Spielleitung warnen'], ['block', 'blockieren']], hint: 'Die App meldet aktive VPNs. Zusätzlich kann der Server IP-Adressen prüfen (VPN_CHECK=ipapi).' },
      { k: 'antiSpoof', t: 'select', label: 'GPS-Fälschung', options: [['off', 'nicht prüfen'], ['warn', 'erkennen und Spielleitung warnen'], ['block', 'verdächtige Positionen ablehnen']], hint: 'Erkennt Fake-GPS-Apps, Teleports und unnatürlich exakte Positionen.' },
      { k: 'maxSpeedKmh', t: 'num', label: 'Verdächtig ab (km/h)' },
    ] },
  ];

  const TEAM = { runner: 'Runner', hunter: 'Hunter', any: 'Beide' };
  let uid = 0;
  function settingsForm(values) {
    const inputs = {}; const nested = {};
    const root = h('div', { class: 'stack' });
    for (const g of FIELDS) {
      const box = h('details', { class: 'fields card' }, h('summary', {}, g.group));
      const inner = h('div', { class: 'fields', style: 'margin-top:.8rem' });
      box.append(inner);
      for (const f of g.items) {
        const id = `f${++uid}`;
        if (f.t === 'bool') {
          const i = h('input', { type: 'checkbox', id, checked: !!values[f.k] });
          inputs[f.k] = i;
          inner.append(h('div', { class: 'field-bool' }, i, h('div', {}, h('label', { for: id }, f.label), f.hint && h('div', { class: 'hint' }, f.hint))));
        } else if (f.t === 'num') {
          const i = h('input', { type: 'number', id, value: values[f.k], step: f.step || '1', inputmode: 'decimal' });
          inputs[f.k] = i;
          inner.append(h('div', { class: 'field-num' }, h('label', { for: id }, f.label), i, f.hint && h('div', { class: 'hint' }, f.hint)));
        } else if (f.t === 'select') {
          const i = h('select', { id }, f.options.map(([v, l]) => h('option', { value: v, selected: values[f.k] === v }, l)));
          inputs[f.k] = i;
          inner.append(h('div', { class: 'field-num wide' }, h('label', { for: id }, f.label), i, f.hint && h('div', { class: 'hint' }, f.hint)));
        } else if (f.t === 'abilities') {
          nested.abilities = {};
          const rows = Object.values(CAT.abilities).map((a) => {
            const v = (values.abilities || {})[a.key] || CAT.defaults.abilities[a.key];
            const en = h('input', { type: 'checkbox', checked: v.enabled, title: 'erlaubt' });
            const st = h('input', { type: 'number', min: '0', max: '20', value: v.start, title: 'zum Start' });
            const ob = h('input', { type: 'checkbox', checked: v.obtainable, title: 'im Spiel erhältlich' });
            const du = a.durationSec ? h('input', { type: 'number', min: '10', max: '3600', value: v.durationSec, title: 'Dauer in Sekunden' }) : null;
            const cd = h('input', { type: 'number', min: '0', max: '3600', value: v.cooldownSec ?? a.cooldownSec ?? 0, title: 'Abklingzeit in Sekunden' });
            nested.abilities[a.key] = { en, st, ob, du, cd };
            return h('tr', {},
              h('td', {}, h('b', {}, `${a.icon} ${a.name}`), h('div', { class: 'hint' }, `${TEAM[a.team]} · ${a.desc}`)),
              h('td', {}, en), h('td', {}, st), h('td', {}, ob), h('td', {}, du || '–'), h('td', {}, cd));
          });
          inner.append(h('div', { class: 'tablewrap' }, h('table', { class: 'cfg' },
            h('thead', {}, h('tr', {}, h('th', {}, 'Fähigkeit'), h('th', {}, 'Erlaubt'), h('th', {}, 'Zum Start'), h('th', {}, 'Im Spiel erhältlich'), h('th', {}, 'Dauer (s)'), h('th', {}, 'Abklingzeit (s)'))),
            h('tbody', {}, rows))));
        } else if (f.t === 'custom') {
          // Eigene Quests: Foto-Quest oder fester Ort
          const list = h('div', { class: 'stack' });
          nested.custom = [];
          const addRow = (q = {}) => {
            const row = { id: q.id };
            const inp = (attrs) => h('input', attrs);
            row.title = inp({ type: 'text', maxlength: '40', value: q.title || '', placeholder: 'Titel, z. B. „Zum Rathaus“' });
            row.desc = inp({ type: 'text', maxlength: '200', value: q.desc || '', placeholder: 'Beschreibung / Aufgabe' });
            row.icon = inp({ type: 'text', maxlength: '4', value: q.icon || '⭐', style: 'width:4rem' });
            row.team = h('select', {}, [['any', 'Alle'], ['runner', 'Runner'], ['hunter', 'Hunter']].map(([v, l]) => h('option', { value: v, selected: (q.team || 'any') === v }, l)));
            row.kind = h('select', {}, [['photo', '📷 Foto-Quest'], ['place', '📍 Ort erreichen']].map(([v, l]) => h('option', { value: v, selected: (q.kind || 'photo') === v }, l)));
            row.minutes = inp({ type: 'number', min: '1', max: '120', value: q.minutes ?? 10, title: 'Minuten' });
            row.points = inp({ type: 'number', min: '0', max: '1000', value: q.points ?? 50, title: 'Punkte' });
            row.reward = h('select', {}, [h('option', { value: 'random' }, 'Zufällige Fähigkeit'), h('option', { value: 'none' }, 'Nur Punkte'),
              ...Object.values(CAT.abilities).map((a) => h('option', { value: a.key }, `${a.icon} ${a.name}`))]);
            row.reward.value = q.reward || 'random';
            row.enabled = inp({ type: 'checkbox', checked: q.enabled !== false });
            row.lat = inp({ type: 'number', step: 'any', value: q.lat ?? '', placeholder: 'Breitengrad' });
            row.lng = inp({ type: 'number', step: 'any', value: q.lng ?? '', placeholder: 'Längengrad' });
            row.radiusM = inp({ type: 'number', min: '15', max: '500', value: q.radiusM ?? 40, title: 'Radius (m)' });
            row.placeName = inp({ type: 'text', maxlength: '60', value: q.placeName || '', placeholder: 'Ortsname (optional)' });
            const place = h('div', { class: 'row' }, row.lat, row.lng, row.radiusM, row.placeName,
              h('button', { class: 'btn small light', type: 'button', onclick: () => navigator.geolocation.getCurrentPosition((p) => {
                row.lat.value = p.coords.latitude.toFixed(6); row.lng.value = p.coords.longitude.toFixed(6);
              }, () => toast('Standort nicht verfügbar'), { enableHighAccuracy: true, timeout: 15000 }) }, '📍 Mein Standort'));
            const syncKind = () => { place.hidden = row.kind.value !== 'place'; };
            row.kind.addEventListener('change', syncKind); syncKind();
            const box = h('div', { class: 'card stack' },
              h('div', { class: 'row' }, row.enabled, row.icon, row.title, h('button', { class: 'btn small light', type: 'button', onclick: () => { box.remove(); nested.custom = nested.custom.filter((x) => x !== row); } }, 'Entfernen')),
              row.desc,
              h('div', { class: 'row' }, row.kind, row.team, h('label', {}, 'Min.', row.minutes), h('label', {}, 'Punkte', row.points), row.reward),
              place);
            nested.custom.push(row);
            list.append(box);
          };
          for (const q of values.customQuests || []) addRow(q);
          inner.append(h('h4', {}, 'Eigene Quests'), h('p', { class: 'hint' }, 'Foto-Quests werden per Foto erfüllt (du kannst sie unter „Fotos“ ablehnen). Ort-Quests sind erfüllt, wenn man den Punkt erreicht.'),
            list, h('button', { class: 'btn small', type: 'button', onclick: () => addRow() }, '➕ Eigene Quest'));
        } else if (f.t === 'quests') {
          nested.quests = {};
          const rewardOpts = (cur, team) => [
            h('option', { value: 'random', selected: cur === 'random' }, 'Zufällige Fähigkeit'),
            h('option', { value: 'none', selected: cur === 'none' }, 'Nur Punkte'),
            ...Object.values(CAT.abilities).filter((a) => a.team === team || a.team === 'any').map((a) => h('option', { value: a.key, selected: cur === a.key }, `${a.icon} ${a.name}`)),
          ];
          const rows = Object.values(CAT.quests).map((q) => {
            const v = (values.quests || {})[q.key] || CAT.defaults.quests[q.key];
            const en = h('input', { type: 'checkbox', checked: v.enabled });
            const mi = h('input', { type: 'number', min: '1', max: '120', value: v.minutes });
            const po = h('input', { type: 'number', min: '0', max: '1000', value: v.points });
            const re = h('select', {}, rewardOpts(v.reward, q.team));
            nested.quests[q.key] = { en, mi, po, re };
            return h('tr', {},
              h('td', {}, h('b', {}, `${q.icon} ${q.title}`), h('div', { class: 'hint' }, `${TEAM[q.team]} · ${q.desc}`)),
              h('td', {}, en), h('td', {}, mi), h('td', {}, po), h('td', {}, re));
          });
          inner.append(h('div', { class: 'tablewrap' }, h('table', { class: 'cfg' },
            h('thead', {}, h('tr', {}, h('th', {}, 'Quest'), h('th', {}, 'Erlaubt'), h('th', {}, 'Zeit (min)'), h('th', {}, 'Punkte'), h('th', {}, 'Belohnung'))),
            h('tbody', {}, rows))));
        } else if (f.t === 'button') {
          inner.append(h('button', {
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
      for (const [k, i] of Object.entries(inputs)) out[k] = i.type === 'checkbox' ? i.checked : i.tagName === 'SELECT' ? i.value : Number(i.value);
      if (nested.abilities) {
        out.abilities = {};
        for (const [k, x] of Object.entries(nested.abilities)) out.abilities[k] = { enabled: x.en.checked, start: Number(x.st.value), obtainable: x.ob.checked, cooldownSec: Number(x.cd.value), ...(x.du ? { durationSec: Number(x.du.value) } : {}) };
      }
      if (nested.custom) {
        out.customQuests = nested.custom.filter((r) => r.title.value.trim()).map((r) => ({
          id: r.id, enabled: r.enabled.checked, title: r.title.value, desc: r.desc.value, icon: r.icon.value || '⭐', team: r.team.value, kind: r.kind.value,
          minutes: Number(r.minutes.value), points: Number(r.points.value), reward: r.reward.value,
          ...(r.kind.value === 'place' ? { lat: Number(r.lat.value), lng: Number(r.lng.value), radiusM: Number(r.radiusM.value), placeName: r.placeName.value } : {}),
        }));
      }
      if (nested.quests) {
        out.quests = {};
        for (const [k, x] of Object.entries(nested.quests)) out.quests[k] = { enabled: x.en.checked, minutes: Number(x.mi.value), points: Number(x.po.value), reward: x.re.value };
      }
      return out;
    };
    return { el: root, read };
  }

  /* --- Anmeldung --- */
  function showLogin() { $('#login').hidden = false; $('#dash').hidden = true; $('#logout').hidden = true; }
  async function login() {
    $('#loginErr').textContent = '';
    try {
      const user = $('#user').value.trim();
      const r = await api('/api/admin/login', { method: 'POST', body: user ? { username: user, password: $('#pw').value } : { password: $('#pw').value } });
      token = r.token; localStorage.setItem(KEY, token); localStorage.setItem(KEY + ':user', r.username || ''); $('#pw').value = ''; start();
    } catch (e) { $('#loginErr').textContent = e.message; }
  }
  $('#loginBtn').addEventListener('click', login);
  $('#pw').addEventListener('keydown', (e) => { if (e.key === 'Enter') login(); });
  $('#logout').addEventListener('click', () => { localStorage.removeItem(KEY); token = null; showLogin(); });
  $('#lbClose').addEventListener('click', () => $('#lightbox').close());

  for (const b of document.querySelectorAll('#dash .tabs button')) {
    b.addEventListener('click', () => {
      for (const x of document.querySelectorAll('#dash .tabs button')) {
        x.setAttribute('aria-selected', String(x === b)); $(`#tab-${x.dataset.tab}`).hidden = x !== b;
      }
      if (b.dataset.tab === 'accounts') loadAccounts();
      if (b.dataset.tab === 'gallery') loadGallery();
    });
  }

  /* --- Spieleliste --- */
  const STATUS = { lobby: 'Wartet auf Start', running: 'Läuft', ended: 'Beendet' };
  const openEdit = new Set(), openPhotos = new Set(), openPlayers = new Set();

  async function act(code, action, body = {}) {
    try { await api(`/api/admin/games/${code}/${action}`, { method: 'POST', token, body }); load(); return true; }
    catch (e) { toast(e.message); return false; }
  }

  function toggle(set, code) { set.has(code) ? set.delete(code) : set.add(code); load(); }

  async function photosBox(g) {
    const box = h('div', { class: 'stack' }, h('p', { class: 'muted' }, 'Lade Fotos …'));
    try {
      const st = await api(`/api/g/${g.code}/state`, { token });
      const names = Object.fromEntries(st.players.map((p) => [p.id, p.name]));
      const list = [...st.photos].sort((a, b) => b.ts - a.ts);
      box.replaceChildren(
        h('div', { class: 'row between' }, h('h3', {}, `Fotos (${list.length}) – mit ⭐ in die Galerie übernehmen`),
          list.length ? h('a', { class: 'btn small light', href: `/api/g/${g.code}/photos.zip?t=${encodeURIComponent(token)}` }, '⬇️ Alle als ZIP') : null),
        list.length ? h('div', { class: 'photos' }, list.map((ph) => {
          const src = `/api/g/${g.code}/photo/${ph.id}?t=${encodeURIComponent(token)}`;
          const quest = ph.quest ? ` · 📜 ${ph.questTitle || (CAT.quests[ph.quest] || {}).title || 'Quest'}` : '';
          const cap = `${names[ph.pid] || '?'}, ${clock(ph.ts)}${quest}`;
          return h('figure', {},
            h('button', { onclick: () => { $('#lbImg').src = src; $('#lbCap').textContent = cap; $('#lightbox').showModal(); } }, h('img', { src, alt: '', loading: 'lazy' })),
            h('figcaption', {}, cap),
            h('button', { class: 'btn small light', title: ph.quest ? 'Quest-Foto ablehnen: Punkte und Belohnung werden zurückgenommen' : 'Foto entfernen', onclick: async () => {
              if (!confirm(ph.quest ? 'Quest-Foto ablehnen? Punkte und Belohnung werden zurückgenommen.' : 'Foto entfernen?')) return;
              if (await act(g.code, 'rejectphoto', { photoId: ph.id })) { toast('Foto abgelehnt'); }
            } }, ph.quest ? '❌ Ablehnen' : '🗑️'),
            ph.featured ? h('span', { class: 'chip gold' }, '⭐ in Galerie')
              : h('button', { class: 'btn small gold', onclick: async () => {
                const caption = prompt('Bildunterschrift (optional):', '') ?? null;
                if (caption === null) return;
                if (await act(g.code, 'feature', { photoId: ph.id, caption })) toast('In die Galerie übernommen');
              } }, '⭐ Galerie'));
        })) : h('p', { class: 'muted' }, 'Noch keine Fotos.'));
    } catch (e) { box.replaceChildren(h('p', { class: 'err' }, e.message)); }
    return box;
  }

  async function playersBox(g) {
    const box = h('div', {}, h('p', { class: 'muted' }, 'Lade Spieler …'));
    try {
      const st = await api(`/api/g/${g.code}/state`, { token });
      const abilitySel = (role) => h('select', {}, Object.values(CAT.abilities).filter((a) => a.team === role || a.team === 'any').map((a) => h('option', { value: a.key }, `${a.icon} ${a.name}`)));
      box.replaceChildren(h('h3', {}, 'Spieler'), h('ul', { class: 'plist' }, st.players.map((p) => {
        const sel = abilitySel(p.role);
        const inv = Object.entries(p.abilities || {}).filter(([, n]) => n > 0).map(([k, n]) => `${CAT.abilities[k]?.icon || ''}${n}`).join(' ');
        const flags = [];
        if (p.flags?.vpn) flags.push(h('span', { class: 'chip hunter', title: p.flags.vpnReason }, 'VPN'));
        if (p.flags?.spoof) flags.push(h('span', { class: 'chip hunter', title: p.flags.spoofReason }, `GPS ⚠ ${p.flags.spoofCount || 1}×`));
        if (p.penalty) flags.push(h('span', { class: 'chip gold' }, 'live (Foto)'));
        return h('li', {},
          h('span', { class: `chip ${p.role}` }, p.role === 'runner' ? 'Runner' : 'Hunter'),
          h('div', { class: 'grow' }, h('div', { class: 'name' }, p.name, p.caught ? ' (gefangen)' : ''),
            h('div', { class: 'small muted' }, `${p.points} Punkte · Fähigkeiten: ${inv || '–'}`, p.flags?.spoofReason ? ` · ${p.flags.spoofReason}` : '')),
          ...flags,
          sel,
          h('button', { class: 'btn small light', onclick: () => act(g.code, 'give', { playerId: p.id, ability: sel.value }) }, 'Schenken'),
          (p.flags?.vpn || p.flags?.spoof) && h('button', { class: 'btn small light', onclick: () => act(g.code, 'clearflags', { playerId: p.id }) }, 'Verdacht löschen'),
          h('button', { class: 'btn small light', onclick: () => confirm(`${p.name} aus dem Spiel entfernen?`) && act(g.code, 'kick', { playerId: p.id }) }, 'Entfernen'));
      })));
    } catch (e) { box.replaceChildren(h('p', { class: 'err' }, e.message)); }
    return box;
  }

  function gameCard(g) {
    const link = `${location.origin}/g/${g.code}`;
    const card = h('article', { class: 'card gamecard stack' });
    card.append(
      h('div', { class: 'row between' },
        h('h3', {}, `${g.name} `, h('span', { class: 'code' }, g.code)),
        h('span', { class: `chip ${g.status === 'running' ? 'runner' : g.status === 'ended' ? 'plain' : 'gold'}` }, STATUS[g.status])),
      g.youPlay ? h('p', { class: 'small' }, h('span', { class: 'chip gold' }, '🎮 Du spielst mit'), ' – Live-Karte, Spieler- und Foto-Verwaltung sind gesperrt, damit es fair bleibt.') : null,
      h('p', { class: 'small muted' }, `${g.runners} Runner, ${g.hunters} Hunter, ${g.caught} gefangen, ${g.spectators || 0} Zuschauer, ${g.photos} Fotos`),
      g.flagged.length ? h('p', { class: 'err small' }, `⚠️ Verdacht: ${g.flagged.map((f) => `${f.name} (${[f.flags.vpn && 'VPN', f.flags.spoof && 'GPS'].filter(Boolean).join(', ')})`).join(', ')}`) : null,
      h('div', { class: 'row' },
        h('input', { type: 'text', readonly: true, value: link, 'aria-label': 'Einladungslink', class: 'grow' }),
        h('button', { class: 'btn small light', onclick: async () => { try { await navigator.clipboard.writeText(link); toast('Link kopiert'); } catch { toast('Bitte den Link von Hand kopieren'); } } }, 'Link kopieren')),
    );
    const actions = h('div', { class: 'row' }, h('a', { class: 'btn small', href: `/g/${g.code}?admin=1` }, 'Live-Karte'));
    if (g.status === 'lobby') actions.append(h('button', { class: 'btn small runner', onclick: () => act(g.code, 'start') }, 'Spiel starten'));
    if (g.status === 'running') actions.append(h('button', { class: 'btn small hunter', onclick: () => confirm('Spiel jetzt beenden?') && act(g.code, 'end') }, 'Spiel beenden'));
    actions.append(
      h('button', { class: 'btn small light', onclick: () => { const t = prompt('Nachricht an alle Spieler:'); if (t) act(g.code, 'announce', { text: t }); } }, 'Nachricht senden'),
      h('button', { class: 'btn small light', onclick: () => toggle(openPlayers, g.code) }, 'Spieler'),
      h('button', { class: 'btn small light', onclick: () => toggle(openPhotos, g.code) }, 'Fotos'),
      h('button', { class: 'btn small light', onclick: () => toggle(openEdit, g.code) }, 'Einstellungen'),
      h('button', { class: 'btn small light', onclick: () => confirm('Alle Positionen, Fotos, Fähigkeiten und Nachrichten löschen und zurück in die Lobby?') && act(g.code, 'reset') }, 'Zurücksetzen'),
      h('button', {
        class: 'btn small light', onclick: async () => {
          if (!confirm(`Spiel „${g.name}“ samt Fotos endgültig löschen?`)) return;
          try { await api(`/api/admin/games/${g.code}`, { method: 'DELETE', token }); openEdit.delete(g.code); load(); } catch (e) { toast(e.message); }
        },
      }, 'Löschen'),
    );
    card.append(actions);
    if (openPlayers.has(g.code)) { const slot = h('div'); card.append(h('hr'), slot); playersBox(g).then((b) => slot.replaceWith(b)); }
    if (openPhotos.has(g.code)) { const slot = h('div'); card.append(h('hr'), slot); photosBox(g).then((b) => slot.replaceWith(b)); }
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

  /* --- Accounts --- */
  async function loadAccounts() {
    const box = $('#tab-accounts');
    try {
      const { accounts } = await api('/api/admin/accounts', { token });
      box.replaceChildren(h('div', { class: 'card' },
        h('h2', {}, `Accounts (${accounts.length})`),
        !CAT.mailConfigured && h('p', { class: 'err small' }, 'Kein SMTP-Server eingerichtet: Bestätigungscodes stehen nur im Server-Log. Du kannst Accounts hier auch von Hand bestätigen.'),
        h('ul', { class: 'plist' }, accounts.map((a) => h('li', {},
          h('div', { class: 'grow' }, h('div', { class: 'name' }, a.username, a.isAdmin ? ' 👑' : ''),
            h('div', { class: 'small muted' }, `${a.email} · ${a.stats.points} Punkte · ${a.stats.games} Spiele`)),
          a.verified ? h('span', { class: 'chip runner' }, 'bestätigt') : h('button', { class: 'btn small light', onclick: async () => { await api(`/api/admin/accounts/${a.id}/verify`, { method: 'POST', token, body: {} }); loadAccounts(); } }, 'Bestätigen'),
          h('button', { class: 'btn small light', onclick: async () => { if (confirm(`Statistik von ${a.username} zurücksetzen?`)) { await api(`/api/admin/accounts/${a.id}/resetstats`, { method: 'POST', token, body: {} }); loadAccounts(); } } }, 'Statistik zurücksetzen'),
          !a.isAdmin && h('button', { class: 'btn small light', onclick: async () => { if (confirm(`Account ${a.username} löschen?`)) { try { await api(`/api/admin/accounts/${a.id}`, { method: 'DELETE', token }); loadAccounts(); } catch (e) { toast(e.message); } } } }, 'Löschen'),
        )))));
    } catch (e) { box.replaceChildren(h('p', { class: 'err' }, e.message)); }
  }

  /* --- Galerie und Fotos löschen --- */
  async function loadGallery() {
    const box = $('#tab-gallery');
    try {
      const { items } = await api('/api/gallery');
      const inclGallery = h('input', { type: 'checkbox', id: 'purgeGal' });
      box.replaceChildren(
        h('div', { class: 'card stack' },
          h('h2', {}, `Galerie der besten Fotos (${items.length})`),
          h('p', { class: 'small muted' }, 'Fotos übernimmst du unter „Spiele“ → „Fotos“ mit ⭐. Öffentlich zu sehen unter ', h('a', { href: '/gallery' }, '/gallery'), '.'),
          items.length ? h('div', { class: 'photos' }, items.map((it) => {
            const src = `/api/gallery/${it.id}.jpg`;
            const cap = `${it.username} · ${it.gameName}${it.caption ? ` · „${it.caption}“` : ''}`;
            return h('figure', {},
              h('button', { onclick: () => { $('#lbImg').src = src; $('#lbCap').textContent = cap; $('#lightbox').showModal(); } }, h('img', { src, alt: '', loading: 'lazy' })),
              h('figcaption', {}, cap),
              h('button', { class: 'btn small light', onclick: async () => { if (confirm('Aus der Galerie entfernen?')) { await api(`/api/admin/gallery/${it.id}`, { method: 'DELETE', token }); loadGallery(); } } }, 'Entfernen'));
          })) : h('p', { class: 'muted' }, 'Noch keine Fotos in der Galerie.')),
        h('div', { class: 'card danger stack' },
          h('h2', {}, 'Alle Fotos löschen'),
          h('p', {}, 'Löscht sämtliche Fotos aller Spiele vom Server. Das kann nicht rückgängig gemacht werden.'),
          h('div', { class: 'field-bool' }, inclGallery, h('label', { for: 'purgeGal' }, 'Auch die Galerie der besten Fotos leeren')),
          h('button', { class: 'btn hunter', onclick: async () => {
            if (!confirm('Wirklich ALLE Fotos vom Server löschen?')) return;
            try { const r = await api('/api/admin/photos/purge', { method: 'POST', token, body: { includeGallery: inclGallery.checked } }); toast(`${r.deleted} Dateien gelöscht`); loadGallery(); load(); } catch (e) { toast(e.message); }
          } }, 'Alle Fotos löschen')),
      );
    } catch (e) { box.replaceChildren(h('p', { class: 'err' }, e.message)); }
  }

  async function start() {
    try { CAT = await api('/api/admin/catalog', { token }); }
    catch (e) { if (e.status === 401) { localStorage.removeItem(KEY); token = null; showLogin(); return; } toast(e.message); return; }
    $('#who').textContent = localStorage.getItem(KEY + ':user') ? `· ${localStorage.getItem(KEY + ':user')}` : '';
    $('#login').hidden = true; $('#dash').hidden = false; $('#logout').hidden = false;
    const newForm = settingsForm(CAT.defaults);
    $('#newForm').replaceChildren(newForm.el);
    $('#createBtn').onclick = async () => {
      $('#newErr').textContent = '';
      try {
        await api('/api/admin/games', { method: 'POST', token, body: { name: $('#newName').value, settings: newForm.read() } });
        $('#newWrap').open = false; toast('Spiel angelegt'); load();
      } catch (e) { $('#newErr').textContent = e.message; }
    };
    load();
  }
  if (token) start(); else showLogin();
  setInterval(() => {
    if (!document.hidden && $('#tab-games') && !$('#tab-games').hidden && !document.querySelector('#games input:focus, #games select:focus, #games details[open]') && !openEdit.size && !openPhotos.size && !openPlayers.size) load();
  }, 10000);
})();
