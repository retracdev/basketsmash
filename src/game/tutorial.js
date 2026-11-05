import * as THREE from 'three';
import { FeedWorld } from './arcade.js';
import { Player } from '../entities/player.js';
import { HOOP_X } from '../core/constants.js';
import { audio } from '../core/audio.js';
import { input } from '../core/input.js';

const ACADEMY = { id: 'bsa', city: 'Basketsmash', name: 'Academy', abbr: 'BSA', primary: 0xff7a1a, secondary: 0x141414, accent: 0xffffff };
const DUMMIES = { id: 'dmy', city: 'Practice', name: 'Squad', abbr: 'PRC', primary: 0x6b7280, secondary: 0xe5e7eb, accent: 0x111827 };
const YOU = { name: 'Rookie You', num: 1, pos: 'SF', h: 198, spd: 86, sht: 84, thr: 82, dnk: 92, pas: 84, def: 86, skin: 2, hair: 'short', hairColor: 0 };
const MATE = { name: 'Coach Mika', num: 12, pos: 'PG', h: 188, spd: 80, sht: 80, thr: 80, dnk: 60, pas: 90, def: 70, skin: 4, hair: 'buzz', hairColor: 0 };
const DUMMY = { name: 'Practice Pat', num: 0, pos: 'SG', h: 193, spd: 60, sht: 70, thr: 60, dnk: 60, pas: 40, def: 40, skin: 1, hair: 'short', hairColor: 2 };

const k = (key) => `<kbd>${key}</kbd>`;

const STEPS = [
  {
    id: 'move', title: 'MOVE',
    text: `Use ${k('W')}${k('A')}${k('S')}${k('D')} to move. Auto Camera follows the action by default (toggle it in Settings). You can also click to look with the mouse or turn with ${k('&larr;')}${k('&rarr;')}. Press ${k('C')} to cycle first person, third person, and court views. Walk into the glowing ring.`,
    setup: (w) => w.setTarget(HOOP_X - 6, 3),
    check: (w) => w.atTarget(),
  },
  {
    id: 'sprint', title: 'SPRINT',
    text: `Hold ${k('SHIFT')} while moving to sprint. Sprint into the ring. Sprinting drains the stamina bar.`,
    setup: (w) => w.setTarget(HOOP_X - 11, -5),
    check: (w) => w.atTarget() && w.flags.sprinted,
  },
  {
    id: 'cross', title: 'CROSSOVER',
    text: `Press ${k('Q')} while dribbling to cross over. It gives a burst of speed and can break a defender's ankles. Do 2 crossovers.`,
    setup: (w) => { w.feedBall({ direct: true }); w.feeding = true; },
    check: (w) => w.flags.crosses >= 2,
  },
  {
    id: 'shoot', title: 'JUMP SHOT',
    text: `Hold ${k('SPACE')} to rise up. The shot meter fills - let go at the top, inside the <b class="g">GREEN</b> zone. Make a jump shot.`,
    setup: (w) => { w.feeding = true; },
    check: (w) => w.flags.made.jumper > 0,
  },
  {
    id: 'perfect', title: 'PERFECT RELEASE',
    text: `Letting go inside the <b class="g">GREEN</b> zone is a PERFECT release and it nearly always drops. Defenders close to you shrink the green zone. Get one perfect release.`,
    setup: (w) => { w.feeding = true; },
    check: (w) => w.flags.perfects > 0,
  },
  {
    id: 'three', title: 'THREE POINTER',
    text: `Shots from behind the arc are worth <b>3</b>. Step behind the three-point line and drain one.`,
    setup: (w) => { w.feeding = true; },
    check: (w) => w.flags.made.three > 0,
  },
  {
    id: 'layup', title: 'LAYUP',
    text: `Drive toward the rim and press ${k('SPACE')} when you're close to lay it in.`,
    setup: (w) => { w.feeding = true; },
    check: (w) => w.flags.made.layup > 0,
  },
  {
    id: 'dunk', title: 'DUNK',
    text: `Hold ${k('SHIFT')} to sprint at the rim and press ${k('SPACE')} to throw it down! Players with a high DNK rating can dunk from further out.`,
    setup: (w) => { w.feeding = true; },
    check: (w) => w.flags.made.dunk > 0,
  },
  {
    id: 'pass', title: 'PASSING',
    text: `Look toward a teammate and press ${k('E')} (or right click) to pass. Pass to Coach Mika twice. In games, press ${k('E')} without the ball to call for it, and teammates will feed you when you're open.`,
    setup: (w) => { w.spawnMate(); w.feedBall({ direct: true }); w.feeding = true; },
    check: (w) => w.flags.passes >= 2,
  },
  {
    id: 'steal', title: 'STEALS',
    text: `On defense, get close to the ball handler and press ${k('E')} to swipe at the ball. Press ${k('E')} near a pass to jump the passing lane. Steal it!`,
    setup: (w) => w.spawnDummy('dribble'),
    check: (w) => w.flags.stolen,
  },
  {
    id: 'block', title: 'BLOCKS',
    text: `Stand between the shooter and the rim. When he rises up, press ${k('SPACE')} to jump and block it. Tip: hold ${k('Q')} on defense to auto-guard your man.`,
    setup: (w) => w.spawnDummy('shoot'),
    check: (w) => w.flags.blocked || w.flags.dummyShots >= 5,
  },
  {
    id: 'done', title: "YOU'RE READY!",
    text: `In a game you control one player and your AI teammates do the rest. Sprint to the rim and press ${k('E')} to call for an <b>ALLEY-OOP</b>. Make 3 in a row to catch <b class="f">FIRE</b>.<br><br>Press ${k('ENTER')} to finish.`,
    setup: () => {},
    check: () => false,
    final: true,
  },
];

