'use strict';
/** Geo-Helfer und Abfrage großer Orte (Supermärkte, Märkte, Bahnhöfe …) über OpenStreetMap/Overpass. */

function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371000, r = Math.PI / 180;
  const dLat = (lat2 - lat1) * r, dLng = (lng2 - lng1) * r;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** Punkt in Entfernung `dist` (m) und Richtung `deg` von (lat,lng). */
function offset(lat, lng, dist, deg) {
  const a = (deg * Math.PI) / 180;
  return [
    lat + (dist * Math.cos(a)) / 111320,
    lng + (dist * Math.sin(a)) / (111320 * Math.max(0.2, Math.cos((lat * Math.PI) / 180))),
  ];
}

function randomPointAround(lat, lng, minM, maxM) {
  const d = minM + Math.random() * (maxM - minM);
  return offset(lat, lng, d, Math.random() * 360);
}

const OVERPASS_URL = process.env.OVERPASS_URL || 'https://overpass-api.de/api/interpreter';
const poiCache = new Map(); // key -> { ts, list }

/**
 * Große Orte um einen Punkt. Ergebnis wird 6 Stunden gecacht.
 * Gibt [] zurück, wenn Overpass nicht erreichbar ist (dann greift der Zufalls-Ersatz).
 */
async function fetchPois(lat, lng, radiusM) {
  const key = `${lat.toFixed(2)},${lng.toFixed(2)},${Math.round(radiusM / 500)}`;
  const c = poiCache.get(key);
  if (c && Date.now() - c.ts < 6 * 3600e3) return c.list;
  const r = Math.round(Math.min(radiusM, 10000));
  const q = `[out:json][timeout:20];(
    nwr["shop"~"^(supermarket|mall|department_store|hypermarket)$"](around:${r},${lat},${lng});
    nwr["amenity"~"^(marketplace|bus_station)$"](around:${r},${lat},${lng});
    nwr["railway"="station"](around:${r},${lat},${lng});
    nwr["leisure"="stadium"](around:${r},${lat},${lng});
  );out center 300;`;
  let list = [];
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 25000);
    const res = await fetch(OVERPASS_URL, {
      method: 'POST', body: 'data=' + encodeURIComponent(q), signal: ctrl.signal,
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'manhunt-server' },
    });
    clearTimeout(t);
    if (res.ok) {
      const j = await res.json();
      list = (j.elements || []).map((e) => {
        const la = e.lat ?? e.center?.lat, ln = e.lon ?? e.center?.lon;
        if (!Number.isFinite(la) || !Number.isFinite(ln)) return null;
        const tg = e.tags || {};
        const kind = tg.shop ? 'Supermarkt' : tg.railway ? 'Bahnhof' : tg.amenity === 'marketplace' ? 'Markt'
          : tg.amenity === 'bus_station' ? 'Busbahnhof' : tg.leisure ? 'Stadion' : 'Ort';
        return { lat: la, lng: ln, name: String(tg.name || kind).slice(0, 60), kind };
      }).filter(Boolean);
    }
  } catch (e) {
    console.log(`[manhunt] Overpass nicht erreichbar: ${e.message}`);
  }
  poiCache.set(key, { ts: Date.now(), list });
  return list;
}

module.exports = { haversine, offset, randomPointAround, fetchPois };
