'use strict';
(() => {
  const { $, h, api } = MH;
  $('#lbClose').addEventListener('click', () => $('#lightbox').close());
  api('/api/gallery').then(({ items }) => {
    if (!items.length) { $('#grid').replaceChildren(h('p', { class: 'muted' }, 'Noch keine Fotos ausgewählt.')); return; }
    $('#grid').replaceChildren(h('div', { class: 'photos' }, items.map((it) => {
      const src = `/api/gallery/${it.id}.jpg`;
      const date = new Date(it.ts).toLocaleDateString('de-DE');
      const cap = `📷 ${it.username} · ${it.gameName} · ${date}${it.quest ? ` · ${it.quest}` : ''}${it.caption ? ` – „${it.caption}“` : ''}`;
      return h('figure', {},
        h('button', { onclick: () => { $('#lbImg').src = src; $('#lbCap').textContent = cap; $('#lightbox').showModal(); } }, h('img', { src, alt: it.caption || `Foto von ${it.username}`, loading: 'lazy' })),
        h('figcaption', {}, h('b', {}, it.username), it.caption ? ` – ${it.caption}` : ''));
    })));
  }).catch((e) => $('#grid').replaceChildren(h('p', { class: 'err' }, e.message)));
})();
