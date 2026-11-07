'use strict';
/**
 * Katalog aller Fähigkeiten (Abilities) und Quests.
 * Die Spielleitung stellt pro Spiel ein, was erlaubt ist, was man zum Start hat und was man im Spiel bekommen kann.
 * Die App und die Website bekommen Namen und Beschreibungen über /api/catalog, damit alles nur hier gepflegt wird.
 */

/*
 * team: wer die Fähigkeit benutzen kann (runner | hunter | any)
 * durationSec: Wirkdauer (0 = sofort)
 * target: 'caughtRunner' = man wählt einen gefangenen Runner aus
 * start: Standard-Anzahl zum Spielstart, obtainable: kann man im Spiel bekommen
 * cooldownSec: so lange muss man warten, bis man dieselbe Fähigkeit wieder einsetzen kann
 * rarity: common | rare | epic – wie oft sie beim zufälligen Verteilen (Quests, Pickups, Abwürfe) gezogen wird
 *         (Gewichte in RARITY). Starke Fähigkeiten wie Freeze und Radar sind episch und damit selten.
 */
/** Gewichte beim Ziehen: Eine häufige Fähigkeit kommt etwa 6-mal so oft wie eine epische. */
const RARITY = { common: 6, rare: 3, epic: 1 };

const ABILITIES = {
  // ---------------- Runner ----------------
  freeze: {
    team: 'runner', icon: '🧊', name: 'Freeze', durationSec: 60, cooldownSec: 900, start: 0, rarity: 'epic', obtainable: true,
    desc: 'Alle Hunter sind eingefroren: Sie sehen keine Runner mehr und können niemanden fangen.',
  },
  cloak: {
    team: 'runner', icon: '👻', name: 'Tarnkappe', durationSec: 120, cooldownSec: 600, start: 0, rarity: 'rare', obtainable: true,
    desc: 'Du verschwindest von der Karte der Hunter.',
  },
  decoy: {
    team: 'runner', icon: '🎭', name: 'Köder', durationSec: 180, cooldownSec: 600, start: 0, rarity: 'rare', obtainable: true,
    desc: 'Hunter sehen dich an einer falschen Position, 300–600 m entfernt.',
  },
  fog: {
    team: 'runner', icon: '🌫️', name: 'Nebelwand', durationSec: 180, cooldownSec: 480, start: 0, rarity: 'common', obtainable: true,
    desc: 'Deine Position wird für Hunter um bis zu 400 m zusätzlich verwischt.',
  },
  photoJoker: {
    team: 'runner', icon: '🃏', name: 'Fotojoker', durationSec: 0, cooldownSec: 0, start: 0, rarity: 'common', obtainable: true,
    desc: 'Die aktuelle Foto-Runde gilt als erledigt. Beendet auch einen Live-Standort wegen fehlendem Foto.',
  },
  rescue: {
    team: 'runner', icon: '🔓', name: 'Befreiung', durationSec: 0, cooldownSec: 900, start: 0, rarity: 'rare', obtainable: true, target: 'caughtRunner',
    desc: 'Befreit einen gefangenen Runner, er ist sofort wieder im Spiel.',
  },
  // ---------------- Hunter ----------------
  radar: {
    team: 'hunter', icon: '📡', name: 'Radar', durationSec: 90, cooldownSec: 900, start: 0, rarity: 'epic', obtainable: true,
    desc: 'Alle Hunter sehen den Live-Standort aller Runner, exakt und alle paar Sekunden aktualisiert.',
  },
  ping: {
    team: 'hunter', icon: '🎯', name: 'Peilung', durationSec: 45, cooldownSec: 300, start: 0, rarity: 'common', obtainable: true,
    desc: 'Der nächste Runner muss sofort seinen exakten Standort senden und bleibt eine Minute live.',
  },
  photoOrder: {
    team: 'hunter', icon: '📸', name: 'Fotobefehl', durationSec: 120, cooldownSec: 600, start: 0, rarity: 'rare', obtainable: true,
    desc: 'Alle Runner müssen innerhalb von 2 Minuten ein Foto hochladen, sonst wird ihr Standort live geteilt.',
  },
  tracker: {
    team: 'hunter', icon: '🐾', name: 'Spurenleser', durationSec: 180, cooldownSec: 600, start: 0, rarity: 'rare', obtainable: true,
    desc: 'Hunter sehen die komplette, exakte Route aller Runner.',
  },
  thaw: {
    team: 'hunter', icon: '🔥', name: 'Eisbrecher', durationSec: 0, cooldownSec: 0, start: 0, rarity: 'rare', obtainable: true,
    desc: 'Beendet einen Freeze sofort für alle Hunter.',
  },
  // ---------------- Beide ----------------
  shield: {
    team: 'any', icon: '🛡️', name: 'Schild', durationSec: 180, cooldownSec: 600, start: 1, rarity: 'common', obtainable: true,
    desc: 'Du bist immun gegen Fähigkeiten des anderen Teams (Freeze, Radar, Peilung, Fotobefehl).',
  },
};

