import * as THREE from 'three';
import { PLAYER_GRAVITY, COURT, BALL_R } from '../core/constants.js';
import { clamp, skill, angleLerp, smooth } from '../core/utils.js';
import { jerseyTextures, radialTexture, ringTexture } from '../world/textures.js';
import { SKIN_TONES, HAIR_COLORS } from '../data/teams.js';

// ------------------------------------------------------- shared geometry
let G = null;
function geoms() {
  if (G) return G;
  G = {
    torso: new THREE.BoxGeometry(0.46, 0.6, 0.26),
    shorts: new THREE.BoxGeometry(0.47, 0.3, 0.29),
    head: new THREE.SphereGeometry(0.125, 14, 10),
    hair: new THREE.SphereGeometry(0.133, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.5),
    afro: new THREE.SphereGeometry(0.17, 12, 8),
    band: new THREE.CylinderGeometry(0.132, 0.132, 0.04, 14, 1, true),
    neck: new THREE.CylinderGeometry(0.06, 0.07, 0.1, 8),
    upperArm: new THREE.CapsuleGeometry(0.055, 0.2, 3, 8).translate(0, -0.14, 0),
    foreArm: new THREE.CapsuleGeometry(0.048, 0.19, 3, 8).translate(0, -0.13, 0),
    hand: new THREE.SphereGeometry(0.055, 8, 6),
    thigh: new THREE.CapsuleGeometry(0.085, 0.28, 3, 8).translate(0, -0.21, 0),
    shin: new THREE.CapsuleGeometry(0.065, 0.32, 3, 8).translate(0, -0.22, 0),
    sock: new THREE.CylinderGeometry(0.07, 0.07, 0.12, 8),
    shoe: new THREE.BoxGeometry(0.12, 0.09, 0.28),
    shadow: new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
    ring: new THREE.PlaneGeometry(1.3, 1.3).rotateX(-Math.PI / 2),
    marker: new THREE.ConeGeometry(0.12, 0.22, 4).rotateX(Math.PI),
  };
  G.shadowTex = radialTexture('rgba(0,0,0,0.5)', 'rgba(0,0,0,0)');
  G.ringTex = ringTexture();
  return G;
}

const _v = new THREE.Vector3();

export class Player {
  constructor(data, teamData, team, opts = {}) {
    this.data = data;
    this.teamData = teamData;
    this.team = team;
    this.isUser = !!opts.isUser;
    this.name = data.name;
    this.short = data.name.split(' ').slice(-1)[0];
    this.height = data.h / 100;
    this.s = {
      spd: skill(data.spd), sht: skill(data.sht), thr: skill(data.thr),
      dnk: skill(data.dnk), pas: skill(data.pas), def: skill(data.def),
    };
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.facing = 0;
    this.lookTarget = null;
    this.y = 0;
    this.vy = 0;
    this.airborne = false;
    this.intent = { x: 0, z: 0, sprint: false };
    this.stance = false; // defensive stance
    this.holding = false; // holding ball (not dribbling)
    this.action = null;
    this.stamina = 1;
    this.ballSide = 1; // 1 = right hand, -1 = left hand
    this.dribblePhase = 0;
    this.cd = { steal: 0, cross: 0, pickup: 0, jump: 0, pass: 0 };
    this.speedBoost = 0;
    this.runPhase = Math.random() * 6;
    this.stats = { pts: 0, fgm: 0, fga: 0, tpm: 0, tpa: 0, reb: 0, ast: 0, stl: 0, blk: 0, dnk: 0 };
    this.joints = {};
    this.buildModel(opts);
  }

