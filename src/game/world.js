import * as THREE from 'three';
import { Ball } from '../entities/ball.js';
import { HOOP_X, RIM_Y, GRAVITY, distToHoop2D, isThreePoint, hoopPos, inBounds } from '../core/constants.js';
import { clamp, chance, rand, gauss } from '../core/utils.js';
import { audio } from '../core/audio.js';
import { input } from '../core/input.js';
import {
  JUMPER, DIFF, contestLevel, greenWindow, resolveRelease, aiRelease, solveLaunch, aimTarget, arcFor,
} from './shooting.js';

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

// Base simulation shared by matches, arcade modes and the tutorial.
// Subclasses override the hook methods near the bottom.
export class PlayWorld {
  constructor(app, opts = {}) {
    this.app = app;
    this.root = new THREE.Group();
    app.scene.add(this.root);
    this.players = [];
    this.balls = [];
    this.user = null;
    this.userEnabled = true;
    this.difficulty = opts.difficulty ?? app.settings.difficulty ?? 1;
    this.meter = null;
    this.time = 0;
    this.timeScale = 1;
    this.slowT = 0;
    this.onFire = 0; // user's consecutive makes
    this.fireTrailT = 0;
  }

  // ------------------------------------------------------------- setup
  addPlayer(p) {
    this.players.push(p);
    this.root.add(p.object);
    if (p.isUser) this.user = p;
    return p;
  }

  addBall(opts = {}) {
    const b = new Ball(opts);
    this.root.add(b.mesh);
    this.balls.push(b);
    b.on('floor', (ball, v) => {
      audio.bounce(Math.min(1, v / 6) * this.audibility(ball.pos));
      if (ball.state === 'pass' && ball.pass) ball.pass.bounced = true;
    });
    b.on('rim', (ball, v) => {
      audio.rim(Math.min(1, v / 4));
      this.app.arena.swishNet(ball.pos.x > 0 ? 1 : -1, 0.3);
    });
    b.on('board', (ball, v) => audio.board(Math.min(1, v / 5)));
    b.on('score', (ball, side) => this.handleScore(ball, side));
    return b;
  }

  removeBall(b) {
    this.root.remove(b.mesh);
    b.mesh.material.dispose();
    this.balls = this.balls.filter((x) => x !== b);
  }

  dispose() {
    for (const p of this.players) p.dispose();
    for (const b of this.balls) b.mesh.material.dispose();
    this.app.scene.remove(this.root);
    this.players = [];
    this.balls = [];
    this.meter = null;
  }

  audibility(pos) {
    const d = this.app.camera.position.distanceTo(pos);
    return clamp(1.4 - d / 30, 0.15, 1);
  }

  teamPlayers(team) {
    return this.players.filter((p) => p.team === team);
  }
  opponents(p) {
    return this.players.filter((q) => q.team !== p.team && !q.dummy);
  }
  teammates(p) {
    return this.players.filter((q) => q.team === p.team && q !== p);
  }
  holderOf() {
    for (const b of this.balls) if (b.holder) return b.holder;
    return null;
  }

  // ------------------------------------------------------------ update
  update(dt) {
    this.time += dt;
    if (this.slowT > 0) {
      this.slowT -= dt / Math.max(0.2, this.timeScale);
      if (this.slowT <= 0) this.timeScale = 1;
    }
    if (this.user && this.userEnabled) this.userControl(dt);
    this.aiUpdate(dt);
    for (const p of this.players) {
      this.updateAction(p, dt);
      p.update(dt, { clamp: this.clampPlayer(p) });
      if (p.landed) {
        p.landed = false;
        if (p.speed > 2 && chance(0.3)) audio.squeak();
      }
    }
    this.separatePlayers();
    for (const b of this.balls.slice()) this.updateBall(b, dt);
    this.checkBlocks();
    this.modeUpdate(dt);
    this.updateMeter();
    this.fireTrail(dt);
  }

