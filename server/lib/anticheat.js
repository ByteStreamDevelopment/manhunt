'use strict';
/**
 * Anti-Cheat: VPN-/Proxy-Erkennung und Plausibilitätsprüfung von GPS-Positionen.
 *
 * VPN-Erkennung hat zwei Quellen:
 *  1. Die Android-App meldet per Header `x-vpn: 1`, wenn auf dem Handy ein VPN aktiv ist.
 *  2. Optional prüft der Server die IP-Adresse über einen Dienst (VPN_CHECK=ipapi -> ip-api.com,
 *     kostenlos für nicht-kommerzielle Nutzung). Ergebnis wird 6 h gecacht.
 *
 * GPS-Fälschung erkennt der Server an:
 *  - `mock: true` von der App (Android meldet Positionen aus Fake-GPS-Apps als „Mock“)
 *  - unmöglichen Geschwindigkeiten zwischen zwei Positionen (Teleport)
 *  - Genauigkeit 0 m oder immer exakt identischen Koordinaten (echtes GPS schwankt immer etwas)
 */
const { haversine } = require('./geo');

const ipCache = new Map(); // ip -> { ts, vpn, reason }

function isPrivateIp(ip) {
  return !ip || /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1$|fc|fd|fe80|::ffff:127\.|::ffff:10\.|::ffff:192\.168\.)/i.test(ip);
}

async function checkIp(ip) {
  const mode = process.env.VPN_CHECK || 'off';
  if (mode === 'off' || isPrivateIp(ip)) return { vpn: false };
  const c = ipCache.get(ip);
  if (c && Date.now() - c.ts < 6 * 3600e3) return c;
  let out = { vpn: false };
  try {
    if (mode === 'ipapi') {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 4000);
      const r = await fetch(`http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,proxy,hosting`, { signal: ctrl.signal });
      clearTimeout(t);
      const j = await r.json();
      if (j.status === 'success' && (j.proxy || j.hosting)) out = { vpn: true, reason: j.proxy ? 'Proxy/VPN-Adresse' : 'Rechenzentrums-Adresse' };
    }
  } catch { /* Dienst nicht erreichbar -> kein Befund */ }
  out.ts = Date.now();
  ipCache.set(ip, out);
  return out;
}

/** VPN-Befund für eine Anfrage: Header der App + IP-Prüfung. */
async function detectVpn(req, ip) {
  if (req.headers['x-vpn'] === '1') return { vpn: true, reason: 'VPN auf dem Handy aktiv' };
  const r = await checkIp(ip);
  return r.vpn ? r : { vpn: false };
}

/**
 * Prüft eine neue Position gegen die vorherige. Gibt null zurück (unauffällig) oder einen Grund.
 * prev: { lat, lng, acc, ts }, pl: Spieler (für Zähler identischer Positionen)
 */
function checkSpoof(pl, prev, lat, lng, acc, mock, maxSpeedKmh) {
  if (mock) return 'Fake-GPS-App erkannt (Mock-Standort)';
  if (acc === 0) return 'Genauigkeit 0 m (typisch für gefälschte Positionen)';
  if (prev) {
    if (prev.lat === lat && prev.lng === lng) pl.sameCount = (pl.sameCount || 0) + 1;
    else pl.sameCount = 0;
    if (pl.sameCount >= 8) return 'Position mehrfach exakt identisch';
    const dt = (Date.now() - prev.ts) / 1000;
    if (dt > 0) {
      const d = haversine(prev.lat, prev.lng, lat, lng);
      // Ungenauigkeit beider Positionen großzügig abziehen
      const slack = Math.min(300, (prev.acc || 0) + (acc || 0)) + 30;
      const kmh = (Math.max(0, d - slack) / dt) * 3.6;
      if (kmh > maxSpeedKmh && d > 150) return `Unmögliche Geschwindigkeit (${Math.round(kmh)} km/h)`;
    }
  }
  return null;
}

module.exports = { detectVpn, checkSpoof };
