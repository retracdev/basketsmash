import * as THREE from 'three';
import { PlayWorld } from './world.js';
import { Player } from '../entities/player.js';
import { starters } from '../data/teams.js';
import { COURT, HOOP_X, SHOT_CLOCK, inBounds } from '../core/constants.js';
import { clamp, rand, pick, chance, formatClock, hexToCss } from '../core/utils.js';
import { audio } from '../core/audio.js';
import { updateAI, resetAI, moveTo, guardPosition } from './ai.js';

function colorDist(a, b) {
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  return Math.hypot(ar - br, ag - bg, ab - bb);
}

export class Match extends PlayWorld {
  constructor(app, cfg) {
    super(app, { difficulty: cfg.difficulty });
    this.cfg = cfg;
    this.quarterLen = (cfg.quarter || 3) * 60;
    const home = cfg.home;
    let away = cfg.away;
    if (colorDist(home.primary, away.primary) < 140) {
      away = { ...away, primary: away.secondary, secondary: away.primary };
    }
    this.teams = [
      { data: home, score: 0, abbr: home.abbr },
      { data: away, score: 0, abbr: away.abbr },
    ];
    const hs = starters(home, cfg.userIndex);
    const as = starters(away);
    hs.forEach((d, i) => this.addPlayer(new Player(d, home, 0, { isUser: i === 0 })));
    as.forEach((d) => this.addPlayer(new Player(d, away, 1)));
    if (this.user) this.user.setUserHighlight(0x3cf0ff);
    this.ball = this.addBall();
    this.assignDefense();

    this.quarter = 1;
    this.clock = this.quarterLen;
    this.shotClock = SHOT_CLOCK;
    this.possession = -1;
    this.phase = 'pregame';
    this.phaseT = 0;
    this.tipWinner = 0;
    this.lastScorer = null;
    this.jumboT = 0;
    this.momentum = 0;
    this.runs = [0, 0];
    this.onFinished = null;
    this.buzzerBeater = false;
    this.courtView = 'broadcast';
    this.lineup();
  }

  // ---------------------------------------------------------- set pieces
  lineup() {
    const t0 = this.teamPlayers(0), t1 = this.teamPlayers(1);
    t0.forEach((p, i) => p.placeAt(-1.2 - i * 1.2, 2.5 + i * 0.6, new THREE.Vector3(0, 0, 0)));
    t1.forEach((p, i) => p.placeAt(1.2 + i * 1.2, -2.5 - i * 0.6, new THREE.Vector3(0, 0, 0)));
    this.ball.give(t0[0]);
    this.ball.release();
    this.ball.state = 'dead';
    this.ball.pos.set(0, 0.2, 0);
    this.ball.mesh.position.copy(this.ball.pos);
  }

  assignDefense() {
    const t0 = this.teamPlayers(0), t1 = this.teamPlayers(1);
    // Match players up by height rank.
    const s0 = t0.slice().sort((a, b) => a.height - b.height);
    const s1 = t1.slice().sort((a, b) => a.height - b.height);
    for (let i = 0; i < 3; i++) {
      for (const p of [s0[i], s1[i]]) if (!p.ai) p.ai = { think: 0, spot: null, spotT: 0, cutT: 0, drive: false, target: new THREE.Vector3(), contestT: -1 };
      s0[i].ai.man = s1[i];
      s1[i].ai.man = s0[i];
    }
  }

  startTipoff() {
    const t0 = this.teamPlayers(0), t1 = this.teamPlayers(1);
    const c0 = t0.slice().sort((a, b) => b.height - a.height)[0];
    const c1 = t1.slice().sort((a, b) => b.height - a.height)[0];
    const center = new THREE.Vector3(0, 0, 0);
    c0.placeAt(-0.55, 0, center);
    c1.placeAt(0.55, 0, center);
    t0.filter((p) => p !== c0).forEach((p, i) => p.placeAt(-3.2, i ? 3 : -3, center));
    t1.filter((p) => p !== c1).forEach((p, i) => p.placeAt(3.2, i ? -3 : 3, center));
    this.jumpers = [c0, c1];
    const b = this.ball;
    b.release();
    b.state = 'frozen';
    b.pos.set(0, 1.6, 0);
    b.vel.set(0, 0, 0);
    this.tipDone = false;
    this.phase = 'tipoff';
    this.phaseT = 0;
    this.app.hud.popup('TIP OFF', 'big');
    audio.whistle();
    audio.setCrowd(1);
  }