export class Tutorial extends FeedWorld {
  constructor(app) {
    super(app, { difficulty: 0 });
    const u = this.addPlayer(new Player(YOU, ACADEMY, 0, { isUser: true }));
    u.setUserHighlight(0x3cf0ff);
    u.placeAt(HOOP_X - 9, 0, new THREE.Vector3(HOOP_X, 0, 0));
    this.ringMark = this.marker(0x3cf0ff, 2.2);
    this.ringMark.visible = false;
    this.index = -1;
    this.doneT = -1;
    this.feeding = false;
    this.onFinished = null;
    this.courtView = 'arcade';
    this.next();
  }

  // ------------------------------------------------------------- steps
  resetFlags() {
    this.flags = { sprinted: false, crosses: 0, made: { jumper: 0, three: 0, layup: 0, dunk: 0 }, perfects: 0, passes: 0, stolen: false, blocked: false, dummyShots: 0 };
  }

  clearExtras() {
    for (const p of this.players.slice()) {
      if (p === this.user) continue;
      this.root.remove(p.object);
      p.dispose();
    }
    this.players = [this.user];
    for (const b of this.balls.slice()) this.removeBall(b);
    this.mate = null;
    this.dummy = null;
    this.ringMark.visible = false;
    this.feeding = false;
    this.user.action = null;
    this.user.holding = false;
  }

  next() {
    this.index++;
    this.clearExtras();
    this.resetFlags();
    this.doneT = -1;
    const s = STEPS[this.index];
    if (!s) return;
    s.setup(this);
    this.app.hud.setTutorial({ index: this.index, total: STEPS.length, title: s.title, text: s.text, final: !!s.final });
    audio.ui('select');
  }

  skip() {
    if (STEPS[this.index] && !STEPS[this.index].final) this.next();
  }

  setTarget(x, z) {
    this.target = new THREE.Vector3(x, 0, z);
    this.ringMark.position.set(x, 0.02, z);
    this.ringMark.visible = true;
  }

  atTarget() {
    return this.target && Math.hypot(this.user.pos.x - this.target.x, this.user.pos.z - this.target.z) < 1.0;
  }

  spawnMate() {
    const m = this.addPlayer(new Player(MATE, ACADEMY, 0));
    m.placeAt(HOOP_X - 6, -4.5, this.user.pos);
    this.mate = m;
  }

  spawnDummy(kind) {
    const d = this.addPlayer(new Player(DUMMY, DUMMIES, 1));
    d.dummy = true;
    d.canPickup = true;
    d.placeAt(HOOP_X - 7.5, 2.5, new THREE.Vector3(HOOP_X, 0, 0));
    this.dummy = d;
    this.dummyKind = kind;
    this.dummyT = 1.5;
    const b = this.addBall();
    b.give(d);
    d.holding = kind === 'shoot';
    if (kind === 'shoot') this.setTarget(HOOP_X - 6.3, 1.9);
    this.user.placeAt(HOOP_X - 4.5, 0, d.pos);
  }

  // ------------------------------------------------------------- update
  update(dt) {
    if (input.pressed('skip')) this.skip();
    const step = STEPS[this.index];
    if (step && step.final && input.pressed('confirm')) {
      if (this.onFinished) {
        const cb = this.onFinished;
        this.onFinished = null;
        cb();
      }
      return;
    }
    if (this.user.intent.sprint && this.user.speed > 5.2) this.flags.sprinted = true;
    super.update(dt);
    this.updateHelpers(dt);

    if (step && !step.final) {
      if (this.doneT < 0 && step.check(this)) {
        this.doneT = 0;
        this.app.hud.popup('NICE!', 'good');
        audio.perfect();
        audio.cheer(0.6, 1.2);
      }
      if (this.doneT >= 0) {
        this.doneT += dt;
        if (this.doneT > 1.3) this.next();
      }
    }
    this.app.hud.setHints([['TAB', 'Skip step'], ['ESC', 'Pause / Quit']]);
    this.app.hud.setStamina(this.user.stamina);
  }

