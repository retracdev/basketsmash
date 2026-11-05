// Local persistence, stored in a cookie for now. Everything goes through this module
// so a cloud save / leaderboard backend can be plugged in later without touching game code.

const KEY = 'basketsmash_v1';
const MAX_AGE = 60 * 60 * 24 * 365 * 2; // two years

function readCookie() {
  const prefix = KEY + '=';
  for (const part of document.cookie.split(';')) {
    const c = part.trim();
    if (c.startsWith(prefix)) return decodeURIComponent(c.slice(prefix.length));
  }
  return null;
}

function writeCookie(value) {
  document.cookie = `${KEY}=${encodeURIComponent(value)}; max-age=${MAX_AGE}; path=/; SameSite=Lax`;
}

const DEFAULTS = {
  settings: {
    music: 0.6,
    sfx: 0.8,
    crowd: 0.7,
    announcer: true,
    hints: true,
    view: 'pov',
    autoLook: true,
    quality: 'medium',
    quarter: 3,
    difficulty: 1,
  },
  records: {
    shootout: 0,
    world: 0,
    hotspots: 0,
  },
  career: {
    games: 0,
    wins: 0,
    points: 0,
    bestGame: 0,
  },
  tutorialDone: false,
};

let data = load();

function load() {
  try {
    const raw = readCookie();
    if (!raw) return structuredClone(DEFAULTS);
    const parsed = JSON.parse(raw);
    return {
      ...structuredClone(DEFAULTS),
      ...parsed,
      settings: { ...DEFAULTS.settings, ...(parsed.settings || {}) },
      records: { ...DEFAULTS.records, ...(parsed.records || {}) },
      career: { ...DEFAULTS.career, ...(parsed.career || {}) },
    };
  } catch {
    return structuredClone(DEFAULTS);
  }
}

function save() {
  try {
    writeCookie(JSON.stringify(data));
  } catch {
    /* cookies unavailable - ignore */
  }
}

export const storage = {
  get settings() {
    return data.settings;
  },
  setSetting(key, value) {
    data.settings[key] = value;
    save();
  },
  get records() {
    return data.records;
  },
  // Returns true when this is a new record.
  submitRecord(mode, score) {
    if (score > (data.records[mode] || 0)) {
      data.records[mode] = score;
      save();
      return true;
    }
    return false;
  },
  get career() {
    return data.career;
  },
  recordGame({ won, points }) {
    data.career.games++;
    if (won) data.career.wins++;
    data.career.points += points;
    data.career.bestGame = Math.max(data.career.bestGame, points);
    save();
  },
  get tutorialDone() {
    return data.tutorialDone;
  },
  markTutorialDone() {
    data.tutorialDone = true;
    save();
  },
};
