'use strict';
/**
 * Minimaler SMTP-Client (ohne Abhängigkeiten) für Bestätigungs-Mails.
 * Unterstützt SMTPS (Port 465, SMTP_SECURE=true) und STARTTLS (Port 587), AUTH LOGIN.
 *
 * Umgebungsvariablen: SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS, SMTP_FROM
 * Ohne SMTP_HOST werden Mails nur ins Server-Log geschrieben (Testbetrieb).
 */
const net = require('node:net');
const tls = require('node:tls');
const crypto = require('node:crypto');

const cfg = () => ({
  host: process.env.SMTP_HOST || '',
  port: Number(process.env.SMTP_PORT) || (process.env.SMTP_SECURE === 'true' ? 465 : 587),
  secure: process.env.SMTP_SECURE === 'true' || Number(process.env.SMTP_PORT) === 465,
  user: process.env.SMTP_USER || '',
  pass: process.env.SMTP_PASS || '',
  from: process.env.SMTP_FROM || process.env.SMTP_USER || 'manhunt@localhost',
});

const enabled = () => !!cfg().host;

function encodeHeader(s) {
  return /^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=`;
}

function buildMessage({ from, to, subject, text }) {
  const body = Buffer.from(text, 'utf8').toString('base64').replace(/.{76}/g, '$&\r\n');
  return [
    `From: Manhunt <${from}>`,
    `To: <${to}>`,
    `Subject: ${encodeHeader(subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${crypto.randomBytes(12).toString('hex')}@${from.split('@')[1] || 'manhunt'}>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    body,
  ].join('\r\n');
}

/** Sendet eine Mail. Wirft einen Fehler, wenn der Server ablehnt. */
function sendMail({ to, subject, text }) {
  const c = cfg();
  if (!c.host) {
    console.log(`[manhunt] (kein SMTP konfiguriert) Mail an ${to}: ${subject}\n${text}`);
    return Promise.resolve({ logged: true });
  }
  if (/[\r\n<>]/.test(to)) return Promise.reject(new Error('Ungültige Adresse'));
  return new Promise((resolve, reject) => {
    let sock = c.secure ? tls.connect({ host: c.host, port: c.port, servername: c.host }) : net.connect({ host: c.host, port: c.port });
    let buf = '';
    let waiter = null;
    const timer = setTimeout(() => fail(new Error('SMTP-Zeitüberschreitung')), 20000);
    function fail(e) { clearTimeout(timer); try { sock.destroy(); } catch { /* egal */ } reject(e); }
    function onData(d) {
      buf += d.toString('utf8');
      // Vollständige Antwort: letzte Zeile "NNN text"
      const lines = buf.split('\r\n');
      for (let i = 0; i < lines.length - 1; i++) {
        if (/^\d{3} /.test(lines[i])) {
          const resp = lines.slice(0, i + 1).join('\n');
          buf = lines.slice(i + 1).join('\r\n');
          const w = waiter; waiter = null;
          if (w) w(resp);
          return;
        }
      }
    }
    function attach(s) { s.on('data', onData); s.on('error', fail); }
    attach(sock);
    const expect = (codes) => new Promise((res, rej) => {
      waiter = (resp) => (codes.includes(Number(resp.slice(0, 3))) ? res(resp) : rej(new Error(`SMTP: ${resp.split('\n').pop()}`)));
    });
    const cmd = (line, codes) => { const p = expect(codes); sock.write(line + '\r\n'); return p; };

    (async () => {
      await expect([220]);
      const name = 'manhunt.local';
      let ehlo = await cmd(`EHLO ${name}`, [250]);
      if (!c.secure && /STARTTLS/i.test(ehlo)) {
        await cmd('STARTTLS', [220]);
        sock.removeListener('data', onData);
        sock = tls.connect({ socket: sock, servername: c.host });
        attach(sock);
        await new Promise((r) => sock.once('secureConnect', r));
        ehlo = await cmd(`EHLO ${name}`, [250]);
      }
      if (c.user) {
        await cmd('AUTH LOGIN', [334]);
        await cmd(Buffer.from(c.user).toString('base64'), [334]);
        await cmd(Buffer.from(c.pass).toString('base64'), [235]);
      }
      await cmd(`MAIL FROM:<${c.from}>`, [250]);
      await cmd(`RCPT TO:<${to}>`, [250, 251]);
      await cmd('DATA', [354]);
      const msg = buildMessage({ from: c.from, to, subject, text }).replace(/\r\n\./g, '\r\n..');
      await cmd(`${msg}\r\n.`, [250]);
      await cmd('QUIT', [221]).catch(() => {});
      clearTimeout(timer); sock.end(); resolve({ sent: true });
    })().catch(fail);
  });
}

module.exports = { sendMail, enabled };
