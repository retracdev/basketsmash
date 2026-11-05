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
| Camera (first person / third person / court) | C | Y |
| Pause | Esc | Start |

**Auto Camera** defaults to **MAX** in first and third person: it turns and looks up/down to follow
the rim when you have the ball and the ball when you don't, including high shots and nearby targets.
Tutorial and arcade views follow the current target. MAX keeps tracking height while you use arrow
keys to turn, so you can play using just the keyboard on a trackpad. Manual vertical look temporarily
overrides height tracking; assistance eases back in afterward. Settings also offers **ON** for the
previous gentle tracking with limited vertical movement, and **OFF** for full manual look. Existing
enabled saves upgrade to MAX; disabled saves stay OFF. The setting saves locally and applies immediately.

## Development

Before each game, rematch, arcade round, or tutorial, a fullscreen prompt lets you choose
**Turn on fullscreen** or **Keep fullscreen off**. Your last choice is saved and highlighted next time;
the prompt still appears each round. Exiting fullscreen during the intro or gameplay opens the normal
pause menu, including Settings and How to Play. Choosing Resume then asks whether to re-enter fullscreen
or continue without it. If the browser blocks fullscreen, the prompt stays open so you can retry or
choose to play without it.

While the tab or window is inactive, its title changes to **retrac.space** and it uses the alternate
robot favicon, and all game audio is muted. Returning restores the Basketsmash title, basketball favicon,
and audio at your current volume settings; paused gameplay stays paused.

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
