import * as THREE from 'three';
import { PlayWorld } from './world.js';
import { Player } from '../entities/player.js';
import { HOOP_X, GRAVITY } from '../core/constants.js';
import { clamp, rand, pick, chance } from '../core/utils.js';
import { audio } from '../core/audio.js';
import { input } from '../core/input.js';
import { ringTexture } from '../world/textures.js';

// Base for single-shooter modes: a ball machine under the hoop feeds the user.
export class FeedWorld extends PlayWorld {
  constructor(app, opts) {
    super(app, opts);
    this.feedDelay = 0.9;
    this.feedT = 0;
    this.feeding = true;
    this.stationary = false;
    this.ringTex = ringTexture();
  }

  attackSide() {
    return 1;
  }
  canPickup() {
    return false;
  }
  isDefending(p) {
    const h = this.holderOf();
    return !!h && h.team !== p.team;
  }

  // Ball comes into the user's hands (from the rack) or via a pass from the machine.
  feedBall({ money = false, direct = false } = {}) {
    const u = this.user;
    const b = this.addBall({ money });
    b.spawnT = this.time;
    if (direct || this.stationary) {
      b.give(u);
      u.holding = this.stationary;
      u.ballHoldPos(b.pos);
      audio.catchBall();
      return b;
    }
    const from = new THREE.Vector3(HOOP_X - 1.2, 1.0, 0);
    const t = clamp(from.distanceTo(u.pos) / 11, 0.25, 1.1);
    const tgt = u.pos.clone().addScaledVector(u.vel, t * 0.8);
    tgt.y = u.height * 0.62;
    const vel = tgt.clone().sub(from).divideScalar(t);
    vel.y += 0.5 * GRAVITY * t;
    const machine = { team: u.team, pos: from, isMachine: true };
    b.launch(from, vel, 'pass', { from: machine, to: u, t, tried: new Set() });
    return b;
  }

  userHasBall() {
    return this.balls.some((b) => b.holder === this.user || (b.state === 'pass' && b.pass && b.pass.to === this.user));
  }

  modeUpdate(dt) {
    // Clean up old balls.
    for (const b of this.balls.slice()) {
      if (b.holder || b.state === 'pass') continue;
      const age = this.time - (b.releasedT ?? b.spawnT ?? 0);
      if (age > 4.5 || (b.restTime > 1.2 && age > 1.5)) this.removeBall(b);
    }
    if (this.feeding && !this.userHasBall() && this.user && !this.user.locked()) {
      this.feedT -= dt;
      if (this.feedT <= 0 && this.canFeed()) {
        this.feedT = this.feedDelay;
        this.feedBall(this.nextFeedOpts());
      }
    } else {
      this.feedT = Math.min(this.feedT, this.feedDelay);
    }
  }

  canFeed() {
    return true;
  }
  nextFeedOpts() {
    return {};
  }

  afterRelease(p, info) {
    super.afterRelease(p, info);
    const b = this.balls.find((x) => x.shot === info);
    if (b) b.releasedT = this.time;
    this.feedT = this.feedDelay;
  }

  marker(color = 0xffffff, size = 1.4) {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(size, size).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: this.ringTex, color, transparent: true, depthWrite: false }),
    );
    m.position.y = 0.02;
    this.root.add(m);
    return m;
  }
}

const MODES = {
  shootout: { title: '3-POINT SHOOTOUT', time: 60 },
  world: { title: 'AROUND THE WORLD', time: 75 },
  hotspots: { title: 'HOT SPOTS', time: 60 },
  practice: { title: 'SHOOTAROUND', time: Infinity },
};

const SHOOTOUT_STATIONS = [
  [0.75, -7.1], [5.6, -5.4], [7.95, 0], [5.6, 5.4], [0.75, 7.1],
];

