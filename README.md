# Basketsmash

A 3D arcade basketball game that runs in the browser. Part of the **retrac.space** collection.

Pick a team, choose the player you want to be, draw a random opponent and play 3-on-3 full court in the
**retrac.space Arena**. Everything is generated in code: the stadium, players, ball, textures, music, crowd
and sound effects, so there are no third-party art or audio assets.

## Features

- **3-on-3 full court exhibition**: 8 fictional teams, 40 players rated on SPD / SHT / 3PT / DNK / PAS / DEF.
  You control your chosen player and AI teammates run the floor with you. Random or hand-picked opponent.
- **Timing-based shot meter**: hold to rise up and release at the top of the jump. The green window grows and
  shrinks with your ratings, distance and how closely you're guarded. Early shots fall short and late ones go long.
- **Real ball physics**: rim, backboard and net collisions, so you get rattle-ins, bricks, swishes and long rebounds.
- **Moves**: layups, dunks (one-hand, two-hand, windmill), alley-oops, crossovers with ankle-breakers, steals,
  blocks, rebounds, passing with interceptions, and an "on fire" streak.
- **Game rules**: quarters, shot clock, out of bounds, inbounds after scores, overtime, buzzer beaters and a box score.
- **Arcade**: 3-Point Shootout, Around the World, Hot Spots and a free Shootaround.
- **Interactive tutorial**: 12 steps covering every control.
- **Presentation**: stadium fly-through with pyro and spotlights, jumbotron, LED ad ribbons, animated crowd,
  procedural music and a speech-synthesis announcer.

## Controls

| Action | Keyboard | Gamepad |
| --- | --- | --- |
| Move | WASD / Arrow keys | Left stick |
| Sprint | Shift | RT |
| Shoot (hold, release at top) / Block / Rebound | Space | A |
| Pass / Call for ball / Steal | E | X |
| Crossover / Hold: auto-guard on defense | Q | B |
| Camera (broadcast / player) | C | Y |
| Pause | Esc | Start |

## Development

```bash
npm install
npm run dev      # local dev server
npm run build    # production build into dist/
```

The project is plain JavaScript with [three.js](https://threejs.org) and [Vite](https://vite.dev).

## Deploying to GitHub Pages

`.github/workflows/deploy.yml` builds and publishes the game on every push to `main`.
One-time setup: in the repo go to **Settings → Pages → Build and deployment → Source** and choose **GitHub Actions**.

## Project layout

```
src/
  core/      constants, input (keyboard + gamepad), procedural audio, save data, utils
  data/      teams and player ratings
  entities/  player model + animation, ball physics
  world/     arena / stadium, procedural textures, particles
  game/      shared simulation, match rules, AI, shooting, arcade modes, tutorial, camera
  ui/        HUD and menus
```

Saves (settings, records, career stats) are stored locally in a cookie through `src/core/storage.js`, the
single place to hook up cloud saves and leaderboards later.

## Credits

- Fonts: Bungee, Teko and Space Grotesk (SIL Open Font License) via Fontsource.
- three.js (MIT).
- All teams, players, sponsors and the arena are fictional.