  updateTipoff(dt) {
    const b = this.ball;
    const t = this.phaseT;
    if (t > 0.6 && b.state === 'frozen') {
      b.state = 'loose';
      b.vel.set(0, 6.4, 0);
      b.resetFlight();
    }
    if (b.state === 'loose' && t > 0.95 && !this.tipDone) {
      for (const j of this.jumpers) {
        j.setAction('tip');
        j.jump(1);
      }
      this.tipDone = true;
    }
    if (this.tipDone && b.state === 'loose' && b.vel.y < 0.4 && b.pos.y > 2.6) {
      const [c0, c1] = this.jumpers;
      const s0 = c0.height * 2 + c0.s.dnk * 0.4 + rand(0, 0.5);
      const s1 = c1.height * 2 + c1.s.dnk * 0.4 + rand(0, 0.5);
      const win = s0 >= s1 ? c0 : c1;
      this.tipWinner = win.team;
      const mates = this.teammates(win);
      const to = mates.find((m) => m.isUser) || pick(mates);
      b.give(win);
      win.action = null;
      this.pass(win, to, { lob: true });
      this.possession = win.team;
      this.phase = 'live';
      this.tipDone = false;
      this.shotClock = SHOT_CLOCK;
      resetAI(this.players);
      this.app.hud.toast(`${this.teams[win.team].abbr} wins the tip`);
    }
  }

  // Inbound after a score / violation.
  setupInbound(team, spot, reason) {
    this.inboundTeam = team;
    const mates = this.teamPlayers(team);
    this.inbounder = mates.filter((p) => !p.isUser).sort((a, b) => b.s.pas - a.s.pas)[0];
    this.inboundSpot = spot.clone();
    this.phase = 'dead';
    this.phaseT = 0;
    this.deadReason = reason;
    this.possession = team;
    this.shotClock = SHOT_CLOCK;
    resetAI(this.players);
  }

  updateDead(dt) {
    // Everyone drifts toward a reasonable spot while the ball is dead.
    const team = this.inboundTeam;
    const side = this.attackSide(team);
    const spot = this.inboundSpot;
    for (const p of this.players) {
      if (p.isUser && this.userEnabled) continue;
      if (p.locked()) continue;
      p.stance = false;
      if (p === this.inbounder) {
        moveTo(p, spot, { sprint: true, arrive: 0.15 });
        continue;
      }
      let target;
      if (p.team === team) {
        const k = this.teamPlayers(team).indexOf(p);
        target = new THREE.Vector3(clamp(spot.x + side * (3 + k * 1.5), -12.5, 12.5), 0, clamp(spot.z * 0.4 + (k % 2 ? 2.5 : -2.5), -6, 6));
      } else {
        target = guardPosition(this, p, p.ai.man);
        p.stance = true;
      }
      p.lookTarget = this.inbounder.pos;
      moveTo(p, target, { sprint: target.distanceTo(p.pos) > 4 });
    }
    const b = this.ball;
    const arrived = this.inbounder.pos.distanceTo(spot) < 0.3;
    if ((this.phaseT > 1.2 && arrived) || this.phaseT > 3.2) {
      if (!arrived) this.inbounder.placeAt(spot.x, spot.z);
      this.inbounder.intent.x = this.inbounder.intent.z = 0;
      b.give(this.inbounder);
      this.inbounder.holding = true;
      this.inbounder.setAction('inbound', { dur: 99 });
      this.inbounder.faceToward(new THREE.Vector3(0, 0, 0), 1);
      this.phase = 'inbound';
      this.phaseT = 0;
    }
  }

