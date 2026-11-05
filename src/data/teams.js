// All teams and players are fictional.
// Stats are 0-99: spd (speed), sht (mid-range), thr (three point), dnk (inside/dunk),
// pas (passing/handles), def (defense). h = height in cm.

export const SKIN_TONES = [0xf1c9a5, 0xe0ac69, 0xc68642, 0x9a6a3d, 0x70452a, 0x4a2c1a];
export const HAIR_COLORS = [0x15100c, 0x2b1a10, 0x5a3a1e, 0xb88a4a, 0x1a1a1a, 0x7a2a12];

const p = (name, num, pos, h, spd, sht, thr, dnk, pas, def, skin, hair, hairColor = 0) => ({
  name, num, pos, h, spd, sht, thr, dnk, pas, def, skin, hair, hairColor,
});

export const TEAMS = [
  {
    id: 'vlt', city: 'Neon City', name: 'Voltage', abbr: 'VLT',
    primary: 0xffd21f, secondary: 0x141414, accent: 0x00e5ff,
    players: [
      p('Jax Holloway', 3, 'PG', 188, 95, 82, 88, 70, 92, 72, 2, 'short'),
      p('Rico Vance', 11, 'SG', 196, 84, 88, 91, 66, 74, 70, 4, 'buzz'),
      p('Theo Marsh', 23, 'SF', 201, 82, 78, 72, 86, 72, 80, 1, 'band'),
      p('Dmitri Kole', 42, 'PF', 206, 66, 74, 60, 85, 60, 84, 0, 'short', 3),
      p('Obi Nwankwo', 50, 'C', 213, 58, 62, 40, 92, 55, 90, 5, 'bald'),
    ],
  },
  {
    id: 'krk', city: 'Harbor Bay', name: 'Krakens', abbr: 'KRK',
    primary: 0x00a8a8, secondary: 0x0b1f3a, accent: 0x9ff6ff,
    players: [
      p('Mateo Rivas', 1, 'PG', 185, 92, 80, 84, 64, 90, 76, 2, 'short', 1),
      p('Kenji Ward', 7, 'SG', 193, 86, 85, 89, 70, 70, 74, 1, 'short'),
      p('Silas Grant', 24, 'SF', 203, 80, 82, 78, 88, 74, 78, 4, 'afro'),
      p('Bram Okafor', 33, 'PF', 208, 70, 70, 58, 90, 62, 86, 5, 'buzz'),
      p('Gus Lindqvist', 55, 'C', 216, 52, 72, 66, 84, 64, 82, 0, 'short', 3),
    ],
  },
  {
    id: 'scp', city: 'Desert Sun', name: 'Scorpions', abbr: 'SCP',
    primary: 0xff6a13, secondary: 0x3a1a06, accent: 0xffd28a,
    players: [
      p('Zeke Alvarez', 0, 'PG', 183, 97, 78, 82, 68, 88, 70, 2, 'band'),
      p('Marcus Bell', 13, 'SG', 195, 88, 90, 86, 74, 72, 68, 4, 'short'),
      p('Ty Delacroix', 21, 'SF', 200, 85, 76, 70, 92, 70, 76, 3, 'afro'),
      p('Ivan Petrov', 34, 'PF', 207, 64, 80, 74, 80, 66, 78, 0, 'buzz', 3),
      p('Moses Adeyemi', 44, 'C', 211, 60, 60, 35, 88, 52, 88, 5, 'short'),
    ],
  },
  {
    id: 'yet', city: 'Summit Peak', name: 'Yetis', abbr: 'YET',
    primary: 0xeef6ff, secondary: 0x2f7fd6, accent: 0x9bd0ff,
    players: [
      p('Cody Frost', 5, 'PG', 190, 88, 84, 90, 62, 86, 72, 0, 'short', 2),
      p('Andre Lake', 9, 'SG', 197, 82, 86, 92, 66, 70, 74, 3, 'buzz'),
      p('Nils Berg', 17, 'SF', 204, 74, 82, 80, 78, 76, 80, 0, 'short', 3),
      p('Rashad Cole', 31, 'PF', 205, 76, 72, 62, 88, 64, 82, 4, 'band'),
      p('Hugo Tanner', 52, 'C', 218, 50, 66, 52, 90, 58, 92, 1, 'bald'),
    ],
  },
  {
    id: 'frg', city: 'Iron Valley', name: 'Forge', abbr: 'FRG',
    primary: 0x3b4048, secondary: 0xe03a2f, accent: 0xffa38c,
    players: [
      p('Dante Ruiz', 2, 'PG', 186, 90, 76, 78, 66, 84, 86, 2, 'buzz'),
      p('Cal Mercer', 14, 'SG', 194, 82, 80, 82, 70, 70, 88, 1, 'short'),
      p('Jamal Pierce', 25, 'SF', 202, 84, 74, 68, 90, 68, 90, 5, 'short'),
      p('Viktor Hale', 41, 'PF', 209, 62, 70, 56, 86, 58, 92, 0, 'buzz', 4),
      p('Tobi Mensah', 54, 'C', 214, 56, 58, 30, 94, 50, 94, 4, 'bald'),
    ],
  },
  {
    id: 'owl', city: 'Midnight', name: 'Owls', abbr: 'OWL',
    primary: 0x5b2a86, secondary: 0xc6ccd6, accent: 0xd7b4ff,
    players: [
      p('Eli Navarro', 4, 'PG', 184, 94, 86, 92, 60, 94, 66, 2, 'short', 1),
      p('Quinn Harlow', 8, 'SG', 192, 86, 92, 94, 62, 74, 64, 0, 'short', 3),
      p('Ray Okonjo', 22, 'SF', 199, 80, 84, 86, 76, 76, 72, 5, 'band'),
      p('Lars Dahl', 35, 'PF', 207, 68, 82, 84, 74, 70, 74, 0, 'short', 2),
      p('Kofi Asante', 51, 'C', 212, 58, 70, 60, 84, 66, 82, 5, 'afro'),
    ],
  },
  {
    id: 'lmb', city: 'Redwood', name: 'Lumberjacks', abbr: 'LMB',
    primary: 0x1f6b3a, secondary: 0xe2b33c, accent: 0xa8e6b5,
    players: [
      p('Wes Calloway', 6, 'PG', 191, 86, 80, 80, 74, 86, 78, 1, 'band', 3),
      p('Bo Jennings', 12, 'SG', 196, 84, 82, 84, 78, 70, 76, 3, 'short'),
      p('Hank Morrow', 20, 'SF', 203, 78, 76, 70, 90, 70, 82, 0, 'short', 5),
      p('Ike Brennan', 40, 'PF', 210, 66, 68, 50, 94, 58, 86, 4, 'buzz'),
      p('Jonah Pike', 53, 'C', 217, 54, 64, 44, 92, 56, 90, 0, 'short', 2),
    ],
  },
  {
    id: 'stm', city: 'Thunder Plains', name: 'Stampede', abbr: 'STM',
    primary: 0x7a1d2e, secondary: 0xf2b705, accent: 0xffe08a,
    players: [
      p('Rocco Jett', 10, 'PG', 187, 96, 74, 76, 78, 88, 74, 3, 'short'),
      p('Malik Stone', 15, 'SG', 198, 90, 84, 80, 88, 72, 72, 5, 'buzz'),
      p('Diego Santos', 27, 'SF', 201, 86, 78, 74, 92, 68, 78, 2, 'short', 1),
      p('Axel Brandt', 45, 'PF', 208, 70, 72, 60, 92, 60, 84, 0, 'buzz', 3),
      p('Samson Ude', 99, 'C', 215, 60, 56, 30, 97, 50, 88, 4, 'bald'),
    ],
  },
];

