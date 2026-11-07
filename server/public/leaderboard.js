'use strict';
(() => {
  const { $, h, api } = MH;
  const COLS = [['points', 'Punkte'], ['wins', 'Siege'], ['catches', 'Fänge'], ['quests', 'Quests'], ['surviveMin', 'Überlebt (min)'], ['pickups', 'Pickups'], ['featured', '⭐'], ['games', 'Spiele']];
  const monthName = (k) => { const [y, m] = k.split('-'); return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('de-DE', { month: 'long', year: 'numeric' }); };
  let sort = 'points', season = 'current', BADGES = {};

  async function seasons() {
    try {
      const { current, seasons: list } = await api('/api/seasons');
      const sel = h('select', { 'aria-label': 'Saison' },
        h('option', { value: 'current' }, `Diese Saison (${monthName(current)})`),
        h('option', { value: 'all' }, 'Ewige Bestenliste'),
        list.filter((k) => k !== current).map((k) => h('option', { value: k }, monthName(k))));
      sel.value = season;
      sel.addEventListener('change', () => { season = sel.value; load(); });
      $('#seasonSel').replaceChildren(sel);
    } catch { /* ohne Auswahl */ }
  }

  async function load() {
    try {
      const { rows } = await api(`/api/leaderboard?sort=${sort}&season=${season}`);
      if (!rows.length) { $('#board').replaceChildren(h('p', { class: 'muted' }, season === 'current' ? 'In dieser Saison wurde noch nicht gespielt.' : 'Noch keine Spiele gespielt.')); return; }
      $('#board').replaceChildren(h('table', { class: 'board' },
        h('thead', {}, h('tr', {}, h('th', {}, '#'), h('th', {}, 'Spieler'), COLS.map(([k, l]) => h('th', {}, k === 'games' ? l : h('button', { onclick: () => { sort = k; load(); } }, (sort === k ? '▼ ' : '') + l))))),
        h('tbody', {}, rows.map((r, i) => h('tr', { class: i === 0 ? 'top1' : '' },
          h('td', {}, i < 3 ? ['🥇', '🥈', '🥉'][i] : i + 1),
          h('td', {}, h('a', { class: 'name', href: `/profile?u=${encodeURIComponent(r.username)}` }, r.username), r.isAdmin ? ' 👑' : '',
            h('div', { class: 'badges' }, (r.badges || []).map((k) => BADGES[k] && h('span', { title: `${BADGES[k].name}: ${BADGES[k].desc}` }, BADGES[k].icon)))),
          COLS.map(([k]) => h('td', {}, r[k] ?? 0)))))));
    } catch (e) { $('#board').replaceChildren(h('p', { class: 'err' }, e.message)); }
  }
  api('/api/catalog').then((c) => { BADGES = Object.fromEntries((c.badges || []).map((b) => [b.key, b])); }).catch(() => {}).finally(() => { seasons(); load(); });
})();