export class Arcade extends FeedWorld {
  constructor(app, cfg) {
    super(app, { difficulty: cfg.difficulty });
    this.mode = cfg.mode;
    this.def = MODES[cfg.mode];
    const u = this.addPlayer(new Player(cfg.player, cfg.team, 0, { isUser: true }));
    u.setUserHighlight(0x3cf0ff);
    this.score = 0;
    this.timeLeft = this.def.time;
    this.made = 0;
    this.att = 0;
    this.streak = 0;
    this.ended = false;
    this.started = false;
    this.countdown = 3;
    this.onFinished = null;

    if (this.mode === 'shootout') {
      this.stationary = true;
      this.station = 0;
      this.rackLeft = 5;
      this.feedDelay = 0.3;
      this.rackMeshes = [];
      this.stationMarks = SHOOTOUT_STATIONS.map(([uu, z]) => {
        const m = this.marker(0xff7a1a, 1.2);
        m.position.set(HOOP_X - uu, 0.02, z);
        return m;
      });
      this.placeStation(true);
    } else if (this.mode === 'world') {
      this.stationary = true;
      this.feedDelay = 0.55;
      this.spots = [];
      for (const r of [4.0, 7.75]) {
        for (let i = 0; i < 7; i++) {
          const a = -1.25 + (i / 6) * 2.5;
          this.spots.push([HOOP_X - Math.cos(a) * r, clamp(Math.sin(a) * r, -7.1, 7.1)]);
        }
      }
      this.spot = 0;
      this.spotMark = this.marker(0x3cf0ff, 1.5);
      this.placeSpot(true);
    } else if (this.mode === 'hotspots') {
      this.zones = [0, 1, 2].map(() => ({ mesh: this.marker(0xff3b00, 2.6), pos: new THREE.Vector3() }));
      this.zones.forEach((z) => this.moveZone(z));
      u.placeAt(HOOP_X - 6.5, 0, new THREE.Vector3(HOOP_X, 0, 0));
    } else {
      u.placeAt(HOOP_X - 5.5, 1, new THREE.Vector3(HOOP_X, 0, 0));
    }
    this.feeding = false;
    this.courtView = 'arcade';
    this.app.hud.popup(this.def.title, 'big');
  }

  // ------------------------------------------------------- stations
  placeStation(snap) {
    const [uu, z] = SHOOTOUT_STATIONS[this.station];
    const x = HOOP_X - uu;
    const u = this.user;
    if (snap) u.placeAt(x, z, new THREE.Vector3(HOOP_X, 0, 0));
    this.moveTarget = snap ? null : new THREE.Vector3(x, 0, z);
    this.stationMarks.forEach((m, i) => {
      m.material.color.setHex(i === this.station ? 0xffd60a : i < this.station ? 0x444444 : 0xff7a1a);
    });
    this.rackLeft = 5;
  }

  placeSpot(snap) {
    const [x, z] = this.spots[this.spot];
    const u = this.user;
    this.spotMark.position.set(x, 0.02, z);
    if (snap) u.placeAt(x, z, new THREE.Vector3(HOOP_X, 0, 0));
    else this.moveTarget = new THREE.Vector3(x, 0, z);
  }

  moveZone(z) {
    for (let tries = 0; tries < 20; tries++) {
      const three = Math.random() < 0.5;
      const r = three ? rand(7.6, 8.4) : rand(2.5, 6.2);
      const a = rand(-1.35, 1.35);
      const x = HOOP_X - Math.cos(a) * r, zz = clamp(Math.sin(a) * r, -7.0, 7.0);
      const ok = this.zones.every((o) => o === z || o.pos.distanceTo(new THREE.Vector3(x, 0, zz)) > 3);
      if (ok || tries === 19) {
        z.pos.set(x, 0, zz);
        z.mesh.position.set(x, 0.02, zz);
        return;
      }
    }
  }

  inZone(p) {
    return this.zones ? this.zones.find((z) => Math.hypot(z.pos.x - p.pos.x, z.pos.z - p.pos.z) < 1.25) : null;
  }