export function overall(pl) {
  const best = Math.max(pl.sht, pl.thr, pl.dnk);
  return Math.round(pl.spd * 0.16 + pl.sht * 0.16 + pl.thr * 0.16 + pl.dnk * 0.16 + pl.pas * 0.12 + pl.def * 0.16 + best * 0.08);
}

export function teamRatings(team) {
  const ps = team.players;
  const avg = (f) => Math.round(ps.reduce((s, x) => s + f(x), 0) / ps.length);
  return {
    ovr: avg(overall),
    off: avg((x) => (x.sht + x.thr + x.dnk + x.pas) / 4),
    def: avg((x) => x.def),
  };
}

// Picks the 3 players who start: the user's choice plus the two best remaining.
export function starters(team, mainIndex = -1) {
  const idx = team.players.map((_, i) => i);
  const rest = idx.filter((i) => i !== mainIndex).sort((a, b) => overall(team.players[b]) - overall(team.players[a]));
  const chosen = mainIndex >= 0 ? [mainIndex, rest[0], rest[1]] : rest.slice(0, 3);
  return chosen.map((i) => team.players[i]);
}

export function heightLabel(cm) {
  const inches = Math.round(cm / 2.54);
  return `${Math.floor(inches / 12)}'${inches % 12}"`;
}