  // ------------------------------------------------------------ model
  buildModel() {
    const g = geoms();
    const team = this.teamData;
    const skinMat = new THREE.MeshLambertMaterial({ color: SKIN_TONES[this.data.skin] ?? SKIN_TONES[2] });
    const jersey = new THREE.MeshLambertMaterial({ color: team.primary });
    const tex = jerseyTextures(team, this.data);
    const front = new THREE.MeshLambertMaterial({ map: tex.front });
    const back = new THREE.MeshLambertMaterial({ map: tex.back });
    const trim = new THREE.MeshLambertMaterial({ color: team.secondary });
    const shortsMat = new THREE.MeshLambertMaterial({ color: team.primary });
    const shoeMat = new THREE.MeshLambertMaterial({ color: team.secondary === 0x141414 ? 0xf2f2f2 : team.secondary });
    const sockMat = new THREE.MeshLambertMaterial({ color: 0xf5f5f5 });
    const hairMat = new THREE.MeshLambertMaterial({ color: HAIR_COLORS[this.data.hairColor] ?? 0x15100c });
    this.mats = { skinMat, jersey, front, back, trim };

    const object = new THREE.Group();
    const root = new THREE.Group();
    const body = new THREE.Group();
    const sc = this.height / 1.88;
    body.scale.setScalar(sc);
    root.add(body);
    object.add(root);

    const hips = new THREE.Group();
    hips.position.y = 0.97;
    body.add(hips);

    const torso = new THREE.Group();
    hips.add(torso);
    // jersey box faces: +x, -x, +y, -y, +z (front), -z (back)
    const chest = new THREE.Mesh(g.torso, [jersey, jersey, trim, jersey, front, back]);
    chest.position.y = 0.33;
    torso.add(chest);
    const shorts = new THREE.Mesh(g.shorts, shortsMat);
    shorts.position.y = -0.04;
    hips.add(shorts);
    const neck = new THREE.Mesh(g.neck, skinMat);
    neck.position.y = 0.67;
    torso.add(neck);
    const headG = new THREE.Group();
    headG.position.y = 0.8;
    torso.add(headG);
    headG.add(new THREE.Mesh(g.head, skinMat));
    const hair = this.data.hair;
    if (hair === 'afro') {
      const a = new THREE.Mesh(g.afro, hairMat);
      a.position.set(0, 0.06, -0.02);
      headG.add(a);
    } else if (hair !== 'bald') {
      const h = new THREE.Mesh(g.hair, hairMat);
      h.position.y = hair === 'buzz' ? 0.0 : 0.012;
      h.scale.y = hair === 'buzz' ? 0.85 : 1.05;
      headG.add(h);
      if (hair === 'band') {
        const b = new THREE.Mesh(g.band, new THREE.MeshLambertMaterial({ color: team.accent }));
        b.position.y = 0.05;
        headG.add(b);
      }
    }

    const arm = (side) => {
      const sh = new THREE.Group();
      sh.position.set(-side * 0.29, 0.56, 0);
      torso.add(sh);
      sh.add(new THREE.Mesh(g.upperArm, skinMat));
      const el = new THREE.Group();
      el.position.y = -0.29;
      sh.add(el);
      el.add(new THREE.Mesh(g.foreArm, skinMat));
      const hand = new THREE.Mesh(g.hand, skinMat);
      hand.position.y = -0.28;
      el.add(hand);
      return { sh, el, hand };
    };
    const leg = (side) => {
      const hp = new THREE.Group();
      hp.position.set(-side * 0.12, -0.1, 0);
      hips.add(hp);
      const th = new THREE.Mesh(g.thigh, skinMat);
      hp.add(th);
      const kn = new THREE.Group();
      kn.position.y = -0.43;
      hp.add(kn);
      kn.add(new THREE.Mesh(g.shin, skinMat));
      const sock = new THREE.Mesh(g.sock, sockMat);
      sock.position.y = -0.36;
      kn.add(sock);
      const shoe = new THREE.Mesh(g.shoe, shoeMat);
      shoe.position.set(0, -0.46, 0.05);
      kn.add(shoe);
      return { hp, kn };
    };
    // side: +1 = right, -1 = left. Player faces +z so right is -x.
    const R = arm(1), L = arm(-1);
    const RL = leg(1), LL = leg(-1);
    this.parts = { object, root, body, hips, torso, headG, R, L, RL, LL };
    object.traverse((o) => {
      if (o.isMesh) o.castShadow = true;
    });

    // Ground decals
    const ground = new THREE.Group();
    const shadow = new THREE.Mesh(g.shadow, new THREE.MeshBasicMaterial({ map: g.shadowTex, transparent: true, depthWrite: false }));
    shadow.position.y = 0.012;
    ground.add(shadow);
    this.shadow = shadow;
    if (this.isUser) {
      const ring = new THREE.Mesh(g.ring, new THREE.MeshBasicMaterial({ map: g.ringTex, color: 0x3cf0ff, transparent: true, depthWrite: false, opacity: 0.9 }));
      ring.position.y = 0.015;
      ground.add(ring);
      this.ring = ring;
      const marker = new THREE.Mesh(g.marker, new THREE.MeshBasicMaterial({ color: 0x3cf0ff }));
      root.add(marker);
      this.marker = marker;
    }
    object.add(ground);
    this.ground = ground;
    this.object = object;

    // Pose state (smoothed)
    this.pose = {
      crouch: 0, lean: 0, twist: 0,
      rShX: 0, rShZ: 0, rEl: 0, lShX: 0, lShZ: 0, lEl: 0,
      rHip: 0, rHipZ: 0, rKnee: 0, lHip: 0, lHipZ: 0, lKnee: 0,
    };
  }