  updateInbound(dt) {
    const team = this.inboundTeam;
    const side = this.attackSide(team);
    const inb = this.inbounder;
    const others = this.teamPlayers(team).filter((p) => p !== inb);
    inb.faceToward(new THREE.Vector3(side * 4, 0, 0), 0.1);
    for (const p of this.players) {
      if (p.isUser && this.userEnabled) continue;
      if (p === inb) continue;
      if (p.team === team) {
        const k = others.indexOf(p);
        const t = new THREE.Vector3(clamp(inb.pos.x + side * (3 + k * 2.5), -12.8, 12.8), 0, clamp(inb.pos.z * 0.5 + (k ? 3 : -3), -6.6, 6.6));
        moveTo(p, t, { arrive: 0.3 });
        p.lookTarget = inb.pos;
      } else {
        moveTo(p, guardPosition(this, p, p.ai.man), {});
        p.stance = true;
      }
    }
    if (this.phaseT > 1.0) {
      const to = others.find((p) => p.isUser) || others.sort((a, b) => b.s.pas - a.s.pas)[0];
      inb.action = null;
      this.pass(inb, to);
      this.phase = 'live';
      this.inbounder = null;
    }
  }

  // ---------------------------------------------------------- update
  update(dt) {
    this.phaseT += dt;
    super.update(dt);
    switch (this.phase) {
      case 'tipoff':
        this.updateTipoff(dt);
        break;
      case 'live':
        this.updateLive(dt);
        break;
      case 'dead':
        this.updateDead(dt);
        break;
      case 'inbound':
        this.updateInbound(dt);
        break;
      case 'buzzer':
        this.updateBuzzerWait(dt);
        break;
      case 'break':
        if (this.phaseT > 3.2) this.startPeriod();
        break;
      case 'final':
        this.updateFinal(dt);
        break;
    }
    this.updateHud(dt);
  }

  updateLive(dt) {
    const b = this.ball;
    this.clock -= dt;
    if (b.holder || b.state === 'pass') this.shotClock -= dt;

    if (this.clock <= 0) {
      this.clock = 0;
      if (b.state === 'shot' && !b.scored && !b.touchedFloor) {
        this.phase = 'buzzer';
        this.phaseT = 0;
        audio.buzzer();
      } else {
        audio.buzzer();
        this.endPeriod();
      }
      return;
    }
    if (this.shotClock <= 0 && b.state !== 'shot') {
      this.shotClock = 0;
      audio.buzzer();
      this.app.hud.popup('SHOT CLOCK', 'warn');
      this.turnover(this.possession, b.pos);
      return;
    }
    // Out of bounds
    // Inbound passes start out of bounds, so only judge passes once they're well under way.
    const judge = b.state === 'loose' || (b.state === 'pass' && !b.pass.fromOut && b.flightT > 0.45);
    if (judge && !inBounds(b.pos, 0.05) && b.pos.y < 2.2) {
      audio.whistle();
      this.app.hud.toast('OUT OF BOUNDS');
      const lt = b.lastTouch ? b.lastTouch.team : this.possession;
      this.turnover(lt, b.pos);
      return;
    }
    // Clock crowd energy
    if (this.clock < 30 && this.quarter >= 4 && Math.abs(this.teams[0].score - this.teams[1].score) <= 6) {
      audio.setCrowd(1.8);
      this.app.arena.exciteTarget = 0.35;
    }
  }

  updateBuzzerWait() {
    const b = this.ball;
    if (b.state !== 'shot' || this.phaseT > 3) this.endPeriod();
  }

  turnover(team, at) {
    const other = 1 - team;
    const z = at.z >= 0 ? COURT.halfW + 0.45 : -(COURT.halfW + 0.45);
    const x = clamp(at.x, -11, 11);
    this.ball.release();
    this.ball.state = 'dead';
    this.setupInbound(other, new THREE.Vector3(x, 0, z), 'turnover');
  }

  endPeriod() {
    const q = this.quarter;
    const s0 = this.teams[0].score, s1 = this.teams[1].score;
    this.ball.release();
    this.ball.state = 'dead';
    if (q >= 4 && s0 !== s1) {
      this.finish();
      return;
    }
    this.phase = 'break';
    this.phaseT = 0;
    const label = q >= 4 ? 'OVERTIME!' : q === 2 ? 'HALFTIME' : `END OF Q${q}`;
    this.app.hud.popup(label, 'big');
    if (q === 2) audio.commentary(`Halftime. ${this.scoreLine()}`);
    audio.horn();
  }