  // ------------------------------------------------------- user input
  userControl() {
    const u = this.user;
    const { fwd, right } = this.app.rig.basis();
    const ax = input.axis.x, ay = input.axis.y;
    let mx = right.x * ax + fwd.x * ay;
    let mz = right.z * ax + fwd.z * ay;
    const defending = this.isDefending(u);
    u.stance = defending && !u.hasBall;

    if (defending && input.held('move') && Math.hypot(ax, ay) < 0.1) {
      const spot = this.guardSpot(u);
      if (spot) {
        const dx = spot.x - u.pos.x, dz = spot.z - u.pos.z;
        const d = Math.hypot(dx, dz);
        if (d > 0.25) {
          const k = Math.min(1, d / 1.2);
          mx = (dx / d) * k;
          mz = (dz / d) * k;
        }
      }
    }
    u.intent.x = mx;
    u.intent.z = mz;
    u.intent.sprint = input.held('sprint');
    const lt = this.userLookTarget(u);
    u.lookTarget = lt;

    if (u.hasBall) {
      if (input.pressed('shoot')) this.beginShot(u);
      if (input.pressed('pass') && !u.locked()) this.userPass(u, mx, mz);
      if (input.pressed('move') && !u.locked()) this.crossover(u);
    } else {
      if (input.pressed('shoot') && !u.airborne && !u.locked()) {
        u.setAction('block');
        u.jump(1);
      }
      if (input.pressed('pass')) {
        const h = this.holderOf();
        if (h && h.team === u.team) this.callForBall(u, h);
        else if (!u.locked()) this.trySteal(u);
      }
    }
    if (u.action && u.action.type === 'jumper' && !u.action.released && !input.held('shoot')) {
      this.releaseJumper(u);
    }
  }

  userPass(u, mx, mz) {
    const mates = this.teammates(u).filter((m) => !m.dummy || m.passTarget);
    if (!mates.length) return;
    let dir = new THREE.Vector2(mx, mz);
    if (dir.lengthSq() < 0.01) dir.set(Math.sin(u.facing), Math.cos(u.facing));
    dir.normalize();
    let best = null, bestS = -Infinity;
    for (const m of mates) {
      const dx = m.pos.x - u.pos.x, dz = m.pos.z - u.pos.z;
      const d = Math.hypot(dx, dz) || 1;
      const s = (dx * dir.x + dz * dir.y) / d - d * 0.015;
      if (s > bestS) { bestS = s; best = m; }
    }
    if (best) this.pass(u, best);
  }

  // ------------------------------------------------------------ actions
  beginShot(p, force) {
    if (!p.hasBall || (p.action && p.action.type !== 'catch' && p.action.type !== 'crossover')) return;
    p.action = null;
    const side = this.attackSide(p.team);
    const hx = side * HOOP_X;
    const dist = distToHoop2D(p.pos, side);
    const to = _a.set(hx - p.pos.x, 0, -p.pos.z).normalize();
    const toward = p.vel.x * to.x + p.vel.z * to.z;
    const canDunk = p.s.dnk >= 0.42 && (p.height >= 1.93 || p.s.dnk >= 0.7);
    const dunkRange = p.intent.sprint ? 1.5 + p.s.dnk * 2.0 : 1.35;
    let kind = force;
    if (!kind) {
      if (canDunk && dist <= dunkRange && (dist < 1.4 || toward > 1.8)) kind = 'dunk';
      else if (dist < 2.9 && (toward > 1.5 || dist < 1.7)) kind = 'layup';
      else kind = 'jumper';
    }
    if (kind === 'dunk') this.startDunk(p, side);
    else if (kind === 'layup') this.startLayup(p, side);
    else this.startJumper(p, side);
  }

  startJumper(p, side) {
    const opp = this.opponents(p);
    const contest = contestLevel(p, opp, side);
    const a = p.setAction('jumper', { gather: JUMPER.gather, jumped: false, released: false, side, contest });
    p.holding = true;
    p.vel.multiplyScalar(0.25);
    p.faceToward(hoopPos(side, _b), 1);
    if (!p.isUser) {
      a.aiM = aiRelease(p, side, contest, this.aiSigma(p));
    } else {
      this.meter = { player: p, value: 0, sweet: JUMPER.sweet, w: 0.05, contest, done: false, grade: null, label: '', fade: 0 };
    }
  }

  startLayup(p, side) {
    const hx = side * HOOP_X;
    const to = _a.set(hx - p.pos.x, 0, -p.pos.z);
    const d = to.length();
    to.normalize();
    p.setAction('layup', { side, released: false });
    p.holding = true;
    const sp = clamp(Math.min(p.speed, 4), 1.2, 4) * clamp((d - 0.6) / 1.6, 0.15, 1);
    p.vel.set(to.x * sp, 0, to.z * sp);
    p.facing = Math.atan2(to.x, to.z);
    p.vy = 4.3 + p.s.dnk * 0.6;
    p.airborne = true;
  }

