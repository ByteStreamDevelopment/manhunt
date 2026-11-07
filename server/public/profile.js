'use strict';
/* Profil: Statistik, Abzeichen, Saisons, Spielverlauf – beim eigenen Profil auch Freunde und Einladungen. */
(() => {
  const { $, h, api, account, toast, pushCard } = MH;
  const card = (cls, ...kids) => h('div', { class: `card ${cls || ''}` }, ...kids);
  const date = (ts) => new Date(ts).toLocaleDateString('de-DE');
  const monthName = (k) => { const [y, m] = k.split('-'); return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('de-DE', { month: 'long', year: 'numeric' }); };
  let CAT = { badges: [] };

  async function render() {
    const acc = account.get();
    const u = new URLSearchParams(location.search).get('u') || (acc && acc.username);
    if (!u) { $('#main').replaceChildren(h('p', {}, 'Melde dich an, um dein Profil zu sehen.'), MHAuth.box(render)); return; }
    let p;
    try { p = await api(`/api/profile/${encodeURIComponent(u)}`, { acc: acc && acc.token }); }
    catch (e) { $('#main').replaceChildren(card('danger', h('p', {}, e.message))); return; }
    $('#title').textContent = p.username;
    document.title = `Manhunt – ${p.username}`;
    const s = p.stats || {};
    const kids = [];
    kids.push(card('stack',
      h('h1', {}, p.username, p.isAdmin ? ' 👑' : ''),
      h('p', { class: 'muted' }, `${p.online ? '🟢 online · ' : ''}dabei seit ${date(p.createdAt)}`),
      h('div', { class: 'statgrid' }, [['Punkte', s.points], ['Spiele', s.games], ['Siege', s.wins], ['Fänge', s.catches], ['Quests', s.quests], ['Überlebt', `${s.surviveMin || 0} min`], ['Pickups', s.pickups], ['⭐ Fotos', s.featured]]
        .map(([l, v]) => h('div', {}, h('b', {}, String(v ?? 0)), h('span', {}, l)))),
      friendButton(p, acc)));
    if (p.self) { const pc = pushCard(); if (pc) kids.push(pc); kids.push(await friendsCard(acc)); }
    // Abzeichen
    kids.push(card('', h('h2', {}, `🏅 Abzeichen (${Object.keys(p.badges).length}/${CAT.badges.length})`),
      h('div', { class: 'badgegrid' }, CAT.badges.map((b) => h('div', { class: p.badges[b.key] ? 'got' : 'missing', title: b.desc },
        h('span', { class: 'bi' }, b.icon), h('b', {}, b.name), h('span', { class: 'small' }, b.desc),
        p.badges[b.key] ? h('span', { class: 'small muted' }, date(p.badges[b.key])) : null)))));
    // Saisons
    if (p.seasons.length) {
      kids.push(card('', h('h2', {}, '📅 Saisons'), h('ul', { class: 'plist' }, p.seasons.map((x) => h('li', {},
        h('div', { class: 'grow' }, h('div', { class: 'name' }, monthName(x.season)), h('div', { class: 'small muted' }, `${x.games} Spiele · ${x.wins} Siege · ${x.catches} Fänge`)),
        x.rank ? h('span', { class: `chip ${x.rank <= 3 ? 'gold' : 'plain'}` }, `${['🥇', '🥈', '🥉'][x.rank - 1] || ''} Platz ${x.rank} von ${x.of}`) : null,
        h('b', {}, `${x.points} P`))))));
    }
    // Verlauf
    const RES = { win: '🏆 Sieg', loss: 'Niederlage', none: 'ohne Wertung' };
    kids.push(card('', h('h2', {}, '🕘 Letzte Spiele'), p.history.length ? h('ul', { class: 'plist' }, p.history.map((x) => h('li', {},
      h('span', { class: `chip ${x.role}` }, x.converted ? 'Runner → Hunter' : x.role === 'runner' ? 'Runner' : 'Hunter'),
      h('div', { class: 'grow' }, h('div', { class: 'name' }, x.name), h('div', { class: 'small muted' }, `${date(x.endedAt)} · ${RES[x.result]}${x.catches ? ` · ${x.catches} gefangen` : ''}${x.caught ? ' · wurde gefangen' : ''}`)),
      h('b', {}, `${x.points} P`)))) : h('p', { class: 'muted' }, 'Noch keine Spiele.')));
    $('#main').replaceChildren(...kids);
  }

  function friendButton(p, acc) {
    if (!acc || p.self) return null;
    const act = async (path, body) => { try { await api(`/api/friends/${path}`, { method: 'POST', acc: acc.token, body }); render(); } catch (e) { toast(e.message); } };
    if (p.friendship === 'friends') return h('button', { class: 'btn light', onclick: () => confirm(`${p.username} als Freund entfernen?`) && act('remove', { username: p.username }) }, '✔ Befreundet');
    if (p.friendship === 'requested') return h('span', { class: 'chip plain' }, 'Anfrage gesendet');
    if (p.friendship === 'incoming') return h('button', { class: 'btn', onclick: () => act('respond', { username: p.username, accept: true }) }, 'Anfrage annehmen');
    return h('button', { class: 'btn', onclick: () => act('request', { username: p.username }) }, '➕ Als Freund hinzufügen');
  }

  async function friendsCard(acc) {
    let f;
    try { f = await api('/api/friends', { acc: acc.token }); } catch (e) { return card('danger', h('p', {}, e.message)); }
    const act = async (path, body) => { try { await api(`/api/friends/${path}`, { method: 'POST', acc: acc.token, body }); render(); } catch (e) { toast(e.message); } };
    const input = h('input', { type: 'text', placeholder: 'Benutzername', maxlength: '20' });
    return card('stack',
      h('h2', {}, `👥 Freunde (${f.friends.length})`),
      f.invites.length ? h('div', { class: 'stack' }, h('h3', {}, '🎮 Einladungen'), h('ul', { class: 'plist' }, f.invites.map((i) => h('li', {},
        h('div', { class: 'grow' }, h('div', { class: 'name' }, i.gameName), h('div', { class: 'small muted' }, `von ${i.from} · ${new Date(i.ts).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`)),
        h('a', { class: 'btn small', href: `/g/${i.code}` }, 'Beitreten'),
        h('button', { class: 'btn small light', onclick: () => act('invites/dismiss', { id: i.id }) }, '✕'))))) : null,
      f.incoming.length ? h('div', {}, h('h3', {}, 'Anfragen'), h('ul', { class: 'plist' }, f.incoming.map((x) => h('li', {},
        h('a', { class: 'grow name', href: `/profile?u=${encodeURIComponent(x.username)}` }, x.username),
        h('button', { class: 'btn small', onclick: () => act('respond', { username: x.username, accept: true }) }, 'Annehmen'),
        h('button', { class: 'btn small light', onclick: () => act('respond', { username: x.username, accept: false }) }, 'Ablehnen'))))) : null,
      f.friends.length ? h('ul', { class: 'plist' }, f.friends.map((x) => h('li', {},
        h('span', {}, x.online ? '🟢' : '⚪'),
        h('a', { class: 'grow name', href: `/profile?u=${encodeURIComponent(x.username)}` }, x.username),
        h('span', { class: 'small muted' }, x.online ? 'online' : x.lastSeen ? `zuletzt ${date(x.lastSeen)}` : '')))) : h('p', { class: 'muted' }, 'Noch keine Freunde. Füge jemanden über den Benutzernamen hinzu.'),
      f.outgoing.length ? h('p', { class: 'small muted' }, `Offene Anfragen: ${f.outgoing.map((x) => x.username).join(', ')}`) : null,
      h('div', { class: 'row' }, input, h('button', { class: 'btn', onclick: () => input.value.trim() && act('request', { username: input.value.trim() }) }, 'Anfragen')),
      h('div', { class: 'row' }, h('button', { class: 'btn small light', onclick: () => { account.set(null); location.href = '/'; } }, 'Abmelden')));
  }

  api('/api/catalog').then((c) => { CAT = c; }).catch(() => {}).finally(render);
})();