  startPeriod() {
    this.quarter++;
    this.clock = this.quarter > 4 ? 60 : this.quarterLen;
    this.shotClock = SHOT_CLOCK;
    // Q2/Q3 go to the team that lost the tip, Q4 to the winner. OT: alternate.
    const loser = 1 - this.tipWinner;
    const team = this.quarter === 4 ? this.tipWinner : this.quarter > 4 ? (this.quarter % 2) : loser;
    const side = this.attackSide(team);
    this.setupInbound(team, new THREE.Vector3(-side * (COURT.halfL + 0.45), 0, 1.5), 'period');
    this.app.hud.popup(this.quarter > 4 ? `OVERTIME` : `QUARTER ${this.quarter}`, 'big');
  }

  finish() {
    this.phase = 'final';
    this.phaseT = 0;
    audio.horn();
    const s0 = this.teams[0].score, s1 = this.teams[1].score;
    const win = s0 > s1 ? 0 : 1;
    this.winner = win;
    for (const p of this.teamPlayers(win)) p.setAction('celebrate', { dur: 99 });
    this.app.hud.popup(win === 0 ? 'YOU WIN!' : 'FINAL', 'big');
    audio.cheer(win === 0 ? 1.6 : 0.6, 4);
    this.app.arena.cheer(win === 0 ? 1 : 0.4);
    audio.commentary(`That's the game! ${this.teams[win].data.city} ${this.teams[win].data.name} win it, ${Math.max(s0, s1)} to ${Math.min(s0, s1)}!`, { force: true });
    const t = this.teams[win].data;
    this.confettiColors = [t.primary, t.secondary, t.accent, 0xffffff];
  }

  updateFinal(dt) {
    for (const p of this.players) {
      p.intent.x = p.intent.z = 0;
    }
    if (this.phaseT < 3 && Math.random() < dt * 30) {
      this.app.particles.emit(new THREE.Vector3(rand(-10, 10), 12, rand(-6, 6)), 6, { colors: this.confettiColors, speed: 1.2, up: 0.5, gravity: 1.2, life: 4, size: 0.18 });
    }
    if (this.phaseT > 3.2 && this.onFinished) {
      const cb = this.onFinished;
      this.onFinished = null;
      cb(this.results());
    }
  }

  results() {
    const box = (team) => this.teamPlayers(team).map((p) => ({ name: p.name, num: p.data.num, isUser: p.isUser, ...p.stats }));
    return {
      home: this.teams[0], away: this.teams[1],
      homeBox: box(0), awayBox: box(1),
      won: this.winner === 0,
      user: this.user ? { ...this.user.stats, name: this.user.name } : null,
    };
  }

  scoreLine() {
    const [a, b] = this.teams;
    return `${a.data.name} ${a.score}, ${b.data.name} ${b.score}`;
  }

  // ------------------------------------------------------------ hooks
  aiUpdate(dt) {
    if (this.phase === 'live') updateAI(this, dt);
    else if (this.phase === 'tipoff' || this.phase === 'break' || this.phase === 'pregame' || this.phase === 'buzzer') {
      for (const p of this.players) {
        if (p.isUser && this.userEnabled) continue;
        p.intent.x = p.intent.z = 0;
        p.lookTarget = this.ball.pos;
      }
    }
  }

  clampPlayer(p) {
    return !(p === this.inbounder && (this.phase === 'dead' || this.phase === 'inbound'));
  }

  canPickup(p, b) {
    if (this.phase === 'live') return true;
    if (this.phase === 'tipoff') return false;
    if (this.phase === 'inbound' || this.phase === 'dead') return false;
    return false;
  }

  isDefending(p) {
    if (this.phase === 'final' || this.phase === 'pregame') return false;
    return this.possession !== -1 && this.possession !== p.team;
  }

  guardSpot(u) {
    return u.ai && u.ai.man ? guardPosition(this, u, u.ai.man) : null;
  }

  stealBias() {
    return 1;
  }

