'use strict';
(() => {
  const { $, h, api } = MH;
  const input = $('#code'), err = $('#err');

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
    if (!k.startsWith('manhunt:') || k === 'manhunt:admin') continue;
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
})();
