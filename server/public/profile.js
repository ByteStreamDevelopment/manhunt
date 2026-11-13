'use strict';
/* Profil: Statistik, Abzeichen, Saisons, Spielverlauf – beim eigenen Profil auch Freunde und Einladungen. */
(() => {
  const { $, h, api, account, toast, pushCard } = MH;
  const card = (cls, ...kids) => h('div', { class: `card ${cls || ''}` }, ...kids);
  const date = (ts) => new Date(ts).toLocaleDateString('de-DE');
  const monthName = (k) => { const [y, m] = k.split('-'); return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('de-DE', { month: 'long', year: 'numeric' }); };
  let CAT = { badges: [] };

  /** Konto & Datenschutz: E-Mail-Einstellungen, Daten herunterladen, Passwort ändern, Konto löschen */
  async function accountCard(acc) {
    let prefs = null;
    try { prefs = await api('/api/me/prefs', { acc: acc.token }); } catch { /* egal */ }
    const boxes = prefs ? Object.entries(prefs.categories).map(([k, label]) => {
      const i = h('input', { type: 'checkbox', id: `mp_${k}`, checked: !!prefs.mailPrefs[k] });
      i.addEventListener('change', async () => {
        try { await api('/api/me/prefs', { method: 'POST', acc: acc.token, body: { mailPrefs: { [k]: i.checked } } }); toast('Gespeichert'); }
        catch (e) { i.checked = !i.checked; toast(e.message); }
      });
      return h('label', { class: 'consent', for: `mp_${k}` }, i, h('span', {}, label));
    }) : [];
    const pwOld = h('input', { type: 'password', placeholder: 'Bisheriges Passwort', autocomplete: 'current-password' });
    const pwNew = h('input', { type: 'password', placeholder: 'Neues Passwort (mind. 8 Zeichen)', autocomplete: 'new-password' });
    const delPw = h('input', { type: 'password', placeholder: 'Passwort zur Bestätigung', autocomplete: 'current-password' });
    return card('stack',
      h('h2', {}, '🔒 Konto & Datenschutz'),
      h('h3', {}, 'E-Mails'),
      prefs && !prefs.mailConfigured ? h('p', { class: 'small muted' }, 'Hinweis: Auf diesem Server ist noch kein Mailversand eingerichtet.') : null,
      ...boxes,
      h('p', { class: 'small muted' }, 'Pflicht-Mails (Bestätigung, Passwort, Sicherheit) bekommst du immer.'),
      h('h3', {}, 'Meine Daten'),
      h('p', { class: 'small' }, 'Lade alle Daten herunter, die Manhunt zu deinem Konto gespeichert hat – als ZIP mit daten.json und deinen Fotos (Art. 15 und 20 DSGVO).'),
      h('a', { class: 'btn small light', href: `/api/me/export?t=${encodeURIComponent(acc.token)}` }, '⬇️ Meine Daten herunterladen'),
      h('h3', {}, 'Passwort ändern'),
      pwOld, pwNew,
      h('button', { class: 'btn small light', onclick: async () => {
        try {
          const r = await api('/api/me/password', { method: 'POST', acc: acc.token, body: { oldPassword: pwOld.value, newPassword: pwNew.value } });
          account.set({ ...acc, token: r.token }); pwOld.value = ''; pwNew.value = ''; toast('Passwort geändert – andere Geräte sind abgemeldet');
        } catch (e) { toast(e.message); }
      } }, 'Passwort ändern'),
      h('h3', {}, 'Konto löschen'),
      h('p', { class: 'small' }, 'Löscht dein Konto mit Profil, Profilbild, Vitrine, Freundschaften, Vorlagen sowie deinen Standorten, Fotos und Nachrichten in allen Runden. In Ergebnissen anderer erscheinst du als „Gelöschter Spieler“. Das kann nicht rückgängig gemacht werden.'),
      delPw,
      h('button', { class: 'btn small hunter', onclick: async () => {
        if (!confirm('Konto wirklich endgültig löschen?')) return;
        try { await api('/api/me/delete', { method: 'POST', acc: acc.token, body: { password: delPw.value } }); account.set(null); localStorage.removeItem('manhunt:admin'); alert('Dein Konto wurde gelöscht.'); location.href = '/'; }
        catch (e) { toast(e.message); }
      } }, 'Konto endgültig löschen'),
      h('p', { class: 'small' }, h('a', { href: '/datenschutz' }, 'Datenschutzerklärung'), ' · ', h('a', { href: '/impressum' }, 'Impressum')));
  }

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
    const avatarSrc = p.avatar ? `/api/avatar/${encodeURIComponent(p.username)}?v=${p.avatar}` : null;
    kids.push(card('stack',
      h('div', { class: 'row' },
        avatarSrc ? h('img', { class: 'avatar big', src: avatarSrc, alt: '' }) : h('div', { class: 'avatar big', style: 'display:grid;place-items:center;font-size:2.5rem' }, '👤'),
        h('h1', { style: 'margin:0' }, p.username, p.isAdmin ? ' 👑' : '')),
      p.self ? avatarControls(p, acc) : null,
      h('p', { class: 'muted' }, `${p.online ? '🟢 online · ' : ''}dabei seit ${date(p.createdAt)}`),
      h('div', { class: 'statgrid' }, [['Punkte', s.points], ['Spiele', s.games], ['Siege', s.wins], ['Fänge', s.catches], ['Quests', s.quests], ['Überlebt', `${s.surviveMin || 0} min`], ['Pickups', s.pickups], ['⭐ Fotos', s.featured]]
        .map(([l, v]) => h('div', {}, h('b', {}, String(v ?? 0)), h('span', {}, l)))),
      friendButton(p, acc)));
    if (p.self) { const pc = pushCard(); if (pc) kids.push(pc); kids.push(await friendsCard(acc)); }
    // Vitrine: ausgestellte Fotos (Issue #8)
    if (p.showcase.length || p.self) {
      kids.push(card('', h('h2', {}, '🖼️ Vitrine'),
        p.showcase.length ? h('div', { class: 'photos' }, p.showcase.map((x) => h('figure', {},
          h('a', { href: `/api/showcase/${x.id}.jpg`, target: '_blank' }, h('img', { src: `/api/showcase/${x.id}.jpg`, alt: x.caption || '', loading: 'lazy' })),
          h('figcaption', {}, x.caption || x.gameName, h('div', { class: 'small muted' }, `${x.gameName} · ${date(x.ts)}`)),
          p.self ? h('button', { class: 'btn small light', onclick: async () => {
            try { await api(`/api/me/showcase/${x.id}`, { method: 'DELETE', acc: acc.token }); render(); } catch (e) { toast(e.message); }
          } }, 'Entfernen') : null))) : h('p', { class: 'muted' }, 'Noch nichts ausgestellt. Wähle unten in deiner Galerie Fotos aus.')));
    }
    if (p.self) kids.push(await myGalleryCard(acc));
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
      h('b', {}, `${x.points} P`),
      // Issue #7: vergangene Runde nochmal ansehen (Karte mit Wiederholung, Fotos, ZIP)
      p.self && x.available ? h('a', { class: 'btn small light', href: `/g/${x.code}` }, 'Ansehen') : null))) : h('p', { class: 'muted' }, 'Noch keine Spiele.')));
    if (p.self) kids.push(await accountCard(acc));
    $('#main').replaceChildren(...kids);
  }

  /* Profilbild (Issue #7): im Browser quadratisch auf 256 px verkleinern und als JPEG hochladen */
  function avatarControls(p, acc) {
    const input = h('input', { type: 'file', accept: 'image/*', hidden: true });
    input.addEventListener('change', async () => {
      const f = input.files[0]; input.value = '';
      if (!f) return;
      try {
        const bmp = await createImageBitmap(f, { imageOrientation: 'from-image' });
        const side = Math.min(bmp.width, bmp.height);
        const c = document.createElement('canvas'); c.width = 256; c.height = 256;
        c.getContext('2d').drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, 256, 256);
        const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.85));
        await api('/api/me/avatar', { method: 'POST', acc: acc.token, body: blob, contentType: 'image/jpeg' });
        toast('Profilbild gespeichert'); render();
      } catch (e) { toast(e.message || 'Bild konnte nicht verarbeitet werden'); }
    });
    return h('div', { class: 'row' }, input,
      h('button', { class: 'btn small light', onclick: () => input.click() }, p.avatar ? '🖼️ Profilbild ändern' : '🖼️ Profilbild hochladen'),
      p.avatar ? h('button', { class: 'btn small light', onclick: async () => { await api('/api/me/avatar', { method: 'DELETE', acc: acc.token }); render(); } }, 'Entfernen') : null);
  }

  /* Persönliche Galerie (Issue #8): alle eigenen Fotos aus allen Spielen, mit „Ausstellen“ */
  async function myGalleryCard(acc) {
    let list = [];
    try { list = (await api('/api/me/photos', { acc: acc.token })).photos; } catch (e) { return card('danger', h('p', {}, e.message)); }
    return card('', h('h2', {}, `📸 Meine Fotos (${list.length})`),
      h('p', { class: 'small muted' }, 'Alle deine Fotos aus Spielen, die noch auf dem Server liegen. Mit „Ausstellen“ kommen sie dauerhaft auf dein Profil.'),
      list.length ? h('div', { class: 'photos' }, list.map((x) => {
        const src = `/api/g/${x.code}/photo/${x.id}?t=${encodeURIComponent(acc.token)}`;
        const reacts = Object.entries(x.reactions || {}).map(([e, n]) => `${e}${n > 1 ? n : ''}`).join(' ');
        return h('figure', {},
          h('a', { href: src, target: '_blank' }, h('img', { src, alt: '', loading: 'lazy' })),
          h('figcaption', {}, `${x.gameName} · ${date(x.ts)}`, x.questTitle ? h('div', { class: 'small' }, `📜 ${x.questTitle}`) : null, reacts ? h('div', { class: 'reacts' }, reacts) : null),
          x.showcased ? h('span', { class: 'chip gold' }, '🖼️ ausgestellt') : h('button', { class: 'btn small light', onclick: async () => {
            const caption = prompt('Bildunterschrift (optional):', '');
            if (caption === null) return;
            try { await api('/api/me/showcase', { method: 'POST', acc: acc.token, body: { code: x.code, photoId: x.id, caption } }); toast('Ausgestellt'); render(); } catch (e) { toast(e.message); }
          } }, '🖼️ Ausstellen'));
      })) : h('p', { class: 'muted' }, 'Noch keine Fotos.'));
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
