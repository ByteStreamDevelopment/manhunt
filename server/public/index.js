'use strict';
(() => {
  const { $, h, api, account, pushCard } = MH;
  const input = $('#code'), err = $('#err');

  function render() {
    const acc = account.get();
    $('#joinCard').hidden = !acc;
    $('#authSlot').replaceChildren(acc ? '' : MHAuth.box(render));
    if (acc) $('#accName').textContent = acc.username;
    $('#profileLink').hidden = !acc;
    $('#pushSlot').replaceChildren(acc ? pushCard() || '' : '');
    $('#invites').replaceChildren();
    startPublic();
    if (acc) {
      api('/api/friends', { acc: acc.token }).then((f) => {
        const kids = [];
        if (f.invites.length) kids.push(h('div', { class: 'card gold stack' }, h('h3', {}, '🎮 Einladungen'), h('ul', { class: 'plist' }, f.invites.map((i) => h('li', {},
          h('div', { class: 'grow' }, h('b', {}, i.gameName), h('div', { class: 'small' }, `von ${i.from}`)), h('a', { class: 'btn small', href: `/g/${i.code}` }, 'Beitreten'))))));
        if (f.incoming.length) kids.push(h('div', { class: 'card stack' }, h('p', {}, `👥 ${f.incoming.length} Freundschaftsanfrage(n)`), h('a', { class: 'btn small', href: '/profile' }, 'Ansehen')));
        $('#invites').replaceChildren(...kids);
      }).catch((e) => { if (e.status === 401) { account.set(null); render(); } });
    }
  }
  /* Offene Runden (öffentlich gelistet), wenn erlaubt nach Entfernung sortiert */
  async function loadPublic(pos) {
    const acc = account.get();
    const box = $('#publicGames');
    if (!acc) { box.replaceChildren(); return; }
    try {
      const q = pos ? `?lat=${pos.coords.latitude.toFixed(3)}&lng=${pos.coords.longitude.toFixed(3)}` : '';
      const { games } = await api(`/api/public-games${q}`, { acc: acc.token });
      const near = h('button', { class: 'btn small light', onclick: () => navigator.geolocation.getCurrentPosition(loadPublic, () => MH.toast('Standort nicht verfügbar'), { timeout: 15000 }) }, '📍 In meiner Nähe');
      box.replaceChildren(h('div', { class: 'card stack' },
        h('div', { class: 'row between' }, h('h3', {}, '🌍 Offene Runden'), pos ? null : near),
        games.length ? h('ul', { class: 'plist' }, games.map((g) => h('li', {},
          h('div', { class: 'grow' }, h('b', {}, g.name), h('div', { class: 'small muted' },
            [g.status === 'running' ? 'läuft' : 'wartet auf Start', `${g.runners} Runner, ${g.hunters} Hunter`, g.owner && `von ${g.owner}`,
              g.place, g.km != null && `${g.km} km entfernt`].filter(Boolean).join(' · '))),
          h('a', { class: 'btn small', href: `/g/${g.code}` }, g.joined ? 'Öffnen' : 'Ansehen'))))
          : h('p', { class: 'small muted' }, pos ? 'Gerade keine offenen Runden in deiner Nähe.' : 'Gerade keine offenen Runden.')));
    } catch { box.replaceChildren(); }
  }
  function startPublic() {
    if (navigator.permissions) navigator.permissions.query({ name: 'geolocation' }).then((st) => {
      if (st.state === 'granted') navigator.geolocation.getCurrentPosition(loadPublic, () => loadPublic(null), { timeout: 15000 }); else loadPublic(null);
    }).catch(() => loadPublic(null)); else loadPublic(null);
  }
  $('#logoutBtn').addEventListener('click', () => { account.set(null); render(); });

  async function go() {
    const code = input.value.trim().toUpperCase();
    err.textContent = '';
    if (code.length < 3) { err.textContent = 'Bitte den Spielcode eingeben.'; return; }
    try { await api(`/api/g/${code}/info`); location.href = `/g/${code}`; }
    catch (e) { err.textContent = e.status === 404 ? 'Diesen Code gibt es nicht.' : e.message; }
  }
  $('#go').addEventListener('click', go);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });

  // Bereits beigetretene Spiele
  const items = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!/^manhunt:[A-Z0-9]{3,10}$/.test(k)) continue;
    try { const v = JSON.parse(localStorage.getItem(k)); items.push({ code: k.slice(8), ...v }); } catch { /* ignorieren */ }
  }
  if (items.length) {
    $('#recent').hidden = false;
    $('#recentList').append(...items.map((it) => h('li', {},
      h('span', { class: 'mono' }, it.code),
      h('span', { class: 'grow' }, `${it.name} `, h('span', { class: `chip ${it.role}` }, it.role === 'runner' ? 'Runner' : 'Hunter')),
      h('a', { class: 'btn small light', href: `/g/${it.code}` }, 'Öffnen'),
    )));
  }
  render();
})();
