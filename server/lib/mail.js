'use strict';
/**
 * E-Mails: schön gestaltete HTML-Mails (mit Text-Fassung) für verschiedene Anlässe – DSGVO-konform:
 *  - Pflicht-Mails (Bestätigung, Passwort, Sicherheit, Kontolöschung) gehen immer raus, sie gehören zum Vertrag.
 *  - Benachrichtigungen (Freunde, Einladungen, Spielergebnisse) nur mit Einwilligung (Opt-in bei der Registrierung
 *    oder in den Einstellungen), jederzeit widerrufbar – per Ein-Klick-Abmeldelink in jeder Mail (RFC 8058).
 *  - Hinweise zu den eigenen Daten (Speicher voll, Fotos werden bald gelöscht) standardmäßig an, abbestellbar.
 *  - Keine Tracking-Pixel, keine externen Bilder, keine Weitergabe an Dritte (außer dem eigenen Mailserver).
 */

/** Abbestellbare Kategorien. default = Voreinstellung für neue Konten ohne ausdrückliche Wahl. */
const CATEGORIES = {
  friends: { label: 'Freundschaftsanfragen und neue Freunde', default: false },
  invites: { label: 'Einladungen zu Runden und Mit-Spielleitung', default: false },
  games: { label: 'Ergebnis nach jeder Runde', default: false },
  account: { label: 'Hinweise zu deinen Daten (Speicher, Fotos werden bald gelöscht)', default: true },
};
const PER_DAY = 15;            // höchstens so viele Benachrichtigungs-Mails pro Konto und Tag
const SAME_KIND_MS = 10 * 60000; // gleiche Mail (Art + Anlass) höchstens alle 10 Minuten

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtMb = (b) => `${Math.round((b || 0) / 1048576)} MB`;

/**
 * Vorlagen. Jede liefert { cat, subject, heading, lines[], code?, button?, note? }.
 * cat = null: Pflicht-Mail (immer). Nutzerinhalte (Namen, Spielnamen) werden beim Rendern escaped.
 */