  startDunk(p, side) {
    const hx = side * HOOP_X;
    const dir = new THREE.Vector3(hx - p.pos.x, 0, -p.pos.z);
    if (dir.lengthSq() < 0.01) dir.set(side, 0, 0);
    dir.normalize();
    const end = new THREE.Vector3(hx, 0, 0).addScaledVector(dir, -0.42);
    const start = p.pos.clone();
    const dist = start.distanceTo(end);
    const yHang = Math.max(0.45, RIM_Y + 0.3 - p.height * 1.3);
    const r = Math.random();
    const style = p.s.dnk > 0.8 && r < 0.35 ? 'windmill' : r < 0.6 ? 'two' : 'one';
    p.setAction('dunk', { side, start, end, dir, dur: 0.42 + dist * 0.08, yHang, slammed: false, hanging: false, hangT: 0, style });
    p.holding = true;
    p.airborne = false;
    p.vel.set(0, 0, 0);
    p.facing = Math.atan2(dir.x, dir.z);
    audio.whoosh();
  }

  releaseJumper(p) {
    const a = p.action;
    if (!a || a.released) return;
    a.released = true;
    a.releaseT = a.t;
    p.holding = false;
    if (!p.hasBall) {
      this.endMeter(p, 'BLOCKED');
      return;
    }
    const side = a.side;
    const m = p.isUser ? a.t / JUMPER.fill : a.aiM;
    const contest = Math.max(a.contest, contestLevel(p, this.opponents(p), side));
    const w = greenWindow(p, side, contest, { difficulty: this.difficulty, isUser: p.isUser, onFire: p.isUser && this.onFire >= 3 });
    const res = resolveRelease(p, side, m, w, contest);
    const from = p.ballHoldPos(new THREE.Vector3());
    const dist = distToHoop2D(p.pos, side);
    const target = aimTarget(from, side, res.depth, res.lat);
    const vel = solveLaunch(from, target, arcFor(dist, res.perfect));
    const three = isThreePoint(p.pos, side);
    const info = {
      shooter: p, team: p.team, side, points: three ? 3 : 2, kind: 'jumper',
      perfect: res.perfect, grade: res.grade, from: p.pos.clone(), dist, contest,
    };
    p.ball.launch(from, vel, 'shot', info);
    this.afterRelease(p, info);
    if (p.isUser && this.meter) {
      this.meter.done = true;
      this.meter.value = m;
      this.meter.w = w;
      this.meter.grade = res.grade;
      this.meter.label = res.label;
      this.meter.fade = 1.1;
      if (res.perfect) audio.perfect();
    }
    this.onShotRelease(p, info, res);
  }

  releaseLayup(p) {
    const a = p.action;
    a.released = true;
    p.holding = false;
    if (!p.hasBall) return;
    const side = a.side;
    const contest = contestLevel(p, this.opponents(p), side);
    const bonus = p.isUser ? DIFF.userLayup[this.difficulty] : 0;
    const pSucc = clamp(0.52 + 0.36 * p.s.dnk + 0.1 * p.s.sht - contest * 0.5 + bonus, 0.12, 0.96);
    const ok = Math.random() < pSucc;
    let depth = gauss() * 0.01, lat = gauss() * 0.01;
    if (!ok) {
      const ang = Math.random() * Math.PI * 2;
      const mag = rand(0.16, 0.26);
      depth = Math.cos(ang) * mag;
      lat = Math.sin(ang) * mag;
    }
    const from = p.ballHoldPos(new THREE.Vector3());
    const dist = Math.hypot(from.x - side * HOOP_X, from.z);
    const target = aimTarget(from, side, depth, lat);
    const vel = solveLaunch(from, target, dist < 0.5 ? 78 : 64);
    const info = { shooter: p, team: p.team, side, points: 2, kind: 'layup', perfect: ok, from: p.pos.clone(), dist, contest };
    p.ball.launch(from, vel, 'shot', info);
    this.afterRelease(p, info);
    this.onShotRelease(p, info, { label: ok ? 'GOOD LAYUP' : 'TOUGH LAYUP', grade: ok ? 'good' : 'bad', perfect: false });
  }

