'use strict';
/* Anmelden, Registrieren, E-Mail bestätigen, Passwort zurücksetzen – als Karte zum Einbauen. */
window.MHAuth = (() => {
  const { h, api, account, toast } = MH;

  function field(label, attrs) {
    const i = h('input', attrs);
    return { i, el: h('div', {}, h('label', {}, label), i) };
  }

  /** Liefert ein Element. onDone(account) wird nach erfolgreicher Anmeldung aufgerufen. */
  function box(onDone) {
    const root = h('div', { class: 'card stack' });
    const err = () => h('p', { class: 'err', role: 'alert' });

    function done(r) {
      account.set({ token: r.token, username: r.account.username, email: r.account.email, isAdmin: r.account.isAdmin });
      // Admin-Token für Admins, sonst das Konto-Token: damit verwaltet jeder seine eigenen Runden unter /admin
      localStorage.setItem('manhunt:admin', r.adminToken || r.token);
      localStorage.setItem('manhunt:admin:user', r.account.username);
      onDone && onDone(account.get());
    }

    function showLogin(msg) {
      const login = field('Benutzername oder E-Mail', { type: 'text', autocomplete: 'username' });
      const pw = field('Passwort', { type: 'password', autocomplete: 'current-password' });
      const e = err(); if (msg) e.textContent = msg;
      const go = async () => {
        e.textContent = '';
        try { done(await api('/api/auth/login', { method: 'POST', body: { login: login.i.value, password: pw.i.value } })); }
        catch (x) { if (x.data && x.data.needsVerification) showVerify(x.data.email, 'Bitte gib den Code aus der Bestätigungs-Mail ein.'); else e.textContent = x.message; }
      };
      pw.i.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') go(); });
      root.replaceChildren(h('h2', {}, 'Anmelden'), login.el, pw.el, e,
        h('button', { class: 'btn big', onclick: go }, 'Anmelden'),
        h('div', { class: 'row between' },
          h('button', { class: 'btn small light', onclick: () => showRegister() }, 'Neuen Account anlegen'),
          h('button', { class: 'btn small light', onclick: () => showForgot() }, 'Passwort vergessen?')));
    }

    function showRegister() {
      const user = field('Benutzername (wird im Spiel angezeigt)', { type: 'text', maxlength: '20', autocomplete: 'username' });
      const mail = field('E-Mail', { type: 'email', autocomplete: 'email' });
      const pw = field('Passwort (mind. 8 Zeichen)', { type: 'password', autocomplete: 'new-password' });
      const key = field('Admin-Schlüssel', { type: 'password' }); key.el.hidden = true;
      // Einwilligungen: Datenschutz/Alter Pflicht, Mails freiwillig (nicht vorausgewählt)
      const privacy = h('input', { type: 'checkbox', id: 'regPrivacy' });
      const optin = h('input', { type: 'checkbox', id: 'regMail' });
      const consent = h('div', { class: 'stack' },
        h('label', { class: 'consent', for: 'regPrivacy' }, privacy, h('span', {}, 'Ich habe die ', h('a', { href: '/datenschutz', target: '_blank' }, 'Datenschutzerklärung'), ' gelesen und bin mindestens 16 Jahre alt (oder meine Eltern sind einverstanden).')),
        h('label', { class: 'consent', for: 'regMail' }, optin, h('span', {}, 'Optional: Schickt mir E-Mails zu Freundschaftsanfragen, Einladungen und Spielergebnissen. Jederzeit abbestellbar.')));
      const e = err();
      const go = async () => {
        e.textContent = '';
        try {
          if (!privacy.checked) { e.textContent = 'Bitte bestätige die Datenschutzerklärung und das Mindestalter.'; return; }
          const r = await api('/api/auth/register', { method: 'POST', body: { username: user.i.value, email: mail.i.value, password: pw.i.value, adminKey: key.i.value || undefined, acceptPrivacy: true, mailOptIn: optin.checked } });
          showVerify(r.email, 'Wir haben dir einen 6-stelligen Code geschickt.');
        } catch (x) { e.textContent = x.message; if (x.data && x.data.needsAdminKey) key.el.hidden = false; }
      };
      root.replaceChildren(h('h2', {}, 'Account anlegen'), user.el, mail.el, pw.el, key.el, consent, e,
        h('button', { class: 'btn big', onclick: go }, 'Registrieren'),
        h('button', { class: 'btn small light', onclick: () => showLogin() }, 'Ich habe schon einen Account'));
    }

    function showVerify(email, msg) {
      const code = field('Bestätigungscode', { type: 'text', inputmode: 'numeric', maxlength: '6', autocomplete: 'one-time-code', class: 'code' });
      const e = err();
      const go = async () => {
        e.textContent = '';
        try { done(await api('/api/auth/verify', { method: 'POST', body: { login: email, code: code.i.value } })); }
        catch (x) { e.textContent = x.message; }
      };
      code.i.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') go(); });
      root.replaceChildren(h('h2', {}, 'E-Mail bestätigen'), h('p', {}, msg, ' ', h('b', {}, email)), code.el, e,
        h('button', { class: 'btn big', onclick: go }, 'Bestätigen'),
        h('div', { class: 'row between' },
          h('button', { class: 'btn small light', onclick: async () => { try { await api('/api/auth/resend', { method: 'POST', body: { login: email } }); toast('Neuer Code verschickt'); } catch (x) { e.textContent = x.message; } } }, 'Code erneut senden'),
          h('button', { class: 'btn small light', onclick: () => showLogin() }, 'Zurück')));
    }

    function showForgot() {
      const mail = field('E-Mail oder Benutzername', { type: 'text' });
      const e = err();
      root.replaceChildren(h('h2', {}, 'Passwort vergessen'), mail.el, e,
        h('button', { class: 'btn big', onclick: async () => {
          try { await api('/api/auth/forgot', { method: 'POST', body: { login: mail.i.value } }); showReset(mail.i.value); }
          catch (x) { e.textContent = x.message; }
        } }, 'Code schicken'),
        h('button', { class: 'btn small light', onclick: () => showLogin() }, 'Zurück'));
    }

    function showReset(login) {
      const code = field('Code aus der Mail', { type: 'text', inputmode: 'numeric', maxlength: '6', class: 'code' });
      const pw = field('Neues Passwort', { type: 'password', autocomplete: 'new-password' });
      const e = err();
      root.replaceChildren(h('h2', {}, 'Neues Passwort'), h('p', {}, 'Falls es den Account gibt, ist ein Code unterwegs.'), code.el, pw.el, e,
        h('button', { class: 'btn big', onclick: async () => {
          try { done(await api('/api/auth/reset', { method: 'POST', body: { login, code: code.i.value, password: pw.i.value } })); }
          catch (x) { e.textContent = x.message; }
        } }, 'Passwort setzen'),
        h('button', { class: 'btn small light', onclick: () => showLogin() }, 'Zurück'));
    }

    showLogin();
    return root;
  }

  return { box };
})();