function templates(base) {
  return {
    verify: (d) => ({
      cat: null, subject: 'Bestätige deine E-Mail-Adresse', preheader: `Dein Code: ${d.code}`,
      heading: `Willkommen bei Manhunt, ${d.username}!`,
      lines: ['Nur noch ein Schritt: Gib diesen Code in der App oder auf der Website ein, um dein Konto zu bestätigen.'],
      code: d.code, note: 'Der Code ist 30 Minuten gültig. Wenn du dich nicht registriert hast, ignoriere diese Mail – das Konto wird nach 7 Tagen automatisch gelöscht.',
    }),
    reset: (d) => ({
      cat: null, subject: 'Passwort zurücksetzen', preheader: `Dein Code: ${d.code}`,
      heading: 'Neues Passwort festlegen',
      lines: [`Hallo ${d.username}, mit diesem Code kannst du ein neues Passwort festlegen:`],
      code: d.code, note: 'Der Code ist 30 Minuten gültig. Wenn du das nicht angefordert hast, ignoriere diese Mail – dein Passwort bleibt unverändert.',
    }),
    welcome: (d) => ({
      cat: null, subject: 'Dein Konto ist bereit 🎉', heading: `Los geht's, ${d.username}!`,
      lines: [
        'Dein Konto ist bestätigt. So startest du:',
        '🎮 Tritt mit einem Code oder Link einer Runde bei – oder leg unter „Meine Runden“ selbst eine an.',
        '🌍 Unter „Offene Runden“ findest du öffentliche Runden in deiner Nähe.',
        '👥 Füge Freunde hinzu und lade sie direkt in deine Runden ein.',
      ],
      button: { label: 'Manhunt öffnen', url: base + '/' },
      note: d.optedIn ? 'Du bekommst Mails zu Freunden, Einladungen und Ergebnissen. Das kannst du jederzeit in den Einstellungen oder über den Link unten ändern.'
        : 'Benachrichtigungen per Mail (Freunde, Einladungen, Ergebnisse) kannst du jederzeit in den Einstellungen einschalten.',
    }),
    passwordChanged: (d) => ({
      cat: null, subject: 'Dein Passwort wurde geändert', heading: 'Passwort geändert',
      lines: [`Hallo ${d.username}, das Passwort deines Manhunt-Kontos wurde am ${d.when} geändert. Alle anderen Geräte wurden abgemeldet.`],
      note: 'Warst du das nicht? Setze sofort über „Passwort vergessen“ ein neues Passwort und melde dich bei uns.',
      button: { label: 'Passwort zurücksetzen', url: base + '/' },
    }),
    accountDeleted: (d) => ({
      cat: null, subject: 'Dein Konto wurde gelöscht', heading: `Tschüss, ${d.username}!`,
      lines: [
        'Dein Manhunt-Konto und die damit verbundenen Daten wurden gelöscht: Profil, Profilbild, Vitrine, Freundschaften, Statistik, Vorlagen, deine Fotos und Standorte in Runden.',
        'In Ergebnissen anderer Spieler erscheinst du nur noch als „Gelöschter Spieler“.',
      ],
      note: 'Das war die letzte Mail von uns. Du bist jederzeit wieder willkommen.',
    }),
    friendRequest: (d) => ({
      cat: 'friends', key: d.from, subject: `${d.from} möchte mit dir befreundet sein`, heading: 'Neue Freundschaftsanfrage',
      lines: [`<b>${esc(d.from)}</b> hat dir eine Freundschaftsanfrage geschickt. Als Freunde seht ihr, wer gerade online ist, und könnt euch direkt in Runden einladen.`],
      html: true, button: { label: 'Anfrage ansehen', url: base + '/profile' },
    }),
    friendAccepted: (d) => ({
      cat: 'friends', key: d.from, subject: `Du bist jetzt mit ${d.from} befreundet`, heading: 'Neue Freundschaft 🤝',
      lines: [`<b>${esc(d.from)}</b> hat deine Anfrage angenommen. Ihr seid jetzt befreundet – lade ${esc(d.from)} gleich in deine nächste Runde ein!`],
      html: true, button: { label: 'Profil ansehen', url: `${base}/profile?u=${encodeURIComponent(d.from)}` },
    }),
    gameInvite: (d) => ({
      cat: 'invites', key: d.code, subject: `${d.from} lädt dich zu „${d.gameName}“ ein`, heading: '🎮 Einladung zu einer Runde',
      lines: [`<b>${esc(d.from)}</b> lädt dich zur Runde <b>„${esc(d.gameName)}“</b> ein.`, `Spielcode: <b style="font-family:monospace;letter-spacing:2px">${esc(d.code)}</b>`],
      html: true, button: { label: 'Jetzt beitreten', url: `${base}/g/${d.code}` }, note: 'Die Einladung gilt 24 Stunden.',
    }),
    cohostAdded: (d) => ({
      cat: 'invites', key: d.code, subject: `Du leitest jetzt „${d.gameName}“ mit`, heading: '👥 Mit-Spielleitung',
      lines: [`<b>${esc(d.from)}</b> hat dich zur Mit-Spielleitung von <b>„${esc(d.gameName)}“</b> gemacht. Du kannst die Runde starten, beenden, Einstellungen ändern und Spieler verwalten.`],
      html: true, button: { label: 'Runde öffnen', url: base + '/admin' },
    }),
    gameResult: (d) => ({
      cat: 'games', key: d.code, subject: `${d.won ? '🏆 Gewonnen' : 'Ergebnis'}: „${d.gameName}“`, heading: d.won ? '🏆 Gewonnen!' : 'Die Runde ist vorbei',
      lines: [
        `<b>„${esc(d.gameName)}“</b> ist beendet: ${esc(d.reason)}`,
        `Du hast als <b>${esc(d.role)}</b> gespielt und <b>${Number(d.points) || 0} Punkte</b> geholt${d.catches ? ` – ${Number(d.catches)} Fang/Fänge` : ''}.`,
      ],
      html: true, button: { label: 'Wiederholung & Fotos ansehen', url: `${base}/g/${d.code}` },
      note: d.photoDays ? `Fotos dieser Runde werden nach ${d.photoDays} Tagen gelöscht. Lade sie vorher als ZIP herunter, wenn du sie behalten willst.` : null,
    }),
    quotaWarning: (d) => ({
      cat: 'account', subject: 'Dein Speicher ist fast voll', heading: '💾 Speicher fast voll',
      lines: [`Deine Runden belegen ${fmtMb(d.used)} von ${fmtMb(d.quota)}. Wenn der Speicher voll ist, werden neue Fotos nicht mehr gespeichert.`, 'Lösche alte Runden oder nur deren Fotos (das Ergebnis bleibt erhalten).'],
      button: { label: 'Meine Runden', url: base + '/admin' },
    }),
    quotaFull: (d) => ({
      cat: 'account', key: d.code, subject: `Speicher voll: „${d.gameName}“`, heading: '💾 Speicher voll',
      lines: [`In deiner Runde <b>„${esc(d.gameName)}“</b> werden keine Fotos mehr gespeichert, weil dein Speicher voll ist. Fotos zählen im Spiel trotzdem.`],
      html: true, button: { label: 'Platz schaffen', url: base + '/admin' },
    }),
    photosExpiring: (d) => ({
      cat: 'account', key: d.code, subject: `Fotos aus „${d.gameName}“ werden bald gelöscht`, heading: '📷 Fotos werden bald gelöscht',
      lines: [
        `Aus Datenschutzgründen löschen wir Fotos und Sprachnachrichten beendeter Runden nach ${d.retention} Tagen. Die ${d.count} Foto(s) aus <b>„${esc(d.gameName)}“</b> werden in ${d.days} Tag(en) gelöscht.`,
        'Willst du sie behalten? Lade sie vorher als ZIP herunter.',
      ],
      html: true, button: { label: 'Fotos herunterladen', url: `${base}/g/${d.code}` },
    }),
  };
}