  changePossession(team) {
    if (this.possession !== team) {
      this.possession = team;
      this.shotClock = SHOT_CLOCK;
      resetAI(this.players);
    }
  }

  onPickup(p, b, how) {
    if (this.phase !== 'live') return;
    if (how === 'rebound' && p.team === this.possession) {
      this.shotClock = Math.max(this.shotClock, 14);
      if (p.team === 0) this.app.hud.toast('OFFENSIVE BOARD!');
    }
    this.changePossession(p.team);
  }

  onCatch(p, from) {
    if (p.team !== from.team) this.changePossession(p.team);
  }

  onSteal(d, victim, intercept) {
    this.changePossession(d.team);
    const user = d.isUser;
    this.app.hud.popup(intercept ? 'PICKED OFF!' : 'STOLEN!', d.team === 0 ? 'good' : 'bad');
    if (user || d.team === 0) audio.cheer(0.8, 1.5);
    else audio.ooh();
    if (chance(0.6)) audio.commentary(pick(['Picked his pocket!', 'Stolen!', 'What a steal!', 'Turnover!']));
  }

  onBlock(d, shooter) {
    this.app.hud.popup('REJECTED!', d.team === 0 ? 'good' : 'bad');
    audio.cheer(d.team === 0 ? 1.1 : 0.4, 1.8);
    this.app.arena.cheer(0.8);
    audio.commentary(pick(['Rejected!', 'Get that out of here!', 'Denied!', 'Not in my house!']));
  }

  onAnkles(p, d) {
    this.app.hud.popup('ANKLES!', p.team === 0 ? 'good' : 'bad');
    audio.ooh();
    audio.commentary(pick(['Oh, he broke his ankles!', 'Shook him!', 'Down he goes!']));
  }

  onShotRelease(p, info, res) {
    if (p.isUser && res) {
      this.app.hud.shotFeedback(res.label, res.grade);
    }
  }

  onMiss(b, shot) {
    if (shot.shooter.isUser) {
      this.onFire = 0;
    }
    if (shot.kind === 'jumper' && shot.dist > 6 && chance(0.4)) audio.ooh();
  }

  onDunk(p, style) {
    this.app.arena.cheer(1);
    audio.cheer(1.3, 2.5);
    const s = p.isUser ? 'good' : p.team === 0 ? 'good' : 'bad';
    this.app.hud.popup(style === 'windmill' ? 'WINDMILL!' : p.action && p.action.alley ? 'ALLEY-OOP!' : 'SLAM!', s);
    audio.commentary(pick(['Oh what a slam!', 'Throw it down!', 'With authority!', 'Boom! Posterized!', 'Monster jam!']), { force: true });
  }

