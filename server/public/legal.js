'use strict';
// Füllt Impressum und Datenschutzerklärung mit den Angaben des Betreibers (Umgebungsvariablen OPERATOR_*)
(async () => {
  let L;
  try { L = await (await fetch('/api/legal')).json(); } catch { return; }
  const $$ = (k) => document.querySelectorAll(`[data-legal="${k}"]`);
  const set = (k, v) => $$(k).forEach((el) => { el.textContent = v; });
  const o = L.operator || {};
  const lines = [o.name, ...(o.address || '').split(/\s*[|;]\s*|\n/)].filter(Boolean);
  $$('operator').forEach((el) => {
    el.replaceChildren();
    if (!lines.length) { el.textContent = '⚠️ Der Betreiber hat seine Angaben noch nicht hinterlegt (OPERATOR_NAME, OPERATOR_ADDRESS, OPERATOR_EMAIL).'; return; }
    lines.forEach((l, i) => { if (i) el.append(document.createElement('br')); el.append(l); });
    if (o.email) { el.append(document.createElement('br')); const a = document.createElement('a'); a.href = `mailto:${o.email}`; a.textContent = o.email; el.append('E-Mail: ', a); }
  });
  $$('contact').forEach((el) => {
    el.replaceChildren();
    if (o.email) { const a = document.createElement('a'); a.href = `mailto:${o.email}`; a.textContent = o.email; el.append('E-Mail: ', a); }
    if (o.phone) { el.append(document.createElement('br'), `Telefon: ${o.phone}`); }
    if (!o.email && !o.phone) el.textContent = 'Noch nicht hinterlegt.';
  });
  set('version', L.privacyVersion);
  set('loc', L.retention.locationsDays || 'unbegrenzt – ');
  set('photos', L.retention.photosDays || 'unbegrenzt – ');
  set('unverified', L.retention.unverifiedDays);
  set('mail', L.mailConfigured ? ' (über den vom Betreiber eingerichteten SMTP-Server)' : ' (derzeit ist kein Mailversand eingerichtet)');
  $$('vpn').forEach((el) => { el.hidden = !L.vpnCheck; });
})();