function createMailer({ smtp, publicUrl, sign, getDb, save, log = console }) {
  const base = String(publicUrl || '').replace(/\/$/, '');
  const T = templates(base);
  const recent = new Map();

  function prefs(a) {
    const out = {};
    for (const [k, c] of Object.entries(CATEGORIES)) out[k] = a.mailPrefs && k in a.mailPrefs ? !!a.mailPrefs[k] : c.default;
    return out;
  }
  function setPrefs(a, input) {
    a.mailPrefs = prefs(a);
    for (const k of Object.keys(CATEGORIES)) if (input && k in input) a.mailPrefs[k] = !!input[k];
    a.mailPrefsAt = Date.now(); // Nachweis der Einwilligung (Art. 7 Abs. 1 DSGVO)
    save();
    return prefs(a);
  }
  const unsubSig = (id, cat) => sign(`unsub|${id}|${cat}`).slice(0, 32);
  const unsubscribeUrl = (a, cat) => `${base}/api/mail/unsubscribe?u=${a.id}&c=${cat}&s=${unsubSig(a.id, cat)}`;
  function checkUnsub(id, cat, s) {
    const a = getDb().accounts[id];
    if (!a || !(cat === 'all' || CATEGORIES[cat]) || typeof s !== 'string' || s !== unsubSig(id, cat)) return null;
    return a;
  }
  function unsubscribe(a, cat) {
    const off = {};
    for (const k of Object.keys(CATEGORIES)) if (cat === 'all' || k === cat) off[k] = false;
    return setPrefs(a, off);
  }

  /** Mail-HTML: Tabellen-Layout mit Inline-Styles (funktioniert in allen Mailprogrammen), keine externen Bilder. */
  function render(t, a) {
    const lineHtml = (l) => (t.html ? l : esc(l));
    const btn = t.button ? `<tr><td style="padding:8px 28px 4px"><a href="${esc(t.button.url)}" style="display:inline-block;background:#14201a;color:#ffffff;text-decoration:none;font-weight:800;padding:13px 22px;border-radius:6px;font-size:16px">${esc(t.button.label)}</a></td></tr>` : '';
    const code = t.code ? `<tr><td style="padding:6px 28px 10px"><div style="display:inline-block;background:#fbefc0;border:2px solid #14201a;border-radius:8px;padding:12px 22px;font:800 32px/1 ui-monospace,Consolas,monospace;letter-spacing:8px;color:#14201a">${esc(t.code)}</div></td></tr>` : '';
    const note = t.note ? `<tr><td style="padding:14px 28px 0;color:#4b5b50;font-size:13px;line-height:1.5">${esc(t.note)}</td></tr>` : '';
    const why = t.cat
      ? `Du bekommst diese Mail, weil du „${esc(CATEGORIES[t.cat].label)}“ eingeschaltet hast. <a href="${esc(unsubscribeUrl(a, t.cat))}" style="color:#4b5b50">Diese Mails abbestellen</a> · <a href="${esc(unsubscribeUrl(a, 'all'))}" style="color:#4b5b50">alle Benachrichtigungs-Mails abbestellen</a>`
      : 'Diese Mail gehört zu deinem Manhunt-Konto und lässt sich nicht abbestellen.';
    return `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(t.subject)}</title></head>
<body style="margin:0;padding:0;background:#d9e1cc;font-family:system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif;color:#14201a">
<span style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(t.preheader || t.lines[0]?.replace(/<[^>]+>/g, '') || '')}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#d9e1cc;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#f6f8f1;border:3px solid #14201a;border-radius:10px;overflow:hidden">
<tr><td style="background:#14201a;padding:18px 28px"><span style="color:#ffffff;font:900 22px 'Arial Black',Arial,sans-serif;letter-spacing:-.5px">MANHUNT</span>
<span style="display:inline-block;width:10px;height:10px;background:#c7301f;margin-left:10px"></span><span style="display:inline-block;width:10px;height:10px;background:#c7301f;margin-left:3px"></span><span style="display:inline-block;width:10px;height:10px;background:#0f8a4a;margin-left:3px"></span></td></tr>
<tr><td style="padding:26px 28px 6px"><h1 style="margin:0;font:900 24px/1.2 'Arial Black',Arial,sans-serif">${esc(t.heading)}</h1></td></tr>
${t.lines.map((l) => `<tr><td style="padding:8px 28px 0;font-size:16px;line-height:1.55">${lineHtml(l)}</td></tr>`).join('\n')}
${code}${btn}${note}
<tr><td style="padding:24px 28px 22px"><hr style="border:0;border-top:1px solid #c9d2bd;margin:0 0 14px"><p style="margin:0;color:#4b5b50;font-size:12px;line-height:1.5">${why}<br>
<a href="${esc(base)}/datenschutz" style="color:#4b5b50">Datenschutz</a> · <a href="${esc(base)}/impressum" style="color:#4b5b50">Impressum</a> · <a href="${esc(base)}/profile" style="color:#4b5b50">Einstellungen</a></p></td></tr>
</table></td></tr></table></body></html>`;
  }
  function renderText(t, a) {
    const strip = (l) => String(l).replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
    const parts = [t.heading, '', ...t.lines.map(strip)];
    if (t.code) parts.push('', `    ${t.code}`);
    if (t.button) parts.push('', `${t.button.label}: ${t.button.url}`);
    if (t.note) parts.push('', t.note);
    parts.push('', '—', t.cat ? `Abbestellen: ${unsubscribeUrl(a, t.cat)}` : 'Diese Mail gehört zu deinem Manhunt-Konto.', `Datenschutz: ${base}/datenschutz · Impressum: ${base}/impressum`);
    return parts.join('\n') + '\n';
  }

  /**
   * Mail an ein Konto. Benachrichtigungen nur mit Einwilligung, gebremst; Pflicht-Mails immer.
   * Gibt true zurück, wenn verschickt (oder protokolliert). Pflicht-Mails werfen bei Fehlern.
   */
  async function send(a, type, data = {}) {
    if (!a || !a.email) return false;
    const t = T[type](data);
    if (t.cat) {
      if (!a.verified || !prefs(a)[t.cat]) return false;
      const key = `${a.id}|${type}|${t.key || ''}`;
      if (Date.now() - (recent.get(key) || 0) < SAME_KIND_MS) return false;
      const day = new Date().toISOString().slice(0, 10);
      if (!a.mailCount || a.mailCount.day !== day) a.mailCount = { day, n: 0 };
      if (a.mailCount.n >= PER_DAY) return false;
      recent.set(key, Date.now());
      a.mailCount.n++;
    }
    const headers = t.cat ? {
      'List-Unsubscribe': `<${unsubscribeUrl(a, t.cat)}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    } : { 'Auto-Submitted': 'auto-generated' };
    const msg = { to: a.email, subject: `Manhunt: ${t.subject}`, text: renderText(t, a), html: render(t, a), headers };
    if (!t.cat) { await smtp.sendMail(msg); return true; }
    smtp.sendMail(msg).catch((e) => log.error(`[manhunt] Mail (${type}) an Konto ${a.id} fehlgeschlagen: ${e.message}`));
    return true;
  }

  // Bremse im Speicher aufräumen
  setInterval(() => { const now = Date.now(); for (const [k, ts] of recent) if (now - ts > SAME_KIND_MS) recent.delete(k); }, 600000).unref();

  return { send, prefs, setPrefs, unsubscribe, checkUnsub, unsubscribeUrl, render: (type, a, d) => render(T[type](d), a), CATEGORIES };
}

module.exports = { createMailer, CATEGORIES };
