'use strict';
(() => {
  const { $, h, api, dur, ago, clock, toast, account } = MH;
  let CAT = { abilities: {}, quests: {} };
  api('/api/catalog').then((c) => { CAT = c; if (S) renderActions(); }).catch(() => {});

  const CODE = ((location.pathname.match(/^\/g\/([A-Za-z0-9]+)/) || [])[1] || '').toUpperCase();
  if (!CODE) { location.replace('/'); return; }
  const IDKEY = 'manhunt:' + CODE;
  const adminToken = localStorage.getItem('manhunt:admin');
  const adminMode = new URLSearchParams(location.search).get('admin') === '1' && !!adminToken;
  let ident = null;
  try { ident = JSON.parse(localStorage.getItem(IDKEY)); } catch { /* keine Anmeldung */ }
  let TOKEN = adminMode ? adminToken : ident && ident.token;
  const baseTitle = `Manhunt ${CODE}`;
  document.title = baseTitle;

  /* ---------------------------------------------------------------- */
  /* Hilfsfunktionen                                                  */
  /* ---------------------------------------------------------------- */
  const fmtInterval = (sec) => (sec < 120 ? `${Math.round(sec)} Sekunden` : `${String(Number((sec / 60).toFixed(1))).replace('.', ',')} Minuten`);
  const fmtDist = (m) => (m < 1000 ? `${Math.max(10, Math.round(m / 10) * 10)} m` : `${(m / 1000).toFixed(1).replace('.', ',')} km`);
  function haversine(lat1, lng1, lat2, lng2) {
    const R = 6371000, r = Math.PI / 180;
    const a = Math.sin(((lat2 - lat1) * r) / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lng2 - lng1) * r) / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }
  function compass(lat1, lng1, lat2, lng2) {
    const r = Math.PI / 180;
    const y = Math.sin((lng2 - lng1) * r) * Math.cos(lat2 * r);
    const x = Math.cos(lat1 * r) * Math.sin(lat2 * r) - Math.sin(lat1 * r) * Math.cos(lat2 * r) * Math.cos((lng2 - lng1) * r);
    const deg = ((Math.atan2(y, x) / r) + 360) % 360;
    return ['Norden', 'Nordosten', 'Osten', 'Südosten', 'Süden', 'Südwesten', 'Westen', 'Nordwesten'][Math.round(deg / 45) % 8];
  }
  const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const roleName = (r) => ({ runner: 'Runner', hunter: 'Hunter', admin: 'Spielleitung' }[r] || r);
  const card = (cls, ...kids) => h('div', { class: `card ${cls || ''}` }, ...kids);
  const clk = (kind, ts) => h('span', { 'data-clock': kind, 'data-ts': String(ts) }, '…');

  /* ---------------------------------------------------------------- */
  /* Beitritt                                                         */
  /* ---------------------------------------------------------------- */
  async function showJoin() {
    const box = $('#joinView'); box.hidden = false; box.replaceChildren();
    let info;
    try { info = await api(`/api/g/${CODE}/info`); }
    catch (e) {
      box.append(card('danger', h('h2', {}, 'Spiel nicht gefunden'), h('p', {}, e.status === 404 ? `Den Code ${CODE} gibt es nicht.` : e.message), h('a', { class: 'btn', href: '/' }, 'Zur Startseite')));
      return;
    }
    $('#gameName').textContent = info.name;
    if (info.status === 'ended') { box.append(card('', h('h2', {}, info.name), h('p', {}, 'Dieses Spiel ist schon beendet.'), h('a', { class: 'btn', href: '/' }, 'Zur Startseite'))); return; }
    const acc = account.get();
    if (!acc) {
      box.append(h('h1', {}, info.name), h('p', {}, 'Melde dich an, um mitzuspielen. Deine Punkte landen in der Bestenliste.'), MHAuth.box(() => showJoin()));
      return;
    }
    const s = info.settings;
    const rules = [
      `Runner teilen ihren Standort alle ${fmtInterval(s.locationIntervalSec)}.`,
      s.photosEnabled && `Runner laden alle ${s.photoIntervalMin} Minuten ein Foto hoch.`,
      s.photosEnabled && s.livePenaltyEnabled && `Wer ein Foto mehr als ${s.photoGraceSec} Sekunden zu spät schickt, wird live geortet – ${s.livePenaltyUntil === 'upload' ? 'bis zum nächsten Foto' : 'bis zum Foto der nächsten Runde'}.`,
      s.headStartMin > 0 && `Runner haben ${s.headStartMin} Minuten Vorsprung, bevor die Hunter sie sehen.`,
      s.fuzzMeters > 0 && `Hunter sehen die Runner nur ungefähr (bis zu ${s.fuzzMeters} m versetzt).`,
      s.zoneEnabled && 'Es gibt eine Spielzone. Wer sie verlässt, wird gewarnt.',
      s.questsEnabled && 'Regelmäßig gibt es Quests. Wer sie schafft, bekommt Punkte und Fähigkeiten.',
      s.abilitiesEnabled && 'Fähigkeiten wie Freeze, Tarnkappe oder Radar kannst du jederzeit einsetzen.',
      s.pickupsEnabled && 'An großen Orten (z. B. Supermärkten) liegen Fähigkeiten zum Einsammeln.',
      s.antiSpoof !== 'off' && 'GPS-Fälschungen und VPNs werden erkannt.',
      s.caughtBecomeHunter && 'Wer gefangen wird, jagt ab dann als Hunter mit.',
      s.chatEnabled && `Jedes Team hat einen eigenen Chat${s.voiceEnabled ? ' mit Sprachnachrichten' : ''}.`,
    ].filter(Boolean);
    const err = h('p', { class: 'err', role: 'alert' });
    const radio = (val, title, text) => h('label', { class: `choice ${val}` }, h('input', { type: 'radio', name: 'role', value: val }), h('span', {}, h('b', {}, title), text));
    const go = h('button', { class: 'btn big' }, 'Spiel beitreten');
    go.addEventListener('click', async () => {
      err.textContent = '';
      const role = (document.querySelector('input[name=role]:checked') || {}).value;
      if (!role) { err.textContent = 'Bitte wähle eine Rolle.'; return; }
      go.disabled = true;
      try {
        const r = await api(`/api/g/${CODE}/join`, { method: 'POST', acc: acc.token, body: { role } });
        localStorage.setItem(IDKEY, JSON.stringify({ token: r.token, id: r.id, name: r.name, role: r.role }));
        location.reload();
      } catch (e2) {
        if (e2.status === 401) { account.set(null); showJoin(); return; }
        err.textContent = e2.message; go.disabled = false;
      }
    });
    box.append(
      h('h1', {}, info.name),
      card('stack',
        h('div', { class: 'row between' }, h('span', {}, 'Du spielst als ', h('b', {}, acc.username)), h('button', { class: 'btn small light', onclick: () => { account.set(null); showJoin(); } }, 'Abmelden')),
        h('div', {}, h('label', {}, 'Rolle'), h('div', { class: 'choices' },
          radio('runner', 'Runner', 'Du wirst gejagt und teilst deinen Standort.'),
          radio('hunter', 'Hunter', 'Du suchst die Runner anhand ihres Standorts.'))),
        s.spectatorsEnabled && h('label', { class: 'field-bool' }, h('input', { type: 'radio', name: 'role', value: 'spectator' }),
          h('span', {}, h('b', {}, '👀 Nur zuschauen'), ` – du siehst alles, aber ${s.spectatorDelaySec} Sekunden verzögert.`)),
        err, go),
      card('', h('h3', {}, 'So läuft dieses Spiel'), h('ul', {}, rules.map((r) => h('li', {}, r))),
        h('p', { class: 'small muted' }, 'Mit dem Beitritt erlaubst du, dass dein Standort und deine Fotos für die Mitspielenden sichtbar sind (Runner) bzw. du die Positionen der Runner siehst (Hunter). Tipp: Mit der Android-App läuft das Tracking auch bei gesperrtem Bildschirm.')),
    );
  }

  /* ---------------------------------------------------------------- */
  /* App-Zustand                                                      */
  /* ---------------------------------------------------------------- */
  let S = null, offset = 0;
  const nowMs = () => Date.now() + offset;
  let map, didFit = false;
  const layers = { markers: new Map(), trails: new Map(), circles: new Map(), self: null, selfAcc: null, zone: null, extras: [] };
  let lastFix = null, watchId = null, tracking = false, geoErr = '', wakeLock = null, nextSendAt = 0, sending = false;
  let uploading = false, localLastPhoto = 0;
  let audioCtx = null, lastAlarmAt = 0, wasOverdue = false, releaseHandled = false;
  let seenPhotos = null, seenMsg = null, prevStatus = null, prevCaught = null, photoSig = '', bannerSig = '';
  let refreshing = false, again = false, tab = 'lage', seenInbox = null;
  const seenChat = new Set();

  const me = () => S.self;
  const isPlayer = () => S && (S.self.role === 'runner' || S.self.role === 'hunter');
  const shouldShare = () => S && S.game.status === 'running' && !S.self.caught && isPlayer()
    && (S.self.role === 'runner' || S.settings.huntersVisibleToHunters || S.settings.huntersVisibleToRunners);

  /* --- Ton, Vibration, Bildschirm wach --- */
  function unlockAudio() {
    try { audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)(); audioCtx.resume(); } catch { /* egal */ }
  }
  function beep(times = 3) {
    if (!audioCtx) return;
    for (let i = 0; i < times; i++) {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.frequency.value = 880; g.gain.value = 0.2; o.connect(g); g.connect(audioCtx.destination);
      const t = audioCtx.currentTime + i * 0.3; o.start(t); o.stop(t + 0.18);
    }
  }
  const buzz = (pattern) => { try { navigator.vibrate && navigator.vibrate(pattern); } catch { /* egal */ } };
  async function requestWake() {
    try {
      if ('wakeLock' in navigator) {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => { wakeLock = null; if (S) renderLage(); });
        if (S) renderLage();
      }
    } catch { /* nicht unterstützt oder abgelehnt */ }
  }

  /* --- Standort --- */
  function onFix(pos) {
    lastFix = { lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy || 0, ts: Date.now() };
    if (geoErr) { geoErr = ''; if (S) renderLage(); }
    updateSelfMarker();
  }
  function onGeoErr(err) {
    geoErr = err.code === 1 ? 'Standortzugriff wurde verweigert. Erlaube ihn in den Browser-Einstellungen für diese Seite.'
      : err.code === 3 ? 'Kein GPS-Signal (Zeitüberschreitung).' : 'Standort ist gerade nicht verfügbar.';
    if (err.code === 1) { tracking = false; if (watchId != null) navigator.geolocation.clearWatch(watchId); watchId = null; }
    if (S) renderLage();
  }
  function startTracking() {
    unlockAudio();
    if (!('geolocation' in navigator)) { geoErr = 'Dein Browser unterstützt keinen Standort.'; renderLage(); return; }
    if (watchId == null) watchId = navigator.geolocation.watchPosition(onFix, onGeoErr, { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 });
    tracking = true; nextSendAt = 0;
    requestWake(); renderLage();
  }
  function freshFix() {
    const maxAge = S && S.self.live ? 4000 : 20000;
    if (lastFix && Date.now() - lastFix.ts < maxAge) return Promise.resolve(lastFix);
    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition((p) => { onFix(p); resolve(lastFix); }, () => resolve(lastFix && Date.now() - lastFix.ts < 300000 ? lastFix : null), { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 });
    });
  }
  async function maybeSend() {
    if (sending || !tracking || !shouldShare() || nowMs() < nextSendAt) return;
    sending = true;
    try {
      const fix = await freshFix();
      if (!fix) { nextSendAt = nowMs() + 10000; return; }
      const r = await api(`/api/g/${CODE}/location`, { method: 'POST', token: TOKEN, body: { lat: fix.lat, lng: fix.lng, acc: fix.acc } });
      nextSendAt = nowMs() + (r.nextInMs || (S.self.sendIntervalSec || S.settings.locationIntervalSec) * 1000);
      if (S) renderLage();
    } catch (e) {
      if (e.status === 401) authLost();
      else { nextSendAt = nowMs() + 8000; if (e.status === 403 || e.status === 409) { geoErr = e.message; renderLage(); } }
    } finally { sending = false; }
  }

  /* ---------------------------------------------------------------- */
  /* Karte                                                            */
  /* ---------------------------------------------------------------- */
  function initMap() {
    map = L.map('map', { zoomControl: true }).setView([51.16, 10.45], 6);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap-Mitwirkende' }).addTo(map);
    $('#fitBtn').addEventListener('click', fitAll);
    $('#meBtn').addEventListener('click', () => { if (lastFix) map.setView([lastFix.lat, lastFix.lng], Math.max(map.getZoom(), 16)); else toast('Dein Standort ist noch nicht bekannt.'); });
    if (me().role === 'admin') $('#meBtn').hidden = true;
  }
  function pinIcon(cls, name) {
    const el = h('div', { class: `pin ${cls}` }, h('div', { class: 'dot' }), h('div', { class: 'nm', text: name }));
    return L.divIcon({ className: '', html: el.outerHTML, iconSize: [0, 0] });
  }
  function popupFor(pid) {
    const p = S && S.players.find((x) => x.id === pid);
    if (!p) return '';
    return h('div', {},
      h('strong', {}, p.name), ` (${roleName(p.role)})`, p.caught ? h('div', {}, 'gefangen') : null,
      h('div', {}, `Stand: ${ago(nowMs() - p.loc.ts)}`), p.loc.acc ? h('div', {}, `Genauigkeit ca. ${Math.round(p.loc.acc)} m`) : null,
      p.outside ? h('div', {}, 'außerhalb der Spielzone') : null);
  }
  function updateMap() {
    const s = S.settings, seen = new Set();
    for (const p of S.players) {
      const isSelf = p.id === me().id;
      if (!p.loc || (isSelf && lastFix)) continue;
      seen.add(p.id);
      const stale = S.game.status === 'running' && nowMs() - p.loc.ts > s.locationIntervalSec * 2500 + 30000;
      const cls = `${p.role}${p.caught ? ' caught' : ''}${stale ? ' stale' : ''}${p.outside ? ' outside' : ''}`;
      const key = `${cls}|${p.name}`;
      let mk = layers.markers.get(p.id);
      if (!mk) {
        mk = L.marker([p.loc.lat, p.loc.lng], { icon: pinIcon(cls, p.name), keyboard: false }).addTo(map);
        mk._pid = p.id; mk._key = key; mk.bindPopup(() => popupFor(mk._pid));
        layers.markers.set(p.id, mk);
      } else {
        mk.setLatLng([p.loc.lat, p.loc.lng]);
        if (mk._key !== key) { mk.setIcon(pinIcon(cls, p.name)); mk._key = key; }
      }
      const color = p.role === 'runner' ? '#0f8a4a' : '#c7301f';
      const pts = p.trail.map((t) => [t[0], t[1]]);
      let tr = layers.trails.get(p.id);
      if (pts.length > 1) { if (!tr) { tr = L.polyline(pts, { color, weight: 3, opacity: 0.7 }).addTo(map); layers.trails.set(p.id, tr); } else tr.setLatLngs(pts); }
      else if (tr) { tr.remove(); layers.trails.delete(p.id); }
      const fuzzed = s.fuzzMeters > 0 && me().role === 'hunter' && p.role === 'runner' && S.game.status !== 'ended';
      let ci = layers.circles.get(p.id);
      if (fuzzed) { if (!ci) { ci = L.circle([p.loc.lat, p.loc.lng], { radius: s.fuzzMeters, color, weight: 1, fillOpacity: 0.1 }).addTo(map); layers.circles.set(p.id, ci); } else { ci.setLatLng([p.loc.lat, p.loc.lng]); ci.setRadius(s.fuzzMeters); } }
      else if (ci) { ci.remove(); layers.circles.delete(p.id); }
    }
    for (const [id, mk] of layers.markers) if (!seen.has(id)) { mk.remove(); layers.markers.delete(id); }
    for (const coll of [layers.trails, layers.circles]) for (const [id, l] of coll) if (!seen.has(id)) { l.remove(); coll.delete(id); }

    if (s.zoneEnabled) {
      if (!layers.zone) layers.zone = L.circle([s.zoneLat, s.zoneLng], { radius: s.zoneRadiusM, color: '#f2bc0f', weight: 4, dashArray: '10 8', fill: false }).addTo(map);
      else { layers.zone.setLatLng([s.zoneLat, s.zoneLng]); layers.zone.setRadius(s.zoneRadiusM); }
    } else if (layers.zone) { layers.zone.remove(); layers.zone = null; }
    for (const l of layers.extras) l.remove();
    layers.extras = [];
    for (const pu of S.pickups || []) {
      const icon = L.divIcon({ className: '', html: `<div class="pickup-pin${pu.drop ? ' drop' : ''}">${pu.drop ? '📦' : '🎁'}</div>`, iconSize: [26, 26], iconAnchor: [13, 13] });
      const mk = L.marker([pu.lat, pu.lng], { icon }).addTo(map).bindPopup(() => pickupPopup(pu));
      layers.extras.push(mk, L.circle([pu.lat, pu.lng], { radius: S.settings.pickupCollectM, color: '#f2bc0f', weight: 2, fillOpacity: 0.1 }).addTo(map));
    }
    for (const q of (S.self.quests || [])) {
      if (q.status !== 'active' || !q.target) continue;
      const d = { ...(CAT.quests[q.key] || {}), ...(q.title ? { title: q.title, icon: q.icon } : {}) };
      const icon = L.divIcon({ className: '', html: `<div class="pickup-pin">${esc(d.icon || '🚩')}</div>`, iconSize: [26, 26], iconAnchor: [13, 13] });
      layers.extras.push(L.marker([q.target.lat, q.target.lng], { icon }).addTo(map).bindPopup(h('div', {}, `Quest: ${d.title || ''} – ${q.target.name}`)),
        L.circle([q.target.lat, q.target.lng], { radius: q.target.radiusM, color: '#2a62d9', weight: 2, dashArray: '6 6', fillOpacity: 0.05 }).addTo(map));
    }
    if (!didFit) fitAll(true);
  }
  function pickupPopup(pu) {
    const d = lastFix ? haversine(lastFix.lat, lastFix.lng, pu.lat, pu.lng) : null;
    const waiting = pu.drop && pu.activeAt && pu.activeAt > nowMs();
    return h('div', {}, h('strong', {}, `${pu.drop ? '📦' : '🎁'} ${pu.name}`),
      h('div', {}, pu.drop ? (waiting ? `Versorgungsabwurf – landet in ${dur(pu.activeAt - nowMs())}` : `Versorgungsabwurf mit ${S.settings.supplyDropAbilities} Fähigkeiten!`) : 'Hier liegt eine Fähigkeit.'),
      d != null ? h('div', {}, `Entfernung: ${fmtDist(d)}`) : null,
      h('button', { class: 'btn small', onclick: () => collect(pu) }, 'Einsammeln'));
  }
  async function collect(pu) {
    if (!lastFix) { toast('Warte auf GPS …'); return; }
    try {
      const r = await api(`/api/g/${CODE}/pickup`, { method: 'POST', token: TOKEN, body: { id: pu.id, lat: lastFix.lat, lng: lastFix.lng, acc: lastFix.acc } });
      const a = CAT.abilities[r.ability];
      toast(a ? `Eingesammelt: ${a.icon} ${a.name}` : 'Eingesammelt!', 5000); refresh();
    } catch (e) { toast(e.message); }
  }
  function updateSelfMarker() {
    if (!map || !lastFix) return;
    const ll = [lastFix.lat, lastFix.lng];
    if (!layers.self) {
      layers.self = L.marker(ll, { icon: pinIcon('me', 'Ich'), keyboard: false, zIndexOffset: 1000 }).addTo(map);
      layers.selfAcc = L.circle(ll, { radius: lastFix.acc, color: '#2a62d9', weight: 1, fillOpacity: 0.08 }).addTo(map);
      if (!didFit) fitAll(true);
    } else { layers.self.setLatLng(ll); layers.selfAcc.setLatLng(ll); layers.selfAcc.setRadius(lastFix.acc); }
  }
  function fitAll(auto) {
    const pts = [];
    for (const mk of layers.markers.values()) pts.push(mk.getLatLng());
    if (layers.self) pts.push(layers.self.getLatLng());
    if (!pts.length && layers.zone) { map.fitBounds(layers.zone.getBounds()); didFit = true; return; }
    if (!pts.length) { if (auto !== true) toast('Noch keine Positionen zu sehen.'); return; }
    map.fitBounds(L.latLngBounds(pts).pad(0.25), { maxZoom: 17 });
    didFit = true;
  }

  /* ---------------------------------------------------------------- */
  /* Foto                                                             */
  /* ---------------------------------------------------------------- */
  const myPlayer = () => S.players.find((p) => p.id === me().id);
  const myLastPhotoTs = () => Math.max((myPlayer() && myPlayer().lastPhotoTs) || 0, localLastPhoto);
  function photoState() {
    const s = S.settings, g = S.game;
    if (me().role !== 'runner' || !s.photosEnabled || g.status !== 'running' || me().caught) return null;
    const iv = s.photoIntervalMin * 60000, slot = Math.floor((nowMs() - g.startedAt) / iv);
    const prevDue = g.startedAt + slot * iv, nextDue = prevDue + iv;
    if (slot >= 1 && !(myLastPhotoTs() >= prevDue)) return { overdue: true, since: prevDue, prevDue, nextDue };
    return { overdue: false, prevDue, nextDue };
  }
  async function shrink(file, max = 1280, quality = 0.82) {
    let src;
    try { src = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
    catch {
      src = await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('Bild konnte nicht gelesen werden')); im.src = URL.createObjectURL(file); });
    }
    const w = src.naturalWidth || src.width, hgt = src.naturalHeight || src.height;
    const sc = Math.min(1, max / Math.max(w, hgt));
    const c = document.createElement('canvas'); c.width = Math.round(w * sc); c.height = Math.round(hgt * sc);
    c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
    return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Bild konnte nicht verarbeitet werden'))), 'image/jpeg', quality));
  }
  let photoQuest = null;
  async function onPhotoChosen(file) {
    if (!file) return;
    uploading = true; renderLage();
    const q = photoQuest; photoQuest = null;
    try {
      const blob = await shrink(file);
      const r = await api(`/api/g/${CODE}/photo${q ? `?quest=${q}` : ''}`, { method: 'POST', token: TOKEN, body: blob, contentType: 'image/jpeg' });
      if (me().role === 'runner') localLastPhoto = nowMs();
      if (r && r.stored === false) toast(r.warning || 'Foto gezählt, aber nicht gespeichert', 6000);
      else toast(q ? 'Quest-Foto hochgeladen' : 'Foto hochgeladen');
      refresh();
    } catch (e) { toast(`Foto-Upload fehlgeschlagen: ${e.message}`, 6000); }
    finally { uploading = false; renderLage(); }
  }
  function alarm() { beep(3); buzz([300, 150, 300, 150, 300]); toast('Foto fällig!', 5000); }

  /* ---------------------------------------------------------------- */
  /* Darstellung                                                      */
  /* ---------------------------------------------------------------- */
  function statusCard() {
    const g = S.game, s = S.settings, r = me().role;
    if (g.status === 'lobby') {
      return card('', h('h2', {}, 'Noch nicht gestartet'), h('p', {}, `Sobald die Spielleitung startet, teilen Runner ihren Standort alle ${fmtInterval(s.locationIntervalSec)}.`));
    }
    if (g.status === 'ended') {
      const last = [...S.messages].reverse().find((m) => m.text.startsWith('Spiel beendet'));
      return card('ok', h('h2', {}, 'Spiel beendet'), h('p', {}, last ? last.text.replace('Spiel beendet: ', '') : ''), h('p', {}, 'Auf der Karte siehst du jetzt alle Wege und exakten Positionen.'));
    }
    const kids = [h('h2', {}, 'Das Spiel läuft'), h('p', {}, 'Seit ', clk('since', g.startedAt))];
    if (g.releaseAt > nowMs() && r === 'hunter') kids.push(h('p', {}, 'Die Runner haben Vorsprung. Du siehst sie in ', clk('until', g.releaseAt), '.'));
    if (g.releaseAt > nowMs() && r === 'runner') kids.push(h('p', {}, 'Dein Vorsprung: Hunter sehen dich erst in ', clk('until', g.releaseAt), '.'));
    if (s.autoEndAfterMin > 0) kids.push(h('p', {}, 'Zeitlimit in ', clk('until', g.startedAt + s.autoEndAfterMin * 60000), '.'));
    return card('', ...kids);
  }
  function trackingCard() {
    const r = me().role, s = S.settings;
    if (!tracking) {
      const why = r === 'runner' ? `Dein Standort geht alle ${fmtInterval(s.locationIntervalSec)} an die Hunter.`
        : shouldShareRole() ? 'Dein Standort wird mit den anderen geteilt, wie in den Spielregeln eingestellt.' : 'So siehst du dich selbst auf der Karte und die Entfernung zu den Runnern.';
      const btn = h('button', { class: 'btn big gold', onclick: startTracking }, 'Standort freigeben');
      return card('gold stack', h('h3', {}, 'Standort freigeben'), h('p', {}, why, ' Lass diese Seite geöffnet und den Bildschirm an. Sobald der Browser im Hintergrund pausiert, stoppt das Tracking.'), geoErr && h('p', { class: 'err' }, geoErr), btn);
    }
    const kids = [h('h3', {}, 'Standort aktiv'), h('p', { id: 'gpsInfo' }, 'Suche GPS …'),
      h('p', { class: 'small muted' }, wakeLock ? 'Bildschirm bleibt an.' : 'Bildschirm kann ausgehen. Halte ihn selbst wach, sonst pausiert das Tracking.')];
    if (shouldShare()) kids.splice(2, 0, h('p', {}, 'Nächstes Update in ', clk('until', nextSendAt || nowMs())));
    return card('ok', ...kids);
  }
  const shouldShareRole = () => me().role === 'runner' || S.settings.huntersVisibleToHunters || S.settings.huntersVisibleToRunners;
  function photoCard() {
    const g = S.game;
    if (g.status === 'lobby') return card('', h('h3', {}, 'Fotos'), h('p', {}, `Nach dem Start fragt dich das Spiel alle ${S.settings.photoIntervalMin} Minuten nach einem Foto.`));
    const ps = photoState();
    if (!ps) return null;
    const btn = (label, cls) => h('button', { class: `btn big ${cls}`, disabled: uploading, onclick: () => { unlockAudio(); $('#photoInput').click(); } }, uploading ? 'Lade hoch …' : label);
    if (ps.overdue) return card('danger stack', h('h3', {}, 'Foto fällig!'), h('p', {}, 'Seit ', clk('since', ps.since), ' überfällig. Mach ein Foto von deiner Umgebung.'), btn('Foto aufnehmen', 'hunter'));
    return card('stack', h('h3', {}, 'Nächstes Foto in'), h('div', { class: 'big-clock' }, clk('until', ps.nextDue)),
      h('div', { class: 'bar-progress' }, h('i', { 'data-progress': `${ps.prevDue},${ps.nextDue}` })), btn('Foto jetzt schon aufnehmen', 'light'));
  }
  function hunterPhotoCard() {
    const g = S.game, iv = S.settings.photoIntervalMin * 60000;
    const slot = Math.floor((nowMs() - g.startedAt) / iv);
    return card('', h('h3', {}, 'Runner-Fotos'), h('p', {}, `Alle ${S.settings.photoIntervalMin} Minuten müssen Runner ein Foto hochladen. Nächste Runde in `, clk('until', g.startedAt + (slot + 1) * iv), '.'));
  }
  function distanceCard() {
    return card('', h('h3', {}, 'Nächster Runner'), h('p', { id: 'distInfo' }, '…'));
  }
  function updateDistance() {
    const el = $('#distInfo'); if (!el) return;
    const fix = lastFix; const cands = S.players.filter((p) => p.role === 'runner' && !p.caught && p.loc);
    if (!cands.length) { el.textContent = S.game.releaseAt > nowMs() ? 'Noch Vorsprung: die Runner sind noch nicht sichtbar.' : 'Noch kein Runner sichtbar.'; return; }
    if (!fix) { el.textContent = 'Gib deinen Standort frei, um die Entfernung zu sehen.'; return; }
    let best = null;
    for (const p of cands) { const d = haversine(fix.lat, fix.lng, p.loc.lat, p.loc.lng); if (!best || d < best.d) best = { p, d }; }
    const approx = S.settings.fuzzMeters > 0 ? 'ca. ' : '';
    el.textContent = `${best.p.name}: ${approx}${fmtDist(best.d)} Richtung ${compass(fix.lat, fix.lng, best.p.loc.lat, best.p.loc.lng)} (Stand ${ago(nowMs() - best.p.loc.ts)})`;
  }
  function adminCard() {
    const g = S.game;
    const call = async (action, body) => { try { await api(`/api/admin/games/${CODE}/${action}`, { method: 'POST', token: TOKEN, body: body || {} }); } catch (e) { toast(e.message); } };
    return card('stack', h('h3', {}, 'Spielleitung'), h('p', { class: 'small muted' }, 'Du siehst alle Positionen exakt und ohne Vorsprung. Alle Einstellungen findest du im Admin-Bereich.'),
      h('div', { class: 'row' },
        g.status === 'lobby' && h('button', { class: 'btn runner', onclick: () => call('start') }, 'Spiel starten'),
        g.status === 'running' && h('button', { class: 'btn hunter', onclick: () => confirm('Spiel jetzt beenden?') && call('end') }, 'Spiel beenden'),
        h('button', { class: 'btn light', onclick: () => { const t = prompt('Nachricht an alle Spieler:'); if (t) call('announce', { text: t }); } }, 'Nachricht senden'),
        h('a', { class: 'btn light', href: '/admin' }, 'Admin-Bereich')));
  }
  function messagesCard() {
    const list = [...S.messages].reverse().slice(0, 15);
    return card('', h('h3', {}, 'Meldungen'), list.length ? h('ul', { class: 'msgs' }, list.map((m) => h('li', { class: m.kind }, h('span', { class: 't' }, clock(m.ts)), m.text))) : h('p', { class: 'muted' }, 'Noch nichts passiert.'));
  }
  function renderLage() {
    if (!S) return;
    const g = S.game, s = S.settings, r = me().role;
    const kids = [statusCard()];
    if (r === 'spectator') kids.push(card('', h('h3', {}, '👀 Du schaust zu'), h('p', {}, `Du siehst alle Positionen exakt, aber ${me().spectatorDelaySec} Sekunden verzögert.`)));
    if (isPlayer() && g.status !== 'ended') kids.push(trackingCard());
    if (me().converted && g.status === 'running') kids.push(card('gold', h('h3', {}, '🔄 Seitenwechsel'), h('p', {}, 'Du wurdest gefangen und jagst jetzt als Hunter mit.')));
    if (g.status === 'ended') kids.push(replayCard());
    if (g.status === 'ended' && S.photos.length) kids.push(card('stack', h('h3', {}, '📷 Alle Fotos'), h('p', { class: 'small muted' }, `${S.photos.length} Fotos, sortiert nach Fotograf.`),
      h('a', { class: 'btn', href: `/api/g/${CODE}/photos.zip?t=${encodeURIComponent(TOKEN)}` }, '⬇️ Als ZIP herunterladen')));
    if (isPlayer() && g.status !== 'ended') kids.push(inviteCard());
    kids.push(MH.pushCard());
    if (r === 'runner' && s.photosEnabled && g.status !== 'ended') kids.push(photoCard());
    if (r === 'hunter' && s.photosEnabled && g.status === 'running') kids.push(hunterPhotoCard());
    if (r === 'hunter' && s.showDistance && g.status === 'running') kids.push(distanceCard());
    if (r === 'runner' && s.caughtEnabled && g.status === 'running') {
      kids.push(me().caught
        ? card('gold', h('h3', {}, 'Du wurdest gefangen'), h('p', {}, 'Danke fürs Mitspielen! Dein Standort wird nicht mehr geteilt.'))
        : card('', h('button', { class: 'btn light big', onclick: () => confirm('Wirklich als gefangen melden?') && setCaught(me().id, true) }, 'Ich wurde gefangen')));
    }
    if (r === 'admin') kids.push(adminCard());
    kids.push(messagesCard());
    $('#tab-lage').replaceChildren(...kids.filter(Boolean));
    updateClocks(); updateDistance(); updateGps();
  }
  function renderActions() {
    const el = $('#tab-actions'); if (!el || !S) return;
    if (me().role === 'admin') { el.replaceChildren(card('', h('p', {}, 'Als Spielleitung siehst du hier nichts. Fähigkeiten verschenken kannst du im Admin-Bereich unter „Spieler“.'))); return; }
    if (me().role === 'spectator') { el.replaceChildren(card('', h('p', {}, 'Als Zuschauer hast du keine Fähigkeiten und Quests. Aktive Effekte siehst du auf der Karte und in den Meldungen.'))); return; }
    const g = S.game, sf = S.self;
    const kids = [];
    const eff = (S.effects || []).map((e) => {
      const a = CAT.abilities[e.key] || { icon: '', name: e.key };
      return h('li', {}, `${a.icon} ${a.name}${e.byName ? ` (${e.byName})` : ''}${e.onMe ? ' – betrifft dich' : ''} · noch `, clk('until', e.until));
    });
    if (eff.length) kids.push(card('gold', h('h3', {}, 'Aktive Effekte'), h('ul', {}, eff)));
    // Fähigkeiten
    const abil = (sf.abilities || []).map((x) => {
      const a = CAT.abilities[x.key] || { icon: '?', name: x.key, desc: '' };
      const cd = (sf.cooldowns || []).find((c) => c.key === x.key);
      return h('button', { disabled: g.status !== 'running' || sf.caught || (cd && cd.until > nowMs()), onclick: () => useAbility(x.key, a) },
        h('span', { class: 'n' }, `×${x.count}`), h('b', {}, `${a.icon} ${a.name}`), h('span', { class: 'small muted' }, a.desc),
        cd && cd.until > nowMs() ? h('div', { class: 'small' }, '⏳ wieder bereit in ', clk('until', cd.until)) : null);
    });
    kids.push(card('', h('h3', {}, `Deine Fähigkeiten`), abil.length ? h('div', { class: 'abil' }, abil) : h('p', { class: 'muted' }, 'Keine. Schaff Quests oder sammle Fähigkeiten auf der Karte ein (🎁).')));
    // Quests
    const qs = (sf.quests || []).slice().reverse().map((q) => {
      const d = { ...(CAT.quests[q.key] || { icon: '', title: q.key, desc: '' }), ...(q.title ? { title: q.title, desc: q.desc, icon: q.icon, kind: q.kind, points: q.points } : {}) };
      const extra = [];
      if (q.status === 'active') {
        extra.push(h('div', { class: 'small' }, 'Noch ', clk('until', q.until)));
        if (q.target) extra.push(h('div', { class: 'small' }, `Ziel: ${q.target.name}`, lastFix ? ` · ${fmtDist(haversine(lastFix.lat, lastFix.lng, q.target.lat, q.target.lng))}` : '', ' ',
          h('button', { class: 'btn small light', onclick: () => map.setView([q.target.lat, q.target.lng], 17) }, 'Auf Karte')));
        if (q.progress != null && d.kind === 'distance') extra.push(h('div', { class: 'small' }, `Geschafft: ${q.progress} m`));
        if (q.progress != null && d.kind === 'still') extra.push(h('div', { class: 'small' }, `Stillgehalten: ${Math.floor(q.progress / 60)}:${String(q.progress % 60).padStart(2, '0')}`));
        if (d.kind === 'photo') extra.push(h('button', { class: 'btn small', disabled: uploading, onclick: () => { photoQuest = q.id; $('#photoInput').click(); } }, '📷 Quest-Foto aufnehmen'));
      }
      return h('div', { class: `quest ${q.status}` }, h('b', {}, `${d.icon} ${d.title}`, q.status === 'done' ? ' ✅' : q.status === 'failed' ? ' ⌛' : '', ` · ${d.points} P`), h('div', { class: 'small' }, d.desc), ...extra);
    });
    if (S.settings.questsEnabled) kids.push(card('', h('h3', {}, 'Quests'), qs.length ? qs : h('p', { class: 'muted' }, g.status === 'running' ? 'Die nächste Quest kommt bald.' : 'Quests gibt es, sobald das Spiel läuft.')));
    // Pickups
    const pus = (S.pickups || []).map((pu) => ({ pu, d: lastFix ? haversine(lastFix.lat, lastFix.lng, pu.lat, pu.lng) : null })).sort((a, b) => (a.d ?? 1e9) - (b.d ?? 1e9));
    if (pus.length) kids.push(card('', h('h3', {}, '🎁 Fähigkeiten zum Einsammeln'), h('ul', { class: 'plist' }, pus.slice(0, 8).map(({ pu, d }) => h('li', {},
      h('div', { class: 'grow' }, h('div', { class: 'name' }, `${pu.drop ? '📦 ' : ''}${pu.name}`), h('div', { class: 'small muted' }, d != null ? fmtDist(d) : 'Entfernung unbekannt',
        pu.drop && pu.activeAt > nowMs() ? h('span', {}, ' · landet in ', clk('until', pu.activeAt)) : null)),
      h('button', { class: 'btn small light', onclick: () => map.setView([pu.lat, pu.lng], 17) }, 'Karte'),
      h('button', { class: 'btn small', onclick: () => collect(pu) }, 'Einsammeln'))))));
    kids.push(card('', h('p', {}, `Deine Punkte in diesem Spiel: `, h('b', {}, String(sf.points || 0))), h('a', { class: 'btn small light', href: '/leaderboard' }, '🏆 Bestenliste')));
    el.replaceChildren(...kids);
    updateClocks();
  }
  async function useAbility(key, a) {
    let targetId;
    if (a.target === 'caughtRunner') {
      const caught = S.players.filter((p) => p.role === 'runner' && p.caught);
      if (!caught.length) { toast('Gerade ist kein Runner gefangen.'); return; }
      const name = prompt(`Wen befreien? ${caught.map((p) => p.name).join(', ')}`, caught[0].name);
      const t = caught.find((p) => p.name.toLowerCase() === String(name || '').toLowerCase());
      if (!t) return;
      targetId = t.id;
    } else if (!confirm(`${a.icon} ${a.name} jetzt einsetzen?\n${a.desc}`)) return;
    try { await api(`/api/g/${CODE}/ability`, { method: 'POST', token: TOKEN, body: { key, targetId } }); toast(`${a.icon} ${a.name} eingesetzt!`); refresh(); }
    catch (e) { toast(e.message); }
  }
  /* ---------------- Team-Chat mit Sprachnachrichten ---------------- */
  let chatSig = '', recorder = null, recChunks = [], recStart = 0, chatChannel = 'team';
  function renderChat(force) {
    const el = $('#tab-chat'); if (!el || !S) return;
    const allOn = S.settings.allChatEnabled && S.settings.chatEnabled;
    if (!allOn) chatChannel = 'team';
    const list = (S.chat || []).filter((c) => me().role === 'admin' || (c.channel || 'team') === chatChannel);
    const sig = chatChannel + list.map((c) => c.id).join(',');
    if (!force && sig === chatSig && el.childElementCount) return;
    chatSig = sig;
    const team = chatChannel === 'all' ? 'alle' : { runner: 'Runner', hunter: 'Hunter', spectator: 'Zuschauer', admin: 'alle Teams' }[me().role] || '';
    const items = list.map((c) => h('li', { class: c.pid === me().id ? 'mine' : '' },
      h('div', { class: 'who' }, `${c.channel === 'all' && me().role === 'admin' ? '[Alle] ' : ''}${c.name}${me().role === 'admin' || chatChannel === 'all' ? ` (${{ runner: 'Runner', hunter: 'Hunter', spectator: 'Zuschauer' }[c.team] || c.team})` : ''} · ${clock(c.ts)}`),
      c.voice ? h('audio', { controls: true, preload: 'none', src: `/api/g/${CODE}/chat/voice/${c.voice.id}?t=${encodeURIComponent(TOKEN)}` }) : h('div', {}, c.text)));
    const input = h('input', { type: 'text', maxlength: '300', placeholder: 'Nachricht ans Team …' });
    const send = async () => {
      const t = input.value.trim(); if (!t) return;
      try { await api(`/api/g/${CODE}/chat`, { method: 'POST', token: TOKEN, body: { text: t, channel: chatChannel } }); input.value = ''; refresh(); }
      catch (e) { toast(e.message); }
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });
    const canWrite = me().role !== 'admin' && S.settings.chatEnabled && !(chatChannel === 'all' && me().role === 'spectator');
    const switcher = allOn && me().role !== 'admin' ? h('div', { class: 'tabs chattabs' }, [['team', '👥 Team'], ['all', '🌍 Alle']].map(([v, l]) =>
      h('button', { 'aria-selected': String(chatChannel === v), onclick: () => { chatChannel = v; renderChat(true); } }, l))) : null;
    const rec = h('button', { class: 'btn rec', title: 'Gedrückt halten zum Sprechen' }, '🎙️');
    const startRec = async (e) => {
      e.preventDefault();
      if (recorder) return;
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const type = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg'].find((t) => window.MediaRecorder && MediaRecorder.isTypeSupported(t)) || '';
        recorder = new MediaRecorder(stream, type ? { mimeType: type, audioBitsPerSecond: 32000 } : undefined);
        recChunks = []; recStart = Date.now();
        recorder.ondataavailable = (ev) => recChunks.push(ev.data);
        recorder.onstop = async () => {
          stream.getTracks().forEach((t) => t.stop());
          const blob = new Blob(recChunks, { type: (recorder.mimeType || 'audio/webm').split(';')[0] });
          const dur = Math.round((Date.now() - recStart) / 1000);
          recorder = null; rec.textContent = '🎙️';
          if (dur < 1) { toast('Zu kurz – gedrückt halten'); return; }
          try { await api(`/api/g/${CODE}/chat/voice?dur=${dur}&channel=${chatChannel}`, { method: 'POST', token: TOKEN, body: blob, contentType: blob.type }); refresh(); }
          catch (x) { toast(x.message); }
        };
        recorder.start();
        rec.textContent = '⏺️';
        setTimeout(() => { if (recorder && recorder.state === 'recording') recorder.stop(); }, 30000);
      } catch { toast('Kein Mikrofon-Zugriff'); }
    };
    const stopRec = () => { if (recorder && recorder.state === 'recording') recorder.stop(); };
    rec.addEventListener('pointerdown', startRec);
    rec.addEventListener('pointerup', stopRec);
    rec.addEventListener('pointerleave', stopRec);
    el.replaceChildren(card('',
      switcher,
      h('h3', {}, chatChannel === 'all' ? '🌍 Chat für alle' : `💬 Team-Chat (${team})`),
      items.length ? h('ul', { class: 'chat' }, items) : h('p', { class: 'muted' }, chatChannel === 'all' ? 'Noch keine Nachrichten. Hier lesen alle mit – auch das andere Team!' : 'Noch keine Nachrichten. Nur dein Team kann mitlesen.'),
      chatChannel === 'all' && me().role === 'spectator' ? h('p', { class: 'small muted' }, 'Als Zuschauer liest du hier nur mit.') : null,
      canWrite ? h('div', { class: 'chatbar' }, input, h('button', { class: 'btn', onclick: send }, 'Senden'), S.settings.voiceEnabled ? rec : null) : null));
  }

  /* ---------------- Freunde einladen ---------------- */
  let friendsCache = null, friendsAt = 0;
  function inviteCard() {
    const acc = account.get();
    if (!acc) return null;
    const box = h('div', { class: 'card stack' }, h('h3', {}, '👥 Freunde einladen'));
    const fill = (f) => {
      const list = f.friends;
      box.append(list.length ? h('ul', { class: 'plist' }, list.map((x) => h('li', {},
        h('span', {}, x.online ? '🟢' : '⚪'), h('span', { class: 'grow name' }, x.username),
        h('button', { class: 'btn small light', onclick: async (e) => {
          try { await api('/api/friends/invite', { method: 'POST', acc: acc.token, body: { username: x.username, code: CODE } }); e.target.textContent = '✔ Eingeladen'; e.target.disabled = true; }
          catch (x2) { toast(x2.message); }
        } }, 'Einladen')))) : h('p', { class: 'small muted' }, 'Noch keine Freunde – füge welche in deinem ', h('a', { href: '/profile' }, 'Profil'), ' hinzu.'));
    };
    if (friendsCache && Date.now() - friendsAt < 60000) fill(friendsCache);
    else api('/api/friends', { acc: acc.token }).then((f) => { friendsCache = f; friendsAt = Date.now(); fill(f); }).catch(() => box.remove());
    return box;
  }

  /* ---------------- Wiederholung nach Spielende ---------------- */
  let replayTimer = null, replayLayers = [];
  function replayCard() {
    const g = S.game;
    if (!g.startedAt || !g.endedAt) return null;
    const slider = h('input', { type: 'range', min: String(g.startedAt), max: String(g.endedAt), value: String(g.endedAt), step: '1000' });
    const lbl = h('span', { class: 'mono' }, dur(g.endedAt - g.startedAt));
    const draw = (t) => {
      for (const l of replayLayers) l.remove();
      replayLayers = [];
      lbl.textContent = dur(t - g.startedAt);
      for (const p of S.players) {
        const pts = (p.trail || []).filter((x) => x[2] <= t);
        if (!pts.length) continue;
        const color = p.role === 'runner' ? '#0f8a4a' : p.converted ? '#8a3a0f' : '#c7301f';
        replayLayers.push(L.polyline(pts.map((x) => [x[0], x[1]]), { color, weight: 4, opacity: 0.85 }).addTo(map));
        const last = pts[pts.length - 1];
        replayLayers.push(L.circleMarker([last[0], last[1]], { radius: 7, color: '#14201a', weight: 2, fillColor: color, fillOpacity: 1 }).bindTooltip(p.name, { permanent: true, direction: 'top' }).addTo(map));
      }
    };
    const stopPlay = () => { if (replayTimer) clearInterval(replayTimer); replayTimer = null; };
    slider.addEventListener('input', () => { stopPlay(); hideLive(true); draw(Number(slider.value)); });
    const play = h('button', { class: 'btn', onclick: () => {
      stopPlay(); hideLive(true);
      let t = g.startedAt;
      const step = Math.max(1000, (g.endedAt - g.startedAt) / 300); // ca. 30 Sekunden Abspieldauer
      replayTimer = setInterval(() => { t = Math.min(g.endedAt, t + step); slider.value = String(t); draw(t); if (t >= g.endedAt) stopPlay(); }, 100);
    } }, '▶️ Abspielen');
    const back = h('button', { class: 'btn light', onclick: () => { stopPlay(); for (const l of replayLayers) l.remove(); replayLayers = []; hideLive(false); } }, 'Live-Ansicht');
    return card('stack', h('h3', {}, '🎬 Wiederholung'), h('p', { class: 'small muted' }, 'Spiel das ganze Spiel noch einmal auf der Karte ab.'),
      h('div', { class: 'replay' }, slider, h('div', { class: 'row between' }, lbl, h('div', { class: 'row' }, play, back))));
  }
  function hideLive(hide) {
    for (const coll of [layers.markers, layers.trails, layers.circles]) for (const l of coll.values()) { if (hide) l.remove(); else l.addTo(map); }
  }

  function renderFreeze() {
    let ov = $('#freeze');
    const until = S && S.self.frozenUntil;
    if (until && until > nowMs()) {
      if (!ov) { ov = h('div', { id: 'freeze' }); document.body.append(ov); }
      ov.replaceChildren(h('div', {}, h('h1', {}, '🧊 Eingefroren!'), h('p', {}, 'Ein Runner hat dich eingefroren. Du siehst keine Runner und kannst niemanden fangen.'),
        h('div', { class: 'big-clock' }, dur(until - nowMs())),
        (S.self.abilities || []).some((x) => x.key === 'thaw') ? h('button', { class: 'btn big', onclick: () => useAbility('thaw', CAT.abilities.thaw || { icon: '🔥', name: 'Eisbrecher', desc: '' }) }, '🔥 Eisbrecher einsetzen') : null));
    } else if (ov) ov.remove();
  }
  async function setCaught(pid, caught) {
    try { await api(`/api/g/${CODE}/caught`, { method: 'POST', token: TOKEN, body: { playerId: pid, caught } }); refresh(); }
    catch (e) { toast(e.message); }
  }
  function renderPlayers() {
    const r = me().role, g = S.game;
    const canCatch = (r === 'hunter' || r === 'admin') && S.settings.caughtEnabled && g.status === 'running';
    const order = { runner: 0, hunter: 1 };
    const rows = [...S.players].sort((a, b) => order[a.role] - order[b.role] || a.name.localeCompare(b.name)).map((p) => {
      let info;
      if (p.hidden) info = 'Position noch gesperrt (Vorsprung)';
      else if (p.loc) info = h('span', {}, 'Position ', clk('ago', p.loc.ts));
      else info = g.status === 'lobby' ? 'wartet' : 'keine Position';
      const flags = [];
      if (p.outside) flags.push(h('span', { class: 'chip gold' }, 'außerhalb'));
      if (p.caught) flags.push(h('span', { class: 'chip plain' }, 'gefangen'));
      const btns = [];
      if (p.loc && map) btns.push(h('button', { class: 'btn small light', onclick: () => { map.setView([p.loc.lat, p.loc.lng], Math.max(map.getZoom(), 16)); window.scrollTo({ top: 0, behavior: 'smooth' }); const mk = layers.markers.get(p.id); if (mk) mk.openPopup(); } }, 'Auf Karte'));
      if (canCatch && p.role === 'runner') btns.push(h('button', { class: 'btn small light', onclick: () => (p.caught ? setCaught(p.id, false) : confirm(`${p.name} als gefangen markieren?`) && setCaught(p.id, true)) }, p.caught ? 'Wieder frei' : 'Gefangen'));
      if (r === 'admin') btns.push(h('button', { class: 'btn small light', onclick: async () => { if (!confirm(`${p.name} aus dem Spiel entfernen?`)) return; try { await api(`/api/admin/games/${CODE}/kick`, { method: 'POST', token: TOKEN, body: { playerId: p.id } }); } catch (e) { toast(e.message); } } }, 'Entfernen'));
      if (r === 'admin') btns.push(h('button', { class: 'btn small light', title: 'Entfernen und sperren: kann nicht wieder beitreten', onclick: async () => { if (!confirm(`${p.name} entfernen und für diese Runde sperren?`)) return; try { await api(`/api/admin/games/${CODE}/ban`, { method: 'POST', token: TOKEN, body: { playerId: p.id } }); toast('Gesperrt'); } catch (e) { toast(e.message); } } }, '🚫 Sperren'));
      if (r !== 'admin' && p.id !== me().id) btns.push(h('button', { class: 'btn small light', title: 'An Admins und Spielleitung melden', onclick: async () => {
        const rep = MH.askReport(p.name); if (!rep) return;
        try { await api(`/api/g/${CODE}/report`, { method: 'POST', token: TOKEN, body: { playerId: p.id, ...rep } }); toast('Danke, die Meldung ist raus.'); } catch (e) { toast(e.message); }
      } }, '🚩'));
      return h('li', { class: p.caught ? 'caught' : '' },
        h('span', { class: `chip ${p.role}` }, roleName(p.role)),
        h('div', { class: 'grow' }, h('div', { class: 'name' }, p.name, p.id === me().id ? ' (du)' : ''), h('div', { class: 'small muted' }, info, p.photoCount ? ` · ${p.photoCount} Fotos` : '')),
        ...flags, ...btns);
    });
    $('#tab-players').replaceChildren(card('', h('h3', {}, `Spieler (${S.players.length})`), S.players.length ? h('ul', { class: 'plist' }, rows) : h('p', { class: 'muted' }, 'Noch niemand beigetreten. Teile den Link mit deinen Mitspielern.')));
    updateClocks();
  }
  const REACTIONS = ['👍', '❤️', '😂', '😮', '🔥', '👏', '🤩', '👎'];
  const reactionText = (r) => Object.entries(r || {}).sort((a, b) => b[1] - a[1]).map(([e, n]) => `${e}${n > 1 ? n : ''}`).join(' ');
  function renderPhotos() {
    const sig = S.photos.map((p) => p.id + reactionText(p.reactions) + (p.myReaction || '')).join(',');
    $('#tabbtn-photos').textContent = S.photos.length ? `Fotos (${S.photos.length})` : 'Fotos';
    if (lbPhoto && $('#lightbox').open) { const cur = S.photos.find((x) => x.id === lbPhoto); if (cur) renderReactions(cur); }
    if (sig === photoSig) return;
    photoSig = sig;
    const names = Object.fromEntries(S.players.map((p) => [p.id, p.name]));
    const list = [...S.photos].sort((a, b) => b.ts - a.ts);
    const grid = list.length ? h('div', { class: 'photos' }, list.map((ph) => {
      const src = `/api/g/${CODE}/photo/${ph.id}?t=${encodeURIComponent(TOKEN)}`;
      const cap = `${names[ph.pid] || '?'}, ${clock(ph.ts)} Uhr${ph.questTitle ? ` · ${ph.questTitle}` : ''}`;
      return h('figure', {}, h('button', { onclick: () => openLightbox(ph, src, cap), 'aria-label': `Foto von ${cap}` }, h('img', { src, alt: '', loading: 'lazy' })),
        h('figcaption', {}, cap, ph.reactions && Object.keys(ph.reactions).length ? h('div', { class: 'reacts' }, reactionText(ph.reactions)) : null));
    })) : h('p', { class: 'muted' }, S.settings.photosEnabled ? 'Noch keine Fotos. Sie erscheinen hier, sobald Runner welche hochladen.' : 'Fotos sind in diesem Spiel ausgeschaltet.');
    $('#tab-photos').replaceChildren(card('', h('h3', {}, 'Fotos'), grid));
  }
  let lbPhoto = null;
  function openLightbox(ph, src, cap) {
    lbPhoto = ph.id;
    $('#lbImg').src = src; $('#lbCap').textContent = cap;
    renderReactions(ph);
    $('#lightbox').showModal();
  }
  /* Emoji-Reaktionen wie bei WhatsApp (Issue #6): eine pro Person, nochmal tippen = entfernen */
  function renderReactions(ph) {
    const box = $('#lbReact'); if (!box) return;
    const own = ph.pid === me().id;
    const canReact = !own && (me().role === 'runner' || me().role === 'hunter' || me().role === 'spectator');
    box.replaceChildren(
      h('div', { class: 'reacts' }, reactionText(ph.reactions) || (own ? 'Noch keine Reaktionen auf dein Foto.' : '')),
      canReact ? h('div', { class: 'reactbar' }, REACTIONS.map((e) => h('button', {
        class: ph.myReaction === e ? 'on' : '', 'aria-label': `Reagieren mit ${e}`,
        onclick: async () => {
          try {
            const r = await api(`/api/g/${CODE}/photo/${ph.id}/react`, { method: 'POST', token: TOKEN, body: { emoji: e } });
            ph.myReaction = r.reaction; refresh();
          } catch (x) { toast(x.message); }
        },
      }, e))) : null,
      !own && me().role !== 'admin' ? h('button', { class: 'btn small light', onclick: async () => {
        const rep = MH.askReport('Foto'); if (!rep) return;
        try { await api(`/api/g/${CODE}/photo/${ph.id}/report`, { method: 'POST', token: TOKEN, body: rep }); toast('Danke, die Admins schauen sich das an.'); } catch (x) { toast(x.message); }
      } }, '🚩 Foto melden') : null);
  }

  /* --- Uhren und Live-Felder (jede Sekunde) --- */
  function updateClocks() {
    const t = nowMs();
    for (const el of document.querySelectorAll('[data-clock]')) {
      const ts = Number(el.dataset.ts), k = el.dataset.clock;
      el.textContent = k === 'until' ? dur(ts - t) : k === 'since' ? dur(t - ts) : ago(t - ts);
    }
    for (const el of document.querySelectorAll('[data-progress]')) {
      const [a, b] = el.dataset.progress.split(',').map(Number);
      el.style.width = `${Math.min(100, Math.max(0, ((t - a) / (b - a)) * 100))}%`;
    }
  }
  function updateGps() {
    const el = $('#gpsInfo'); if (!el) return;
    el.textContent = lastFix ? `GPS ±${Math.round(lastFix.acc)} m, zuletzt ${ago(Date.now() - lastFix.ts)}` : 'Suche GPS …';
  }
  function computeAlerts() {
    const a = [];
    if (!S) return a;
    const g = S.game, s = S.settings, r = me().role;
    if (g.status === 'running' && shouldShare() && !tracking) a.push({ bad: true, text: 'Dein Standort ist nicht freigegeben. Tippe im Tab „Lage“ auf „Standort freigeben“.' });
    if (tracking && geoErr) a.push({ bad: true, text: geoErr });
    if (g.status === 'running' && r === 'runner' && !me().caught && s.zoneEnabled && lastFix && haversine(lastFix.lat, lastFix.lng, s.zoneLat, s.zoneLng) > s.zoneRadiusM) a.push({ bad: true, text: 'Du bist außerhalb der Spielzone!' });
    const ps = photoState();
    if (ps && ps.overdue) a.push({ bad: false, text: 'Foto fällig! Tippe im Tab „Lage“ auf „Foto aufnehmen“.' });
    const live = S.self.live;
    if (live) a.push({ bad: true, text: { photo: '📡 Foto zu spät – dein Standort wird LIVE geteilt!', order: '📸 Fotobefehl verpasst – dein Standort ist LIVE!', radar: '📡 Radar der Hunter – du bist live sichtbar!', ping: '🎯 Du wurdest angepeilt – live sichtbar!' }[live] || 'Dein Standort ist live.' });
    if (S.self.photoOrderDue && S.self.photoOrderDue > nowMs()) a.push({ bad: true, text: `📸 Fotobefehl! Noch ${dur(S.self.photoOrderDue - nowMs())} für ein Foto.` });
    return a;
  }
  function updateBanner() {
    const alerts = computeAlerts(), sig = JSON.stringify(alerts);
    if (sig === bannerSig) return;
    bannerSig = sig;
    $('#banner').replaceChildren(...alerts.map((x) => h('div', { class: `alert${x.bad ? ' bad' : ''}`, role: 'alert' }, x.text)));
  }
  function checkPhotoAlarm() {
    const ps = photoState(), overdue = !!(ps && ps.overdue);
    if (overdue && (!wasOverdue || Date.now() - lastAlarmAt > 30000)) { alarm(); lastAlarmAt = Date.now(); }
    if (overdue !== wasOverdue) { wasOverdue = overdue; document.title = (overdue ? 'FOTO! – ' : '') + baseTitle; renderLage(); }
  }
  function tick() {
    if (!S) return;
    updateClocks(); updateGps(); updateDistance(); checkPhotoAlarm(); updateBanner(); renderFreeze();
    if (!releaseHandled && S.game.status === 'running' && S.game.releaseAt && nowMs() >= S.game.releaseAt) { releaseHandled = true; refresh(); }
    maybeSend();
  }

  /* ---------------------------------------------------------------- */
  /* Daten laden                                                      */
  /* ---------------------------------------------------------------- */
  function authLost() {
    if (adminMode) { alert('Die Admin-Anmeldung ist abgelaufen. Bitte melde dich im Admin-Bereich neu an.'); location.href = '/admin'; return; }
    localStorage.removeItem(IDKEY);
    alert('Du bist in diesem Spiel nicht mehr angemeldet (entfernt oder Spiel gelöscht).');
    location.href = '/';
  }
  async function refresh() {
    if (refreshing) { again = true; return; }
    refreshing = true;
    try {
      const st = await api(`/api/g/${CODE}/state`, { token: TOKEN });
      offset = st.now - Date.now();
      const prev = S; S = st;
      onState(prev);
    } catch (e) {
      if (e.status === 401 || e.status === 404) authLost();
    } finally { refreshing = false; if (again) { again = false; refresh(); } }
  }
  function onState(prev) {
    const g = S.game, r = me().role;
    $('#gameName').textContent = g.name;
    const chip = $('#roleChip'); chip.hidden = false; chip.textContent = roleName(r);
    const pill = $('#statusPill'); pill.hidden = false; pill.textContent = { lobby: 'Lobby', running: 'Läuft', ended: 'Beendet' }[g.status];

    if (seenPhotos === null) { seenPhotos = new Set(S.photos.map((p) => p.id)); seenMsg = new Set(S.messages.map((m) => m.id)); }
    else {
      for (const m of S.messages) if (!seenMsg.has(m.id)) { seenMsg.add(m.id); if (m.kind === 'admin') { toast(`Spielleitung: ${m.text}`, 8000); buzz([200, 100, 200]); } else toast(m.text, 4500); }
      if (r !== 'runner') for (const ph of S.photos) if (!seenPhotos.has(ph.id)) { seenPhotos.add(ph.id); const p = S.players.find((x) => x.id === ph.pid); toast(`Neues Foto von ${p ? p.name : 'einem Runner'}`); }
      for (const ph of S.photos) seenPhotos.add(ph.id);
    }
    if (prev && prev.game.status !== g.status) {
      if (g.status === 'running') { nextSendAt = 0; releaseHandled = false; buzz([300, 100, 300]); }
      if (g.status === 'ended') buzz([500, 150, 500]);
      if (g.status === 'lobby') { seenPhotos = new Set(); photoSig = ''; localLastPhoto = 0; }
    }
    if (prev && (prev.settings.locationIntervalSec !== S.settings.locationIntervalSec || prev.self.live !== S.self.live)) nextSendAt = 0;
    if (seenInbox === null) seenInbox = new Set((S.self.inbox || []).map((m) => m.id));
    else for (const m of S.self.inbox || []) if (!seenInbox.has(m.id)) { seenInbox.add(m.id); toast(m.text, 6000); buzz(m.kind === 'bad' ? [400, 150, 400] : [150]); }
    if (g.status === 'running' && !prev) releaseHandled = !(g.releaseAt && nowMs() < g.releaseAt);
    if (prev && prevCaught === false && me().caught) buzz([600]);
    prevCaught = me().caught;

    if (!map) { initMap(); if (r !== 'admin' && !tracking) autoStart(); }
    updateMap(); renderLage(); renderPlayers(); renderPhotos(); renderActions(); renderChat(); renderFreeze(); updateBanner();
    const newChat = (S.chat || []).filter((c) => c.pid !== me().id && !seenChat.has(c.id));
    if (seenChat.size || !prev) for (const c of newChat) if (prev && tab !== 'chat') toast(`💬 ${c.name}: ${c.voice ? '🎙️ Sprachnachricht' : c.text}`, 5000);
    for (const c of S.chat || []) seenChat.add(c.id);
    $('#tabbtn-chat').textContent = newChat.length && tab !== 'chat' && prev ? `Chat (${newChat.length})` : 'Chat';
  }
  async function autoStart() {
    try {
      if (navigator.permissions && navigator.permissions.query) {
        const st = await navigator.permissions.query({ name: 'geolocation' });
        if (st.state === 'granted') startTracking();
      }
    } catch { /* Permissions-API nicht verfügbar */ }
  }

  function startApp() {
    $('#app').hidden = false;
    $('#gameName').textContent = ident ? '' : 'Spielleitung';
    document.addEventListener('pointerdown', unlockAudio, { once: true });
    for (const b of document.querySelectorAll('.dock > .tabs button')) b.addEventListener('click', () => selectTab(b.dataset.tab));
    $('#photoInput').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; onPhotoChosen(f); });
    $('#lbClose').addEventListener('click', () => $('#lightbox').close());
    $('#lightbox').addEventListener('click', (e) => { if (e.target === $('#lightbox')) $('#lightbox').close(); });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) { refresh(); if (tracking && !wakeLock) requestWake(); } });
    refresh();
    try {
      const es = new EventSource(`/api/g/${CODE}/events?t=${encodeURIComponent(TOKEN)}`);
      es.addEventListener('update', () => refresh());
    } catch { /* Polling reicht als Ersatz */ }
    setInterval(refresh, 20000);
    setInterval(tick, 1000);
  }
  function selectTab(name) {
    tab = name;
    for (const b of document.querySelectorAll('.dock > .tabs button')) {
      const on = b.dataset.tab === name;
      b.setAttribute('aria-selected', String(on));
      $(`#tab-${b.dataset.tab}`).hidden = !on;
    }
    if (name === 'photos') { photoSig = ''; if (S) renderPhotos(); }
    if (name === 'chat' && S) { $('#tabbtn-chat').textContent = 'Chat'; renderChat(true); }
  }

  if (TOKEN) startApp();
  else if (account.token()) {
    // Mit dem Account schon in diesem Spiel (z. B. in der App beigetreten) oder vergangenes Spiel aus dem Spielverlauf
    api(`/api/g/${CODE}/state`, { token: account.token() })
      .then(() => { TOKEN = account.token(); startApp(); })
      .catch(() => showJoin());
  } else showJoin();
})();