  slam(p) {
    const a = p.action;
    a.slammed = true;
    a.hanging = true;
    p.holding = false;
    if (!p.hasBall) return;
    const side = a.side;
    const from = new THREE.Vector3(side * HOOP_X, RIM_Y + 0.22, 0).addScaledVector(a.dir, -0.05);
    const vel = new THREE.Vector3(a.dir.x * 0.3, -6.5, a.dir.z * 0.3);
    const info = { shooter: p, team: p.team, side, points: 2, kind: 'dunk', perfect: true, from: p.pos.clone(), dist: 0.5, contest: 0 };
    p.ball.launch(from, vel, 'shot', info);
    this.afterRelease(p, info);
    p.stats.dnk++;
    audio.slam();
    this.app.rig.shake(0.35);
    this.slowMo(0.45, 0.45);
    this.onDunk(p, a.style);
  }

  afterRelease(p, info) {
    p.cd.pickup = 0.45;
    p.stats.fga++;
    if (info.points === 3) p.stats.tpa++;
    const b = this.balls.find((x) => x.shot === info);
    if (b) b.blockTried = new Set();
  }

  slowMo(scale, dur) {
    this.timeScale = scale;
    this.slowT = dur;
  }

  updateAction(p, dt) {
    const a = p.action;
    if (!a) return;
    switch (a.type) {
      case 'jumper': {
        if (!a.jumped && a.t >= a.gather) {
          a.jumped = true;
          p.vy = JUMPER.jumpVy;
          p.airborne = true;
        }
        const m = a.t / JUMPER.fill;
        if (!a.released) {
          p.faceToward(hoopPos(a.side, _b), 1 - Math.exp(-15 * dt));
          if (p.isUser && this.meter && !this.meter.done) {
            this.meter.value = m;
            const c = Math.max(a.contest, contestLevel(p, this.opponents(p), a.side));
            this.meter.contest = c;
            this.meter.w = greenWindow(p, a.side, c, { difficulty: this.difficulty, isUser: true, onFire: this.onFire >= 3 });
          }
          if ((!p.isUser && m >= a.aiM) || m >= JUMPER.autoRelease) this.releaseJumper(p);
        } else if (!p.airborne && a.t > a.releaseT + 0.05) {
          p.action = null;
        }
        if (a.jumped && !p.airborne && !a.released) this.releaseJumper(p);
        break;
      }
      case 'layup': {
        if (!a.released && a.t >= 0.27) this.releaseLayup(p);
        if (a.released && !p.airborne) p.action = null;
        break;
      }
      case 'dunk': {
        if (!a.slammed) {
          const k = clamp(a.t / a.dur, 0, 1);
          const e = 1 - (1 - k) * (1 - k);
          p.pos.x = a.start.x + (a.end.x - a.start.x) * e;
          p.pos.z = a.start.z + (a.end.z - a.start.z) * e;
          const y0 = a.y0 || 0;
          p.y = y0 + (a.yHang - y0) * Math.sin((k * Math.PI) / 2);
          p.vel.set(0, 0, 0);
          if (k >= 1) this.slam(p);
          if (!p.hasBall && !a.slammed) {
            // got blocked mid-air
            a.slammed = true;
            p.airborne = true;
            p.vy = 0;
          }
        } else if (a.hanging) {
          a.hangT += dt;
          p.y = a.yHang - 0.08;
          if (a.hangT > 0.38) {
            a.hanging = false;
            p.airborne = true;
            p.vy = 0;
            p.pos.addScaledVector(a.dir, -0.15);
          }
        } else if (!p.airborne) {
          p.action = null;
        }
        break;
      }
      case 'block':
      case 'rebound':
      case 'tip':
        if (!p.airborne && a.t > 0.1) p.action = null;
        break;
      case 'crossover':
        if (a.t >= a.dur) {
          p.ballSide = a.to;
          p.action = null;
        }
        break;
      default:
        if (a.dur != null && a.t >= a.dur) p.action = null;
    }
  }