  // First person: hide our own body (the camera shows dedicated hands instead).
  setFirstPerson(on) {
    this.parts.root.visible = !on;
    if (this.ring) this.ring.visible = !on;
  }

  setUserHighlight(color) {
    if (this.ring) this.ring.material.color.setHex(color);
    if (this.marker) this.marker.material.color.setHex(color);
  }

  // --------------------------------------------------------- helpers
  get hasBall() {
    return this.ball && this.ball.holder === this;
  }
  get speed() {
    return Math.hypot(this.vel.x, this.vel.z);
  }
  get forward() {
    return _v.set(Math.sin(this.facing), 0, Math.cos(this.facing));
  }
  get reach() {
    return this.height * 1.33 + this.y;
  }
  get jumpPower() {
    return 4.3 + this.s.dnk * 1.0 + this.s.spd * 0.3;
  }
  maxSpeed() {
    let v = 4.4 + this.s.spd * 2.3;
    if (this.intent.sprint && this.stamina > 0.05) v *= 1.32;
    if (this.hasBall) v *= 0.93;
    if (this.stance) v *= 0.86;
    if (this.speedBoost > 0) v *= 1.25;
    return v;
  }
  locked() {
    const a = this.action;
    return !!a && (a.type === 'jumper' || a.type === 'layup' || a.type === 'dunk' || a.type === 'stumble' || a.type === 'tip');
  }

  setAction(type, extra = {}) {
    this.action = { type, t: 0, ...extra };
    return this.action;
  }

  jump(power = 1) {
    if (this.airborne) return false;
    this.vy = this.jumpPower * power;
    this.airborne = true;
    return true;
  }

  faceToward(p, rate = 1) {
    const target = Math.atan2(p.x - this.pos.x, p.z - this.pos.z);
    this.facing = angleLerp(this.facing, target, rate);
  }

  placeAt(x, z, facePoint) {
    this.pos.set(x, 0, z);
    this.vel.set(0, 0, 0);
    this.y = 0;
    this.vy = 0;
    this.airborne = false;
    this.action = null;
    if (facePoint) this.facing = Math.atan2(facePoint.x - x, facePoint.z - z);
    this.syncObject();
  }

  // ------------------------------------------------------------ update
  update(dt, opts = {}) {
    for (const k in this.cd) this.cd[k] = Math.max(0, this.cd[k] - dt);
    this.speedBoost = Math.max(0, this.speedBoost - dt);
    if (this.action) this.action.t += dt;

    // Horizontal movement
    if (!this.locked() && !this.airborne) {
      let ix = this.intent.x, iz = this.intent.z;
      const len = Math.hypot(ix, iz);
      if (len > 1) { ix /= len; iz /= len; }
      const max = this.maxSpeed();
      const tx = ix * max, tz = iz * max;
      const accel = (len > 0.1 ? 24 : 30) * dt;
      const dx = tx - this.vel.x, dz = tz - this.vel.z;
      const dl = Math.hypot(dx, dz);
      if (dl > accel) {
        this.vel.x += (dx / dl) * accel;
        this.vel.z += (dz / dl) * accel;
      } else {
        this.vel.x = tx;
        this.vel.z = tz;
      }
      const sprinting = this.intent.sprint && len > 0.2;
      this.stamina = clamp(this.stamina + (sprinting ? -0.22 : 0.16) * dt, 0, 1);
    } else if (!this.airborne) {
      const f = Math.exp(-9 * dt);
      this.vel.x *= f;
      this.vel.z *= f;
    }

    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;

    if (opts.clamp !== false) {
      const mx = COURT.halfL - 0.25, mz = COURT.halfW - 0.25;
      if (Math.abs(this.pos.x) > mx) { this.pos.x = Math.sign(this.pos.x) * mx; this.vel.x = 0; }
      if (Math.abs(this.pos.z) > mz) { this.pos.z = Math.sign(this.pos.z) * mz; this.vel.z = 0; }
    }

    // Vertical
    if (this.airborne) {
      this.y += this.vy * dt;
      this.vy -= PLAYER_GRAVITY * dt;
      if (this.y <= 0 && this.vy < 0) {
        this.y = 0;
        this.vy = 0;
        this.airborne = false;
        this.landed = true;
      }
    }

    // Facing
    if (!this.locked() || (this.action && this.action.type === 'stumble')) {
      if (this.faceYaw != null) {
        this.facing = angleLerp(this.facing, this.faceYaw, 1 - Math.exp(-20 * dt));
      } else if (this.lookTarget && (this.stance || this.speed < 1.2 || this.holding)) {
        this.faceToward(this.lookTarget, 1 - Math.exp(-12 * dt));
      } else if (this.speed > 0.6) {
        this.facing = angleLerp(this.facing, Math.atan2(this.vel.x, this.vel.z), 1 - Math.exp(-14 * dt));
      } else if (this.lookTarget) {
        this.faceToward(this.lookTarget, 1 - Math.exp(-8 * dt));
      }
    }

    this.animate(dt);
    this.syncObject();
  }