  onScore(b, side, team, pts, shot, clean) {
    if (this.phase !== 'live' && this.phase !== 'buzzer') return;
    this.teams[team].score += pts;
    const shooter = shot ? shot.shooter : b.lastTouch;
    if (shooter && shooter.team === team) {
      shooter.stats.pts += pts;
      shooter.stats.fgm++;
      if (pts === 3) shooter.stats.tpm++;
      const passer = shooter.lastPassFrom;
      if (passer && passer.team === team && passer !== shooter && this.time - shooter.lastPassT < 4) passer.stats.ast++;
    }
    const isUserTeam = team === 0;
    if (shooter && shooter.isUser) {
      this.onFire++;
      if (this.onFire === 3) {
        this.app.hud.popup("YOU'RE ON FIRE!", 'fire');
        audio.commentary('He is heating up!', { force: true });
      }
    }
    // Feedback
    const buzzer = this.phase === 'buzzer';
    if (buzzer) {
      this.app.hud.popup('BUZZER BEATER!', isUserTeam ? 'good' : 'bad');
      audio.cheer(2, 4);
      this.app.arena.cheer(1);
      audio.commentary('At the buzzer! Unbelievable!', { force: true });
    } else if (shot && shot.kind === 'dunk') {
      // handled by onDunk
    } else {
      let label = pts === 3 ? '+3' : '+2';
      if (shot && shot.perfect && shot.kind === 'jumper') label = pts === 3 ? 'SPLASH! +3' : 'PERFECT +2';
      else if (clean) label = pts === 3 ? 'SWISH! +3' : 'SWISH +2';
      this.app.hud.popup(label, isUserTeam ? 'good' : 'bad');
      if (pts === 3 && shot && shot.dist > 9) audio.commentary('From way downtown!', { force: true });
      else if (pts === 3 && chance(0.5)) audio.commentary(pick(['Bang!', 'Splash!', 'From downtown!', 'Three ball!']));
      else if (chance(0.15)) audio.commentary(pick(['Count it!', 'Nothing but net!', 'Good!']));
    }
    if (isUserTeam) {
      audio.cheer(pts === 3 ? 1.3 : 1, 2.2);
      this.app.arena.cheer(pts === 3 ? 0.9 : 0.6);
    } else {
      audio.cheer(0.35, 1.2);
    }
    if (shooter && !shooter.isUser && shooter.team === team && chance(0.3) && !shooter.action) shooter.setAction('celebrate', { dur: 0.9 });

    // Runs
    this.runs[team] += pts;
    this.runs[1 - team] = 0;
    if (this.runs[team] >= 8 && this.runs[team] - pts < 8) {
      this.app.hud.toast(`${this.teams[team].abbr} ON A ${this.runs[team]}-0 RUN`);
      if (team === 0) audio.clapChant();
    }

    if (this.phase === 'buzzer') return;
    // Other team inbounds from under the basket.
    this.setupInbound(1 - team, new THREE.Vector3(side * (COURT.halfL + 0.45), 0, rand(-1.8, 1.8)), 'score');
    this.phaseT = -0.2;
  }

  // ------------------------------------------------------------ HUD
  updateHud(dt) {
    const hud = this.app.hud;
    const [a, b] = this.teams;
    const period = this.quarter > 4 ? `OT${this.quarter > 5 ? this.quarter - 4 : ''}` : `Q${this.quarter}`;
    hud.setScorebug({
      home: a.abbr, away: b.abbr,
      homeColor: hexToCss(a.data.primary), awayColor: hexToCss(b.data.primary),
      hs: a.score, as: b.score,
      period,
      clock: formatClock(this.clock),
      shot: this.phase === 'live' ? Math.ceil(Math.max(0, this.shotClock)) : '',
      poss: this.possession,
    });
    this.jumboT -= dt;
    if (this.jumboT <= 0) {
      this.jumboT = 0.5;
      this.app.arena.jumboDraw({
        home: a.abbr, away: b.abbr, homeColor: hexToCss(a.data.primary), awayColor: hexToCss(b.data.primary),
        hs: a.score, as: b.score, clock: formatClock(this.clock), period, shot: this.phase === 'live' ? Math.ceil(Math.max(0, this.shotClock)) : null,
      });
    }
    const u = this.user;
    if (u) {
      const offense = this.possession === u.team;
      hud.setHints(offense
        ? (u.hasBall
          ? [['SPACE', 'Shoot (hold/release)'], ['E', 'Pass'], ['Q', 'Crossover'], ['SHIFT', 'Sprint']]
          : [['E', 'Call for ball'], ['SPACE', 'Jump'], ['SHIFT', 'Sprint']])
        : [['SPACE', 'Block / Jump'], ['E', 'Steal (get close)'], ['Q (hold)', 'Auto-guard'], ['SHIFT', 'Sprint']]);
      hud.setStamina(u.stamina);
    }
  }

  cameraContext() {
    const u = this.user;
    const b = this.ball;
    let lookAt = null;
    if (u) {
      // First person auto-look: the rim when you have it, otherwise the ball.
      lookAt = u.hasBall
        ? new THREE.Vector3(this.attackSide(u.team) * HOOP_X, 2.7, 0)
        : new THREE.Vector3(b.pos.x, b.holder ? 1.3 : Math.max(0.8, b.pos.y), b.pos.z);
    }
    return {
      focus: b.pos,
      user: u,
      lookAt,
      steerRate: u && u.hasBall ? 2.2 : 3,
      offense: u && this.possession === u.team,
      side: u ? (this.possession === u.team || this.possession === -1 ? this.attackSide(u.team) : this.attackSide(1 - u.team)) : 1,
    };
  }

}