  crossover(p) {
    if (!p.hasBall || p.cd.cross > 0 || p.holding || p.action) return;
    p.setAction('crossover', { from: p.ballSide, to: -p.ballSide, dur: 0.26 });
    p.cd.cross = 0.55;
    p.speedBoost = 0.45;
    const prevCross = p.lastCrossT;
    p.lastCrossT = this.time;
    audio.squeak();
    // Ankle breaker?
    const fwd = p.forward.clone();
    for (const d of this.opponents(p)) {
      const dx = d.pos.x - p.pos.x, dz = d.pos.z - p.pos.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 1.9 || dist < 0.01) continue;
      if ((dx * fwd.x + dz * fwd.z) / dist < 0.3) continue;
      if (d.action && d.action.type === 'stumble') continue;
      let pc = 0.04 + 0.3 * Math.max(0, p.s.pas * 0.6 + p.s.spd * 0.4 - d.s.def * 0.75);
      if (d.speed > 3) pc += 0.08;
      if (d.isUser) pc *= 0.6;
      if (this.time - (prevCross ?? -9) < 1.3) pc *= 0.35; // spamming doesn't work
      if (chance(pc)) {
        d.setAction('stumble', { dur: 0.95 });
        d.vel.multiplyScalar(0.2);
        this.onAnkles(p, d);
      }
      break;
    }
  }

  trySteal(d) {
    if (d.cd.steal > 0) return false;
    d.cd.steal = 1.0;
    d.setAction('steal', { dur: 0.28, hand: Math.random() < 0.5 ? 'r' : 'l' });
    audio.whoosh();
    const h = this.holderOf();
    if (!h || h.team === d.team) return false;
    const dx = h.pos.x - d.pos.x, dz = h.pos.z - d.pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist > 1.45) return false;
    const fwd = d.forward;
    if ((dx * fwd.x + dz * fwd.z) / (dist || 1) < 0.1) return false;
    if (h.action && (h.action.type === 'dunk' || h.action.type === 'layup' || h.action.type === 'jumper')) return false;
    let pc = 0.1 + 0.3 * d.s.def - 0.2 * h.s.pas;
    if (h.action && h.action.type === 'crossover') pc += 0.12;
    if (h.holding) pc -= 0.06;
    pc *= d.isUser ? 1 + DIFF.userLayup[this.difficulty] * 3 : this.aiStealMult();
    pc *= this.stealBias(d);
    if (chance(clamp(pc, 0.03, 0.7))) {
      const b = h.ball;
      b.release();
      b.state = 'loose';
      b.resetFlight();
      b.shot = null;
      b.reboundable = false;
      b.pos.y = 0.8;
      b.vel.set(-dx / (dist || 1) * 2.2 + rand(-1, 1), 1.5, -dz / (dist || 1) * 2.2 + rand(-1, 1));
      b.lastTouch = d;
      h.cd.pickup = 0.6;
      d.cd.pickup = 0;
      d.stats.stl++;
      audio.steal();
      this.onSteal(d, h);
      return true;
    }
    if (chance(0.22)) {
      // Over-reached: the ball handler gets a step.
      d.setAction('stumble', { dur: 0.4 });
    }
    return false;
  }

  callForBall(u, holder) {
    if (holder.isUser || holder.cd.pass > 0) return;
    this.app.hud.toast('BALL!', 'call');
    holder.calledBy = u;
    holder.callT = 0.6;
  }

  pass(from, to, opts = {}) {
    if (!from.hasBall || from.locked()) return;
    const b = from.ball;
    const start = b.pos.clone();
    const dist = Math.hypot(to.pos.x - from.pos.x, to.pos.z - from.pos.z);
    const lob = opts.lob ?? (dist > 11 || this.laneBlocked(from, to));
    const speed = lob ? 9.5 : 12.5 + from.s.pas * 3.5;
    const t = lob ? dist / 9.5 + 0.3 : clamp(dist / speed, 0.12, 1.2);
    const tgt = to.pos.clone().addScaledVector(to.vel, to.isUser ? t * 0.75 : t * 0.4);
    tgt.x = clamp(tgt.x, -14.0, 14.0);
    tgt.z = clamp(tgt.z, -7.35, 7.35);
    tgt.y = to.height * 0.62 + (opts.alley ? 1.4 : 0);
    const vel = tgt.clone().sub(start).divideScalar(t);
    vel.y += 0.5 * GRAVITY * t;
    b.launch(start, vel, 'pass', { from, to, t, lob, tgt, tried: new Set(), alley: !!opts.alley, fromOut: !inBounds(from.pos, 0.05) });
    from.setAction('pass', { dur: 0.22 });
    from.holding = false;
    from.cd.pickup = 0.35;
    from.cd.pass = 0.5;
    to.lastPassFrom = from;
    to.lastPassT = this.time;
    this.onPass(from, to);
  }

  laneBlocked(from, to) {
    const ax = from.pos.x, az = from.pos.z;
    const bx = to.pos.x - ax, bz = to.pos.z - az;
    const L2 = bx * bx + bz * bz || 1;
    for (const d of this.opponents(from)) {
      const t = clamp(((d.pos.x - ax) * bx + (d.pos.z - az) * bz) / L2, 0, 1);
      const px = ax + bx * t - d.pos.x, pz = az + bz * t - d.pos.z;
      if (t > 0.15 && t < 0.85 && Math.hypot(px, pz) < 0.9) return true;
    }
    return false;
  }

  // Player jumps to grab a rebound or tip.
  jumpFor(p) {
    if (p.airborne || p.locked() || p.cd.jump > 0) return;
    p.setAction('rebound');
    p.jump(0.95);
    p.cd.jump = 0.8;
  }

  // ------------------------------------------------------------- ball
  updateBall(b, dt) {
    if (b.state === 'held' && b.holder) {
      const p = b.holder;
      const dribbling = !p.holding && (!p.action || p.action.type === 'crossover');
      if (dribbling) {
        const prev = p.dribblePhase % 1;
        p.dribblePhase += dt * (1.75 + p.speed * 0.22) * (p.action ? 1.8 : 1);
        const now = p.dribblePhase % 1;
        if (prev < 0.5 && now >= 0.5) audio.bounce(0.28 * this.audibility(b.pos));
      }
      p.ballHoldPos(b.pos);
      b.update(dt);
      return;
    }
    b.update(dt);

    if (b.state === 'pass') {
      const info = b.pass;
      const to = info.to;
      _a.set(to.pos.x, to.y + to.height * 0.62, to.pos.z);
      const hd = Math.hypot(b.pos.x - to.pos.x, b.pos.z - to.pos.z);
      const canCatch = !to.locked() || (info.alley && to.action && to.action.type === 'rebound');
      if (canCatch && (b.pos.distanceTo(_a) < 0.8 || (hd < 0.65 && b.pos.y < to.reach + 0.15 && b.pos.y > 0.25))) {
        this.catchPass(to, b, info);
        return;
      }
      for (const d of this.opponents(info.from)) {
        if (info.tried.has(d) || d.locked()) continue;
        const dh = Math.hypot(b.pos.x - d.pos.x, b.pos.z - d.pos.z);
        if (dh < 0.62 && b.pos.y < d.reach + 0.1 && b.pos.y > 0.4) {
          info.tried.add(d);
          const mult = d.isUser ? 1.25 : this.aiStealMult();
          if (chance((0.06 + 0.2 * d.s.def) * (info.lob ? 0.4 : 1) * mult)) {
            this.pickup(d, b, 'steal');
            d.stats.stl++;
            audio.steal();
            this.onSteal(d, info.from, true);
            return;
          }
        }
      }
      if (b.flightT > info.t * 2 + 0.6 || (info.bounced && b.flightT > info.t + 0.4)) {
        b.state = 'loose';
        b.reboundable = false;
      }
      return;
    }

    if (b.state === 'shot') {
      const s = b.shot;
      if (b.scored && b.pos.y < RIM_Y - 0.6) {
        b.state = 'loose';
        b.reboundable = false;
      } else if (!b.scored && ((b.touchedRim || b.touchedBoard) && b.vel.y < 0 && b.pos.y < RIM_Y - 0.05)) {
        b.state = 'loose';
        b.reboundable = true;
        b.reboundTeam = s.team;
        this.onMiss(b, s);
      } else if (!b.scored && (b.touchedFloor || b.flightT > 3.5)) {
        b.state = 'loose';
        b.reboundable = true;
        b.reboundTeam = s.team;
        this.onMiss(b, s, true);
      }
      return;
    }

    if (b.state === 'loose') this.loosePickup(b);
  }

  loosePickup(b) {
    let best = null, bestD = Infinity;
    for (const p of this.players) {
      if (p.cd.pickup > 0 || p.hasBall || p.dummy && !p.canPickup) continue;
      if (p.action && (p.action.type === 'stumble' || p.action.type === 'dunk' || p.action.type === 'jumper' || p.action.type === 'layup')) continue;
      if (!this.canPickup(p, b)) continue;
      const hd = Math.hypot(b.pos.x - p.pos.x, b.pos.z - p.pos.z);
      if (hd > 0.72) continue;
      if (b.pos.y > p.reach + 0.18) continue;
      if (hd < bestD) { bestD = hd; best = p; }
    }
    if (best) this.pickup(best, b, b.reboundable ? 'rebound' : 'loose');
  }

  catchPass(p, b, info) {
    b.give(p);
    p.holding = false;
    p.dribblePhase = 0;
    if (!p.action) p.setAction('catch', { dur: 0.12 });
    audio.catchBall();
    if (info.alley && p.airborne) {
      // Alley-oop: finish the dunk in the air.
      const side = this.attackSide(p.team);
      if (distToHoop2D(p.pos, side) < 2.4) {
        const dir = new THREE.Vector3(side * HOOP_X - p.pos.x, 0, -p.pos.z).normalize();
        p.action = null;
        p.setAction('dunk', {
          side, start: p.pos.clone(), end: new THREE.Vector3(side * HOOP_X, 0, 0).addScaledVector(dir, -0.42),
          dir, dur: 0.2, y0: p.y, yHang: Math.max(p.y, RIM_Y + 0.3 - p.height * 1.3), slammed: false, hanging: false, hangT: 0, style: 'two', alley: true,
        });
        p.airborne = false;
        p.holding = true;
      }
    }
    this.onCatch(p, info.from);
  }

  pickup(p, b, how) {
    const wasReb = b.reboundable;
    const rebTeam = b.reboundTeam;
    b.give(p);
    b.reboundable = false;
    p.holding = false;
    p.dribblePhase = 0;
    if (p.action && (p.action.type === 'block' || p.action.type === 'rebound')) {
      // keep the jump animation
    }
    audio.catchBall();
    if (how === 'rebound' && wasReb) {
      p.stats.reb++;
      this.onRebound(p, p.team === rebTeam);
    }
    this.onPickup(p, b, how);
  }

  handleScore(b, side) {
    const shot = b.state === 'shot' ? b.shot : null;
    const clean = !b.touchedRim && !b.touchedBoard;
    audio.swish();
    this.app.arena.swishNet(side, clean ? 1.2 : 0.8, b.vel.x, b.vel.z);
    let team, pts;
    if (shot && shot.side === side) {
      team = shot.team;
      pts = shot.points;
    } else {
      team = this.teamAttacking(side);
      pts = 2;
    }
    this.onScore(b, side, team, pts, shot, clean);
  }

  checkBlocks() {
    for (const b of this.balls) {
      let shooter = null;
      if (b.state === 'shot' && b.shot && b.shot.kind !== 'dunk' && !b.touchedRim && !b.touchedBoard && b.flightT < 0.55 && b.vel.y > -1.5) {
        shooter = b.shot.shooter;
      } else if (b.state === 'held' && b.holder && b.holder.action) {
        const t = b.holder.action.type;
        if ((t === 'jumper' || t === 'layup') && !b.holder.action.released && b.holder.action.t > 0.08) shooter = b.holder;
        if (t === 'dunk' && !b.holder.action.slammed) shooter = b.holder;
      }
      if (!shooter) continue;
      b.blockTried ||= new Set();
      for (const d of this.opponents(shooter)) {
        if (!d.airborne) continue;
        const fwd = d.forward;
        _a.set(d.pos.x + fwd.x * 0.15, d.reach - 0.05, d.pos.z + fwd.z * 0.15);
        const R = 0.22 + 0.16 * d.s.def + (d.isUser ? 0.12 : 0) + Math.max(0, d.height - 2) * 0.3;
        if (_a.distanceTo(b.pos) > R) continue;
        if (b.state === 'held' && shooter.action.type === 'dunk') {
          if (b.blockTried.has(d)) continue;
          b.blockTried.add(d);
          if (!chance(0.2 + 0.4 * d.s.def - 0.3 * shooter.s.dnk + (d.isUser ? 0.15 : 0))) continue;
        }
        this.doBlock(d, b, shooter);
        break;
      }
    }
  }

  doBlock(d, b, shooter) {
    if (b.state === 'held') {
      if (shooter.action) {
        shooter.action.released = true;
        shooter.action.releaseT = shooter.action.t;
      }
      this.endMeter(shooter, 'BLOCKED');
      shooter.holding = false;
      b.release();
    }
    const away = new THREE.Vector3(b.pos.x - d.pos.x, 0, b.pos.z - d.pos.z);
    if (away.lengthSq() < 0.01) away.set(-this.attackSide(shooter.team), 0, 0);
    away.normalize();
    b.state = 'loose';
    b.shot = null;
    b.reboundable = false;
    b.resetFlight();
    b.vel.set(away.x * rand(3, 6) + rand(-1, 1), rand(0.5, 2.5), away.z * rand(3, 6) + rand(-1, 1));
    b.lastTouch = d;
    d.stats.blk++;
    shooter.cd.pickup = 0.6;
    audio.board(0.8);
    this.app.rig.shake(0.2);
    this.onBlock(d, shooter);
  }

  separatePlayers() {
    const ps = this.players;
    for (let i = 0; i < ps.length; i++) {
      for (let j = i + 1; j < ps.length; j++) {
        const a = ps[i], c = ps[j];
        if ((a.action && a.action.type === 'dunk') || (c.action && c.action.type === 'dunk')) continue;
        if (a.ghost || c.ghost) continue;
        const dx = c.pos.x - a.pos.x, dz = c.pos.z - a.pos.z;
        const d = Math.hypot(dx, dz);
        const minD = 0.6;
        if (d < minD && d > 1e-4) {
          const push = (minD - d) / 2;
          const ux = dx / d, uz = dz / d;
          a.pos.x -= ux * push; a.pos.z -= uz * push;
          c.pos.x += ux * push; c.pos.z += uz * push;
          // Ball handler driving into a defender gets slowed.
          for (const [h, o] of [[a, c], [c, a]]) {
            if (h.hasBall && o.team !== h.team && o.stance) h.vel.multiplyScalar(0.8);
          }
        }
      }
    }
  }

  endMeter(p, label) {
    if (!p.isUser || !this.meter || this.meter.done) return;
    this.meter.done = true;
    this.meter.grade = 'bad';
    this.meter.label = label;
    this.meter.fade = 1;
    this.app.hud.shotFeedback(label, 'bad');
  }

  updateMeter() {
    const m = this.meter;
    if (!m) return;
    if (m.done) {
      m.fade -= 1 / 60;
      if (m.fade <= 0) this.meter = null;
    }
  }

  fireTrail(dt) {
    if (this.onFire < 3) return;
    this.fireTrailT += dt;
    if (this.fireTrailT < 0.03) return;
    this.fireTrailT = 0;
    for (const b of this.balls) {
      if (b.state === 'shot' && b.shot && b.shot.shooter && b.shot.shooter.isUser) {
        this.app.particles.emit(b.pos, 3, { colors: [0xff5a00, 0xffb300, 0xff2a00], speed: 0.4, up: 0.6, gravity: -1.5, life: 0.45, size: 0.32 });
      }
    }
  }

  // Used by AI/teammates to compute shot difficulty multipliers.
  aiSigma(p) {
    const base = DIFF.aiSigma[this.difficulty];
    return p.team === (this.user ? this.user.team : -1) ? 1.25 : base;
  }
  aiStealMult() {
    return DIFF.aiSteal[this.difficulty];
  }

  // ------------------------------------------------------------ hooks
  attackSide(team) {
    return team === 0 ? 1 : -1;
  }
  teamAttacking(side) {
    return side === this.attackSide(0) ? 0 : 1;
  }
  isDefending(p) {
    const h = this.holderOf();
    if (h) return h.team !== p.team;
    return false;
  }
  userLookTarget(u) {
    if (u.hasBall) return hoopPos(this.attackSide(u.team), new THREE.Vector3());
    const h = this.holderOf();
    return h ? h.pos : this.balls[0] ? this.balls[0].pos : null;
  }
  clampPlayer() {
    return true;
  }
  canPickup() {
    return true;
  }
  stealBias() {
    return 1;
  }
  guardSpot() {
    return null;
  }
  aiUpdate() {}
  modeUpdate() {}
  onScore() {}
  onShotRelease() {}
  onMiss() {}
  onDunk() {}
  onBlock() {}
  onSteal() {}
  onAnkles() {}
  onPass() {}
  onCatch() {}
  onRebound() {}
  onPickup() {}
}