  updateHelpers(dt) {
    const m = this.mate;
    if (m) {
      m.lookTarget = this.user.pos;
      m.intent.x = m.intent.z = 0;
      if (m.hasBall) {
        m.holdT = (m.holdT || 0) + dt;
        m.holding = true;
        if (m.holdT > 0.8) {
          m.holdT = 0;
          this.pass(m, this.user);
        }
      }
    }
    const d = this.dummy;
    if (d) {
      d.lookTarget = this.dummyKind === 'shoot' ? new THREE.Vector3(HOOP_X, 0, 0) : this.user.pos;
      if (this.dummyKind === 'dribble') {
        d.intent.x = 0;
        d.intent.z = Math.sin(this.time * 1.3) * 0.35;
      } else {
        d.intent.x = d.intent.z = 0;
        if (!d.action && !d.hasBall && !this.balls.some((b) => b.state === 'shot')) {
          // re-rack the dummy
          for (const b of this.balls.slice()) this.removeBall(b);
          d.placeAt(HOOP_X - 7.5, 2.5, new THREE.Vector3(HOOP_X, 0, 0));
          const b = this.addBall();
          b.give(d);
          d.holding = true;
          this.dummyT = 1.6;
        }
        if (d.hasBall && !d.action) {
          this.dummyT -= dt;
          if (this.dummyT <= 0) {
            this.flags.dummyShots++;
            this.beginShot(d, 'jumper');
          }
        }
      }
    }
  }

  canFeed() {
    if (this.dummy) return false;
    if (this.mate && this.mate.hasBall) return false;
    if (this.balls.some((b) => b.state === 'pass')) return false;
    return true;
  }

  aiSigma() {
    return 0.6;
  }

  // Only the steal drill lets you grab the ball off someone else.
  canPickup(p) {
    return p.isUser && this.dummyKind === 'dribble' && !!this.dummy;
  }

  stealBias(d) {
    return d.isUser ? 2.6 : 1;
  }

  // ------------------------------------------------------------- hooks
  crossover(p) {
    const before = p.action;
    super.crossover(p);
    if (p.isUser && p.action && p.action !== before && p.action.type === 'crossover') this.flags.crosses++;
  }

  onShotRelease(p, info, res) {
    if (!p.isUser) return;
    if (res && res.label) this.app.hud.shotFeedback(res.label, res.grade);
    if (res && res.perfect && info.kind === 'jumper') this.flags.perfects++;
  }

  onScore(b, side, team, pts, shot) {
    if (!shot || !shot.shooter.isUser) return;
    if (shot.kind === 'jumper') this.flags.made.jumper++;
    if (shot.points === 3) this.flags.made.three++;
    if (shot.kind === 'layup') this.flags.made.layup++;
    if (shot.kind === 'dunk') this.flags.made.dunk++;
    this.app.hud.popup(pts === 3 ? '+3' : '+2', 'good');
  }

  onPass(from, to) {
    if (from.isUser && to === this.mate) this.flags.passes++;
  }

  onSteal(d) {
    if (d.isUser) this.flags.stolen = true;
    this.app.hud.popup('STOLEN!', 'good');
  }

  onBlock(d) {
    if (d.isUser) {
      this.flags.blocked = true;
      this.app.hud.popup('REJECTED!', 'good');
    }
  }

  onDunk() {
    this.app.hud.popup('SLAM!', 'good');
    audio.cheer(1, 2);
    this.app.arena.cheer(0.8);
  }

  cameraContext() {
    const u = this.user;
    let lookAt = new THREE.Vector3(HOOP_X, 2.8, 0);
    if (this.ringMark.visible && this.target && !this.dummy) lookAt = this.target.clone().setY(0.5);
    else if (this.dummy) lookAt = this.dummy.pos.clone().setY(1.4);
    else if (this.mate && u.hasBall) lookAt = this.mate.pos.clone().setY(1.4);
    const incoming = this.balls.find((b) => b.state === 'pass' && b.pass && b.pass.to === u);
    if (incoming) lookAt = incoming.pos.clone();
    return { user: u, side: 1, offense: true, focus: u.pos, lookAt, steerRate: 2.4 };
  }

}