/*
 * kind bestimmt, wie der Server die Quest prüft:
 *  photo      – mit einem Foto erfüllen (Hochladen über den Quest-Knopf)
 *  checkpoint – zu einem zufälligen Punkt laufen (minM–maxM entfernt)
 *  poi        – zu einem großen Ort (Supermarkt, Markt, Bahnhof …) in der Nähe laufen
 *  distance   – meters Meter zurücklegen
 *  still      – radiusM lang mindestens holdMin Minuten an einem Ort bleiben
 *  dare       – bis auf meters an einen Hunter herankommen (Runner)
 *  near       – bis auf meters an einen Runner herankommen (Hunter)
 *  catch      – einen Runner fangen
 *  pincer     – mit einem zweiten Hunter gleichzeitig innerhalb von meters um einen Runner sein
 *  edge       – den Rand der Spielzone berühren
 *  pickup     – eine Fähigkeit auf der Karte einsammeln
 */
/** Diese (schweren) Quests geben standardmäßig eine Fähigkeit, alle anderen nur Punkte. */
const ABILITY_REWARD_QUESTS = ['r_dare', 'r_statue', 'r_edge', 'h_bounty', 'h_pincer', 'h_scent'];

const QUESTS = {
  // ---------------- Runner ----------------
  r_red: { team: 'runner', kind: 'photo', icon: '🟥', title: 'Rot sehen', minutes: 10, points: 40,
    desc: 'Fotografiere etwas Rotes, das größer ist als du.' },
  r_tourist: { team: 'runner', kind: 'photo', icon: '🗿', title: 'Tourist', minutes: 12, points: 50,
    desc: 'Mach ein Selfie vor einem Denkmal, Brunnen oder Wahrzeichen.' },
  r_number: { team: 'runner', kind: 'photo', icon: '🔢', title: 'Zahlenjäger', minutes: 10, points: 40,
    desc: 'Fotografiere eine Hausnummer oder ein Schild mit einer Zahl über 100.' },
  r_safari: { team: 'runner', kind: 'photo', icon: '🐦', title: 'Safari', minutes: 12, points: 50,
    desc: 'Fotografiere ein Tier. Tauben und Hunde zählen.' },
  r_courier: { team: 'runner', kind: 'checkpoint', icon: '📦', title: 'Kurierlauf', minutes: 12, points: 60, minM: 300, maxM: 700,
    desc: 'Bring ein „Paket“ zum markierten Punkt auf der Karte.' },
  r_shopping: { team: 'runner', kind: 'poi', icon: '🛒', title: 'Einkaufsliste', minutes: 15, points: 60,
    desc: 'Lauf zu einem Supermarkt oder Markt in deiner Nähe – die Hunter ahnen nichts.' },
  r_dare: { team: 'runner', kind: 'dare', icon: '😈', title: 'Mutprobe', minutes: 10, points: 90, meters: 250,
    desc: 'Komm einem Hunter bis auf 250 m nahe, ohne gefangen zu werden.' },
  r_statue: { team: 'runner', kind: 'still', icon: '🗽', title: 'Statue', minutes: 12, points: 50, radiusM: 35, holdMin: 4,
    desc: 'Bleib 4 Minuten lang an einem Ort (35 m). Gutes Versteck nötig!' },
  r_edge: { team: 'runner', kind: 'edge', icon: '🧭', title: 'Grenzgänger', minutes: 12, points: 60, meters: 60,
    desc: 'Berühre den Rand der Spielzone (bis auf 60 m) – ohne sie zu verlassen.' },
  r_sprint: { team: 'runner', kind: 'distance', icon: '💨', title: 'Sprint', minutes: 8, points: 50, meters: 800,
    desc: 'Leg in 8 Minuten 800 m zurück.' },
  r_loot: { team: 'runner', kind: 'pickup', icon: '🎁', title: 'Plünderer', minutes: 15, points: 40,
    desc: 'Sammle eine Fähigkeit auf der Karte ein.' },
  // ---------------- Hunter ----------------
  h_patrol: { team: 'hunter', kind: 'checkpoint', icon: '🚩', title: 'Patrouille', minutes: 10, points: 50, minM: 300, maxM: 700,
    desc: 'Kontrolliere den markierten Punkt auf der Karte.' },
  h_scent: { team: 'hunter', kind: 'near', icon: '🐕', title: 'Witterung', minutes: 15, points: 70, meters: 150,
    desc: 'Komm einem Runner bis auf 150 m nahe.' },
  h_bounty: { team: 'hunter', kind: 'catch', icon: '💰', title: 'Kopfgeld', minutes: 15, points: 120,
    desc: 'Fang innerhalb von 15 Minuten einen Runner.' },
  h_pincer: { team: 'hunter', kind: 'pincer', icon: '🦀', title: 'Zange', minutes: 15, points: 100, meters: 250,
    desc: 'Sei zusammen mit einem zweiten Hunter gleichzeitig höchstens 250 m von einem Runner entfernt.' },
  h_chase: { team: 'hunter', kind: 'distance', icon: '🏃', title: 'Verfolgungsjagd', minutes: 10, points: 50, meters: 1000,
    desc: 'Leg in 10 Minuten 1 km zurück.' },
  h_outpost: { team: 'hunter', kind: 'poi', icon: '🏪', title: 'Stützpunkt', minutes: 12, points: 50,
    desc: 'Sichere einen Supermarkt, Markt oder Bahnhof in deiner Nähe.' },
  h_paparazzi: { team: 'hunter', kind: 'photo', icon: '📷', title: 'Paparazzi', minutes: 15, points: 80,
    desc: 'Fotografiere einen Runner aus der Ferne, ohne dass er es merkt.' },
  h_collector: { team: 'hunter', kind: 'pickup', icon: '🧲', title: 'Sammler', minutes: 15, points: 40,
    desc: 'Sammle eine Fähigkeit auf der Karte ein.' },
  h_sweep: { team: 'hunter', kind: 'checkpoint', icon: '🧹', title: 'Durchkämmen', minutes: 8, points: 40, minM: 200, maxM: 400,
    desc: 'Durchsuche das Gebiet am markierten Punkt.' },
};