  syncObject() {
    const p = this.parts;
    p.root.position.set(this.pos.x, this.y, this.pos.z);
    p.root.rotation.y = this.facing;
    this.ground.position.set(this.pos.x, 0, this.pos.z);
    const s = 0.9 / (1 + this.y * 0.6);
    this.shadow.scale.set(s, 1, s);
    this.shadow.material.opacity = 1 / (1 + this.y);
    p.object.updateMatrixWorld(true);
  }

  // -------------------------------------------------------- animation
  animate(dt) {
    const P = this.pose;
    const T = {
      crouch: 0.03, lean: 0, twist: 0,
      rShX: 0.05, rShZ: -0.12, rEl: -0.25, lShX: 0.05, lShZ: 0.12, lEl: -0.25,
      rHip: 0, rHipZ: 0, rKnee: 0.12, lHip: 0, lHipZ: 0, lKnee: 0.12,
    };
    const spd = this.speed;
    const run = clamp(spd / 5, 0, 1);
    this.runPhase += dt * (3 + spd * 1.9);
    const ph = this.runPhase;
    const a = this.action;
    let rate = 16;

    // Locomotion base
    if (spd > 0.2) {
      const amp = this.stance ? 0.35 : 0.85;
      T.rHip = Math.sin(ph) * amp * run;
      T.lHip = -Math.sin(ph) * amp * run;
      T.rKnee = 0.15 + run * 1.1 * (0.5 + 0.5 * Math.sin(ph + 1.9));
      T.lKnee = 0.15 + run * 1.1 * (0.5 + 0.5 * Math.sin(ph + 1.9 + Math.PI));
      T.rShX = -Math.sin(ph) * 0.7 * run;
      T.lShX = Math.sin(ph) * 0.7 * run;
      T.rEl = T.lEl = -0.5 - run * 0.7;
      T.lean = run * 0.2;
      T.crouch = 0.03 + run * 0.05 + Math.abs(Math.sin(ph)) * 0.03 * run;
    } else {
      const br = Math.sin(this.runPhase * 0.6) * 0.02;
      T.rShX += br;
      T.lShX += br;
    }

    if (this.stance) {
      T.crouch = 0.17;
      T.lean = 0.3;
      T.rHip -= 0.45;
      T.lHip -= 0.45;
      T.rHipZ = -0.25;
      T.lHipZ = 0.25;
      T.rKnee += 0.8;
      T.lKnee += 0.8;
      T.rShX = -0.6; T.lShX = -0.6;
      T.rShZ = -1.0; T.lShZ = 1.0;
      T.rEl = T.lEl = -0.5;
    }

    // Ball-in-hand poses
    if (this.hasBall && !a) {
      if (this.holding) {
        T.rShX = T.lShX = -0.85;
        T.rShZ = 0.25; T.lShZ = -0.25;
        T.rEl = T.lEl = -1.1;
      } else {
        const dp = Math.abs(Math.cos(Math.PI * this.dribblePhase));
        const hand = this.ballSide > 0 ? 'r' : 'l';
        const other = hand === 'r' ? 'l' : 'r';
        T[hand + 'ShX'] = -0.55 - dp * 0.15;
        T[hand + 'ShZ'] = (hand === 'r' ? -1 : 1) * 0.3;
        T[hand + 'El'] = -0.3 - dp * 0.5;
        T[other + 'ShX'] = -0.7;
        T[other + 'ShZ'] = (other === 'r' ? -1 : 1) * 0.55;
        T[other + 'El'] = -0.9;
        T.crouch += 0.05;
        T.lean += 0.12;
      }
    }

    if (a) {
      const t = a.t;
      switch (a.type) {
        case 'jumper': {
          if (!a.released) {
            if (t < a.gather) {
              const k = t / a.gather;
              T.crouch = 0.12 * Math.sin(k * Math.PI) + 0.06;
              T.rKnee = T.lKnee = 0.9 * Math.sin(k * Math.PI);
              T.rHip = T.lHip = -0.5 * Math.sin(k * Math.PI);
              T.rShX = T.lShX = -1.2 - k * 1.0;
              T.rEl = T.lEl = -1.5;
              T.rShZ = 0.2; T.lShZ = -0.2;
            } else {
              T.rShX = -2.75; T.rEl = -1.75; T.rShZ = 0.15;
              T.lShX = -2.55; T.lEl = -1.4; T.lShZ = -0.35;
              T.rKnee = T.lKnee = 0.25;
            }
            rate = 22;
          } else {
            T.rShX = -2.95; T.rEl = -0.12; T.rShZ = 0.1;
            T.lShX = -2.3; T.lEl = -0.6; T.lShZ = -0.4;
            T.rKnee = T.lKnee = this.airborne ? 0.3 : 0.15;
            rate = 26;
          }
          break;
        }
        case 'layup': {
          T.rShX = -3.0; T.rEl = -0.25; T.rShZ = 0.1;
          T.lShX = -1.0; T.lEl = -0.9;
          T.lHip = -1.3; T.lKnee = 1.5;
          T.rHip = 0.2; T.rKnee = 0.2;
          T.lean = 0.1;
          rate = 18;
          break;
        }
        case 'dunk': {
          if (a.style === 'windmill' && !a.slammed) {
            T.rShX = -1 - t * 9; T.rEl = -0.1;
            T.lShX = -2.4; T.lEl = -0.6;
            rate = 40;
          } else if (a.style === 'one' && !a.slammed) {
            T.rShX = -3.05; T.rEl = -0.4;
            T.lShX = -1.3; T.lEl = -0.8;
          } else {
            T.rShX = T.lShX = -3.0;
            T.rEl = T.lEl = a.slammed ? -0.1 : -0.9;
            T.rShZ = 0.15; T.lShZ = -0.15;
          }
          T.rHip = -0.5; T.lHip = 0.2;
          T.rKnee = 1.2; T.lKnee = 0.6;
          if (a.hanging) {
            T.rHip = T.lHip = -0.25;
            T.rKnee = T.lKnee = 0.4;
          }
          break;
        }
        case 'block':
        case 'rebound':
        case 'tip': {
          T.rShX = T.lShX = -3.05;
          T.rEl = T.lEl = -0.1;
          T.rShZ = 0.12; T.lShZ = -0.12;
          T.rKnee = T.lKnee = 0.5;
          T.rHip = T.lHip = -0.2;
          rate = 24;
          break;
        }
        case 'stumble': {
          T.crouch = 0.25 + Math.sin(t * 9) * 0.05;
          T.lean = -0.35;
          T.twist = Math.sin(t * 14) * 0.5;
          T.rShX = -1.2 + Math.sin(t * 20) * 0.8;
          T.lShX = -1.0 + Math.cos(t * 18) * 0.8;
          T.rShZ = -1.2; T.lShZ = 1.2;
          T.rKnee = T.lKnee = 1.0;
          T.rHip = -0.6; T.lHip = 0.3;
          break;
        }
        case 'pass': {
          const hand = this.ballSide > 0 ? 'r' : 'l';
          T.rShX = T.lShX = -1.45;
          T.rEl = T.lEl = -0.15;
          T[hand + 'ShX'] = -1.55;
          rate = 30;
          break;
        }
        case 'steal': {
          const hand = a.hand || 'r';
          T[hand + 'ShX'] = -1.25;
          T[hand + 'El'] = -0.1;
          T[hand + 'ShZ'] = 0;
          T.lean = 0.45;
          T.crouch = 0.15;
          rate = 30;
          break;
        }
        case 'crossover': {
          T.crouch = 0.14;
          T.lean = 0.3;
          T.twist = -this.ballSide * 0.35;
          break;
        }
        case 'celebrate': {
          T.rShX = -2.7 + Math.sin(t * 11) * 0.35;
          T.lShX = -2.7 + Math.cos(t * 11) * 0.35;
          T.rEl = T.lEl = -1.3;
          T.rShZ = -0.5; T.lShZ = 0.5;
          break;
        }
        case 'catch': {
          T.rShX = T.lShX = -1.1;
          T.rEl = T.lEl = -0.6;
          break;
        }
        case 'inbound': {
          T.rShX = T.lShX = -2.6;
          T.rEl = T.lEl = -1.2;
          break;
        }
      }
    }

    if (this.airborne && (!a || a.type === 'jumper')) {
      T.rKnee = Math.max(T.rKnee, 0.35);
      T.lKnee = Math.max(T.lKnee, 0.35);
    }

    for (const k in T) P[k] = smooth(P[k], T[k], rate, dt);

    const p = this.parts;
    p.hips.position.y = 0.97 - P.crouch;
    p.hips.rotation.x = P.lean * 0.4;
    p.torso.rotation.x = P.lean * 0.6;
    p.torso.rotation.y = P.twist;
    p.R.sh.rotation.set(P.rShX, 0, P.rShZ);
    p.L.sh.rotation.set(P.lShX, 0, P.lShZ);
    p.R.el.rotation.x = P.rEl;
    p.L.el.rotation.x = P.lEl;
    p.RL.hp.rotation.set(P.rHip - P.lean * 0.4, 0, P.rHipZ);
    p.LL.hp.rotation.set(P.lHip - P.lean * 0.4, 0, P.lHipZ);
    p.RL.kn.rotation.x = P.rKnee;
    p.LL.kn.rotation.x = P.lKnee;

    if (this.marker) {
      this.marker.position.y = this.height + 0.35 + Math.sin(this.runPhase * 0.8) * 0.05;
      this.marker.rotation.y += dt * 3;
    }
    if (this.ring) this.ring.material.opacity = 0.65 + Math.sin(performance.now() * 0.006) * 0.25;
  }

