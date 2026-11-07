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