  // ------------------------------------------------------- control
  userControl(dt) {
    if (this.ended) return;
    if (this.stationary) {
      const u = this.user;
      this.povLook(dt);
      u.faceYaw = null;
      if (this.moveTarget) return;
      u.intent.x = u.intent.z = 0;
      u.intent.sprint = false;
      u.lookTarget = new THREE.Vector3(HOOP_X, 0, 0);
      if (u.hasBall && input.pressed('shoot')) this.beginShot(u, 'jumper');
      if (u.action && u.action.type === 'jumper' && !u.action.released && !input.held('shoot')) this.releaseJumper(u);
      return;
    }
    super.userControl(dt);
  }

  canFeed() {
    if (!this.started || this.ended) return false;
    if (this.mode === 'shootout') return this.rackLeft > 0 && !this.moveTarget;
    if (this.mode === 'world') return !this.moveTarget;
    return true;
  }

  nextFeedOpts() {
    if (this.mode === 'shootout') {
      this.rackLeft--;
      return { money: this.rackLeft === 0 };
    }
    return {};
  }

  update(dt) {
    if (!this.started) {
      const prev = Math.ceil(this.countdown);
      this.countdown -= dt;
      const now = Math.ceil(this.countdown);
      if (now !== prev && now > 0) {
        this.app.hud.popup(String(now), 'count');
        audio.ui('tick');
      }
      if (this.countdown <= 0) {
        this.started = true;
        this.feeding = true;
        this.feedT = 0;
        this.app.hud.popup('GO!', 'count');
        audio.horn();
      }
    } else if (!this.ended && this.timeLeft !== Infinity) {
      this.timeLeft -= dt;
      if (this.timeLeft <= 5 && Math.ceil(this.timeLeft) !== Math.ceil(this.timeLeft + dt)) audio.ui('tick');
      if (this.timeLeft <= 0) {
        this.timeLeft = 0;
        this.end();
      }
    }

    // Auto-run between stations.
    if (this.moveTarget) {
      const u = this.user;
      const dx = this.moveTarget.x - u.pos.x, dz = this.moveTarget.z - u.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.2) {
        u.placeAt(this.moveTarget.x, this.moveTarget.z, new THREE.Vector3(HOOP_X, 0, 0));
        this.moveTarget = null;
        this.feedT = 0.1;
      } else {
        u.intent.x = dx / d;
        u.intent.z = dz / d;
        u.intent.sprint = true;
      }
    }

    super.update(dt);

    // Shootout: rack finished -> next station once the last ball is away.
    if (this.mode === 'shootout' && !this.ended && this.rackLeft === 0 && !this.userHasBall() && !this.user.locked() && !this.moveTarget) {
      if (this.station < 4) {
        this.station++;
        this.placeStation(false);
      } else if (!this.endPending) {
        this.endPending = this.time;
      }
    }
    if (this.endPending && this.time - this.endPending > 2.2 && !this.ended) this.end();

