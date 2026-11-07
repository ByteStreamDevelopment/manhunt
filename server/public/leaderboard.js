'use strict';
(() => {
  const { $, h, api } = MH;
  const COLS = [['points', 'Punkte'], ['wins', 'Siege'], ['catches', 'Fänge'], ['quests', 'Quests'], ['surviveMin', 'Überlebt (min)'], ['pickups', 'Pickups'], ['featured', '⭐'], ['games', 'Spiele']];
  let sort = 'points';
  async function load() {
    try {
      const { rows } = await api(`/api/leaderboard?sort=${sort}`);
      if (!rows.length) { $('#board').replaceChildren(h('p', { class: 'muted' }, 'Noch keine Spiele gespielt.')); return; }
      $('#board').replaceChildren(h('table', { class: 'board' },
        h('thead', {}, h('tr', {}, h('th', {}, '#'), h('th', {}, 'Spieler'), COLS.map(([k, l]) => h('th', {}, k === 'games' ? l : h('button', { onclick: () => { sort = k; load(); } }, (sort === k ? '▼ ' : '') + l))))),
        h('tbody', {}, rows.map((r, i) => h('tr', { class: i === 0 ? 'top1' : '' },
          h('td', {}, i < 3 ? ['🥇', '🥈', '🥉'][i] : i + 1), h('td', {}, r.username, r.isAdmin ? ' 👑' : '', h('div', { class: 'badges' }, (r.badges || []).map((k) => BADGES[k] && h('span', { title: `${BADGES[k].name}: ${BADGES[k].desc}` }, BADGES[k].icon)))),
          COLS.map(([k]) => h('td', {}, r[k] ?? 0)))))));
    } catch (e) { $('#board').replaceChildren(h('p', { class: 'err' }, e.message)); }
  }
  load();
})();