  handPos(right = true, out = new THREE.Vector3()) {
    const h = right ? this.parts.R.hand : this.parts.L.hand;
    return h.getWorldPosition(out);
  }

  // Where the ball should sit while this player holds it.
  ballHoldPos(out) {
    const a = this.action;
    const fwd = this.forward.clone();
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x); // player's right (-x local)
    const hs = this.height / 1.88;
    if (a && (a.type === 'jumper' || a.type === 'layup' || a.type === 'dunk' || a.type === 'inbound')) {
      if (a.type === 'jumper' || a.type === 'inbound') {
        // between both hands, slightly above
        const r = this.handPos(true, new THREE.Vector3());
        const l = this.handPos(false, new THREE.Vector3());
        out.copy(r).add(l).multiplyScalar(0.5);
        out.y += 0.1;
        out.addScaledVector(fwd, 0.06);
        return out;
      }
      this.handPos(true, out);
      out.y += 0.1;
      return out;
    }
    if (this.holding || (a && (a.type === 'pass' || a.type === 'catch'))) {
      out.copy(this.pos).addScaledVector(fwd, 0.36);
      out.y = this.y + 1.2 * hs;
      return out;
    }
    // Dribble
    let side = this.ballSide;
    if (a && a.type === 'crossover') side = a.from + (a.to - a.from) * clamp(a.t / a.dur, 0, 1);
    out.copy(this.pos).addScaledVector(fwd, 0.42 + this.speed * 0.04).addScaledVector(right, side * 0.3);
    const top = 0.95 * hs + this.y;
    const k = Math.abs(Math.cos(Math.PI * this.dribblePhase));
    out.y = BALL_R + (top - BALL_R) * (a && a.type === 'crossover' ? k * 0.55 : k);
    return out;
  }

  dispose() {
    this.object.traverse((o) => {
      if (o.isMesh) {
        const ms = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of ms) {
          if (m.map && m.map !== G.shadowTex && m.map !== G.ringTex) m.map.dispose();
          m.dispose();
        }
      }
    });
  }
}