    this.updateHud();
    if (this.ended) {
      this.endT += dt;
      if (this.endT > 2.8 && this.onFinished) {
        const cb = this.onFinished;
        this.onFinished = null;
        cb(this.results());
      }
    }
  }

  end() {
    if (this.ended) return;
    this.ended = true;
    this.endT = 0;
    this.feeding = false;
    audio.buzzer();
    this.app.hud.popup(this.mode === 'world' && this.spot >= this.spots.length ? 'COMPLETE!' : 'TIME!', 'big');
  }

  results() {
    let score = this.score;
    let bonus = 0;
    if (this.mode === 'world' && this.spot >= this.spots.length) {
      bonus = Math.ceil(this.timeLeft);
      score += bonus;
    }
    return { mode: this.mode, title: this.def.title, score, bonus, made: this.made, att: this.att };
  }

  // ------------------------------------------------------- scoring
  onShotRelease(p, info, res) {
    this.att++;
    if (res && res.label) this.app.hud.shotFeedback(res.label, res.grade);
    if (this.mode === 'hotspots') {
      info.zone = this.inZone(p);
    }
  }

  onScore(b, side, team, pts, shot, clean) {
    if (!shot || this.ended && this.mode !== 'shootout') return;
    this.made++;
    this.streak++;
    this.onFire = this.streak;
    let gained = 0;
    let label = clean ? 'SWISH!' : 'GOOD!';
    switch (this.mode) {
      case 'shootout':
        gained = b.money ? 2 : 1;
        label = b.money ? 'MONEY BALL! +2' : clean ? 'SWISH! +1' : '+1';
        break;
      case 'world':
        gained = 1;
        label = 'NEXT SPOT!';
        this.spot++;
        if (this.spot >= this.spots.length) {
          label = 'AROUND THE WORLD!';
          this.end();
        } else {
          if (this.spot === 7) this.app.hud.toast('ROUND 2: FROM DOWNTOWN');
          this.placeSpot(false);
        }
        break;
      case 'hotspots': {
        gained = shot.points;
        let mult = 1;
        if (shot.zone) {
          mult *= 2;
          this.moveZone(shot.zone);
          label = 'HOT SPOT x2!';
          this.app.particles.emit(new THREE.Vector3(shot.from.x, 0.2, shot.from.z), 30, { colors: [0xff5a00, 0xffc400], speed: 2, up: 4, life: 0.8, size: 0.2 });
        }
        if (this.streak >= 3) {
          mult *= 1.5;
          if (this.streak === 3) this.app.hud.popup("ON FIRE!", 'fire');
        }
        gained = Math.round(gained * mult);
        label = `${label === 'HOT SPOT x2!' ? label + ' ' : ''}+${gained}`;
        break;
      }
      default:
        gained = shot.points;
        label = clean ? 'SWISH!' : 'GOOD!';
    }
    this.score += gained;
    this.app.hud.popup(label, 'good');
    audio.cheer(this.streak >= 3 ? 1 : 0.6, 1.4);
    this.app.arena.cheer(this.streak >= 3 ? 0.7 : 0.3);
    if (shot.perfect && shot.kind === 'jumper' && chance(0.5)) audio.commentary(pick(['Splash!', 'Wet!', 'Cash!']));
  }

  onMiss(b, shot) {
    this.streak = 0;
    this.onFire = 0;
    if (this.mode === 'world') this.app.hud.toast('TRY AGAIN');
  }

  onDunk() {
    audio.cheer(1, 2);
    this.app.arena.cheer(0.8);
  }

  updateHud() {
    const hud = this.app.hud;
    let info = '';
    if (this.mode === 'shootout') info = `RACK ${this.station + 1}/5 · BALLS ${this.rackLeft}`;
    else if (this.mode === 'world') info = `SPOT ${Math.min(this.spot + 1, 14)}/14`;
    else if (this.mode === 'hotspots') info = this.streak >= 3 ? 'ON FIRE x1.5' : `STREAK ${this.streak}`;
    else info = `FG ${this.made}/${this.att} · ${this.att ? Math.round((this.made / this.att) * 100) : 0}%`;
    hud.setArcade({
      title: this.def.title,
      score: this.mode === 'practice' ? this.made : this.score,
      time: this.timeLeft === Infinity ? '∞' : this.timeLeft.toFixed(1),
      info,
    });
    hud.setHints(this.stationary
      ? [['SPACE', 'Hold & release to shoot']]
      : [['SPACE', 'Shoot'], ['SHIFT', 'Sprint'], ['Q', 'Crossover'], ['WASD', 'Move']]);
    hud.setStamina(this.user.stamina);
    if (this.zones) {
      const t = this.time;
      this.zones.forEach((z, i) => z.mesh.scale.setScalar(1 + Math.sin(t * 4 + i) * 0.06));
    }
  }

  cameraContext() {
    const incoming = this.balls.find((b) => b.state === 'pass' && b.pass && b.pass.to === this.user);
    const lookAt = incoming ? incoming.pos.clone() : new THREE.Vector3(HOOP_X, 2.8, 0);
    return { user: this.user, side: 1, offense: true, focus: this.user.pos, lookAt, steerRate: this.stationary ? 4 : 2.4 };
  }

}