/*
 * Abzeichen für die Bestenliste. stat = Zähler in der Account-Statistik, min = ab diesem Wert.
 */
const BADGES = [
  { key: 'firstGame', icon: '🎮', name: 'Neuling', desc: 'Erstes Spiel gespielt', stat: 'games', min: 1 },
  { key: 'veteran', icon: '🎖️', name: 'Veteran', desc: '10 Spiele gespielt', stat: 'games', min: 10 },
  { key: 'firstCatch', icon: '🪤', name: 'Erster Fang', desc: 'Einen Runner gefangen', stat: 'catches', min: 1 },
  { key: 'bountyHunter', icon: '🤠', name: 'Kopfgeldjäger', desc: '10 Runner gefangen', stat: 'catches', min: 10 },
  { key: 'winner', icon: '🏆', name: 'Sieger', desc: 'Ein Spiel gewonnen', stat: 'wins', min: 1 },
  { key: 'champion', icon: '👑', name: 'Champion', desc: '5 Spiele gewonnen', stat: 'wins', min: 5 },
  { key: 'survivor', icon: '⏱️', name: 'Überlebenskünstler', desc: 'Insgesamt 60 Minuten als Runner überlebt', stat: 'surviveMin', min: 60 },
  { key: 'marathon', icon: '🏃', name: 'Marathon', desc: 'Insgesamt 5 Stunden als Runner überlebt', stat: 'surviveMin', min: 300 },
  { key: 'ghost', icon: '👻', name: 'Phantom', desc: 'Als Runner bis zum Ende durchgekommen, ohne je live geortet zu werden', stat: 'cleanEscapes', min: 1 },
  { key: 'questStarter', icon: '📜', name: 'Abenteurer', desc: '5 Quests geschafft', stat: 'quests', min: 5 },
  { key: 'questMaster', icon: '🧙', name: 'Questmeister', desc: '25 Quests geschafft', stat: 'quests', min: 25 },
  { key: 'collector', icon: '🧺', name: 'Sammler', desc: '10 Fähigkeiten eingesammelt', stat: 'pickups', min: 10 },
  { key: 'iceAge', icon: '🧊', name: 'Eiszeit', desc: '5-mal Freeze eingesetzt', stat: 'freezes', min: 5 },
  { key: 'radarOperator', icon: '📡', name: 'Funker', desc: '5-mal Radar eingesetzt', stat: 'radars', min: 5 },
  { key: 'turncoat', icon: '🔄', name: 'Seitenwechsel', desc: 'Nach dem eigenen Fang als Hunter selbst einen Runner gefangen', stat: 'revenge', min: 1 },
  { key: 'photographer', icon: '📸', name: 'Fotograf', desc: 'Ein Foto in der Galerie der besten Fotos', stat: 'featured', min: 1 },
  { key: 'artist', icon: '🖼️', name: 'Künstler', desc: '5 Fotos in der Galerie', stat: 'featured', min: 5 },
  { key: 'chatter', icon: '💬', name: 'Funkverkehr', desc: '50 Nachrichten im Team-Chat', stat: 'chats', min: 50 },
];

/* Punkte für die Bestenliste */
const POINTS = {
  catch: 100, caughtByHunterWin: 200, runnerWin: 300, survivePerMin: 2, pickup: 20, photo: 5, featured: 100, abilityUsed: 0,
};

function catalogForClients() {
  const ab = {}; for (const [k, a] of Object.entries(ABILITIES)) ab[k] = { key: k, team: a.team, icon: a.icon, name: a.name, desc: a.desc, durationSec: a.durationSec, cooldownSec: a.cooldownSec, rarity: a.rarity || 'common', target: a.target || null };
  const qu = {}; for (const [k, q] of Object.entries(QUESTS)) qu[k] = { key: k, team: q.team, kind: q.kind, icon: q.icon, title: q.title, desc: q.desc, minutes: q.minutes, points: q.points };
  const badges = BADGES.map(({ key, icon, name, desc }) => ({ key, icon, name, desc }));
  return { abilities: ab, quests: qu, badges };
}

module.exports = { ABILITIES, QUESTS, POINTS, BADGES, RARITY, ABILITY_REWARD_QUESTS, catalogForClients };
