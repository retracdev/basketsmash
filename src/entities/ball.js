import * as THREE from 'three';
import {
  BALL_R, GRAVITY, HOOP_X, RIM_Y, RIM_R, RIM_TUBE, BOARD_X, BOARD_T, BOARD_Y0, BOARD_Y1, BOARD_HALF_W,
} from '../core/constants.js';
import { ballTexture } from '../world/textures.js';

let sharedGeo = null;
const texCache = {};

export class Ball {
  constructor({ money = false } = {}) {
    sharedGeo ||= new THREE.SphereGeometry(BALL_R, 24, 16);
    const key = money ? 'money' : 'std';
    texCache[key] ||= ballTexture(money);
    this.mesh = new THREE.Mesh(sharedGeo, new THREE.MeshPhongMaterial({ map: texCache[key], shininess: 18, specular: 0x222222 }));
    this.mesh.castShadow = true;
    this.money = money;

    this.pos = new THREE.Vector3(0, 1, 0);
    this.prev = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.spin = new THREE.Vector3();
    this.state = 'loose';
    this.holder = null;
    this.lastTouch = null;
    this.shot = null;
    this.pass = null;
    this.flightT = 0;
    this.touchedRim = false;
    this.touchedBoard = false;
    this.touchedFloor = false;
    this.scored = false;
    this.events = {};
    this.restTime = 0;
  }

  on(name, fn) {
    this.events[name] = fn;
  }
  emit(name, ...args) {
    if (this.events[name]) this.events[name](this, ...args);
  }

  give(player) {
    if (this.holder && this.holder !== player) this.holder.ball = null;
    this.holder = player;
    player.ball = this;
    this.lastTouch = player;
    this.state = 'held';
    this.shot = null;
    this.pass = null;
    this.vel.set(0, 0, 0);
    this.spin.set(0, 0, 0);
    this.resetFlight();
  }

  release() {
    if (this.holder) {
      this.holder.ball = null;
      this.holder.holding = false;
    }
    this.holder = null;
  }

  resetFlight() {
    this.flightT = 0;
    this.touchedRim = false;
    this.touchedBoard = false;
    this.touchedFloor = false;
    this.scored = false;
  }

  launch(from, vel, state, info = null) {
    const thrower = this.holder;
    this.release();
    this.pos.copy(from);
    this.vel.copy(vel);
    this.state = state;
    this.resetFlight();
    if (state === 'shot') this.shot = info;
    if (state === 'pass') this.pass = info;
    if (thrower) this.lastTouch = thrower;
    // backspin around axis perpendicular to travel
    const h = new THREE.Vector3(vel.x, 0, vel.z);
    if (h.lengthSq() > 0.001) {
      h.normalize();
      this.spin.set(-h.z, 0, h.x).multiplyScalar(-14);
    }
  }

  // ---------------------------------------------------------- physics
  update(dt) {
    if (this.state === 'frozen') {
      this.mesh.position.copy(this.pos);
      return;
    }
    if (this.state === 'held') {
      this.mesh.position.copy(this.pos);
      if (this.holder && this.holder.speed > 0.5) {
        this.mesh.rotation.x += dt * 8;
      }
      return;
    }
    this.flightT += dt;
    const speed = this.vel.length();
    const steps = Math.min(12, Math.max(1, Math.ceil((speed * dt) / 0.025)));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) this.step(h);

    // Visual spin
    if (this.pos.y <= BALL_R + 0.01) {
      const hv = Math.hypot(this.vel.x, this.vel.z);
      if (hv > 0.01) {
        const axis = new THREE.Vector3(this.vel.z, 0, -this.vel.x).normalize();
        this.mesh.rotateOnWorldAxis(axis, (hv / BALL_R) * dt);
      }
    } else if (this.spin.lengthSq() > 0) {
      const ax = this.spin.clone().normalize();
      this.mesh.rotateOnWorldAxis(ax, this.spin.length() * dt);
    }
    this.mesh.position.copy(this.pos);

    const still = speed < 0.25 && this.pos.y < BALL_R + 0.02;
    this.restTime = still ? this.restTime + dt : 0;
  }

  step(h) {
    this.prev.copy(this.pos);
    this.vel.y -= GRAVITY * h;
    this.pos.addScaledVector(this.vel, h);

    for (const side of [1, -1]) {
      if (Math.abs(this.pos.x - side * HOOP_X) < 1.4 && this.pos.y > 2.3 && this.pos.y < 4.4) {
        this.collideBoard(side);
        this.collideRim(side);
        this.checkScore(side);
        this.netDrag(side, h);
      }
    }

    // Floor
    if (this.pos.y < BALL_R) {
      this.pos.y = BALL_R;
      if (this.vel.y < 0) {
        const vy = -this.vel.y;
        if (vy > 0.5) this.emit('floor', vy);
        this.vel.y = vy > 0.4 ? vy * 0.76 : 0;
        const f = vy > 0.4 ? 0.9 : 1;
        this.vel.x *= f;
        this.vel.z *= f;
        this.touchedFloor = true;
        this.spin.multiplyScalar(0.5);
      }
      // rolling friction
      const rf = Math.exp(-0.9 * h);
      this.vel.x *= rf;
      this.vel.z *= rf;
    }

    // Arena walls (keep ball in the building)
    const WX = 18.5, WZ = 12.2;
    if (Math.abs(this.pos.x) > WX) {
      this.pos.x = Math.sign(this.pos.x) * WX;
      this.vel.x *= -0.5;
    }
    if (Math.abs(this.pos.z) > WZ) {
      this.pos.z = Math.sign(this.pos.z) * WZ;
      this.vel.z *= -0.5;
    }
  }

  collideRim(side) {
    const cx = side * HOOP_X;
    const dx = this.pos.x - cx, dz = this.pos.z;
    const hd = Math.hypot(dx, dz);
    const dy = this.pos.y - RIM_Y;
    if (Math.abs(dy) > BALL_R + RIM_TUBE + 0.02 || hd > RIM_R + BALL_R + 0.05) return;
    let qx, qz;
    if (hd < 1e-5) { qx = cx + RIM_R; qz = 0; } else { qx = cx + (dx / hd) * RIM_R; qz = (dz / hd) * RIM_R; }
    const nx = this.pos.x - qx, ny = dy, nz = this.pos.z - qz;
    const d = Math.hypot(nx, ny, nz);
    const minD = BALL_R + RIM_TUBE;
    if (d < minD && d > 1e-6) {
      const ux = nx / d, uy = ny / d, uz = nz / d;
      this.pos.set(qx + ux * minD, RIM_Y + uy * minD, qz + uz * minD);
      const vn = this.vel.x * ux + this.vel.y * uy + this.vel.z * uz;
      if (vn < 0) {
        const e = 0.5;
        this.vel.x -= (1 + e) * vn * ux;
        this.vel.y -= (1 + e) * vn * uy;
        this.vel.z -= (1 + e) * vn * uz;
        // tangential friction
        const vn2 = this.vel.x * ux + this.vel.y * uy + this.vel.z * uz;
        const tx = this.vel.x - vn2 * ux, ty = this.vel.y - vn2 * uy, tz = this.vel.z - vn2 * uz;
        const f = 0.82;
        this.vel.set(vn2 * ux + tx * f, vn2 * uy + ty * f, vn2 * uz + tz * f);
        if (-vn > 0.3) this.emit('rim', -vn, side);
        this.touchedRim = true;
        this.spin.multiplyScalar(0.4);
      }
    }
  }

  collideBoard(side) {
    // Board box in x: [BOARD_X, BOARD_X + T] (mirrored for side -1)
    const xa = side > 0 ? BOARD_X : -BOARD_X - BOARD_T;
    const xb = side > 0 ? BOARD_X + BOARD_T : -BOARD_X;
    const cx = Math.max(xa, Math.min(xb, this.pos.x));
    const cy = Math.max(BOARD_Y0, Math.min(BOARD_Y1, this.pos.y));
    const cz = Math.max(-BOARD_HALF_W, Math.min(BOARD_HALF_W, this.pos.z));
    const nx = this.pos.x - cx, ny = this.pos.y - cy, nz = this.pos.z - cz;
    const d = Math.hypot(nx, ny, nz);
    if (d < BALL_R && d > 1e-6) {
      const ux = nx / d, uy = ny / d, uz = nz / d;
      this.pos.set(cx + ux * BALL_R, cy + uy * BALL_R, cz + uz * BALL_R);
      const vn = this.vel.x * ux + this.vel.y * uy + this.vel.z * uz;
      if (vn < 0) {
        const e = 0.62;
        this.vel.x -= (1 + e) * vn * ux;
        this.vel.y -= (1 + e) * vn * uy;
        this.vel.z -= (1 + e) * vn * uz;
        this.vel.y *= 0.92;
        if (-vn > 0.4) this.emit('board', -vn, side);
        this.touchedBoard = true;
      }
    }
  }

  checkScore(side) {
    if (this.scored) return;
    if (this.prev.y >= RIM_Y && this.pos.y < RIM_Y && this.vel.y < 0) {
      const hd = Math.hypot(this.pos.x - side * HOOP_X, this.pos.z);
      if (hd < RIM_R - 0.015) {
        this.scored = true;
        this.scoredSide = side;
        this.emit('score', side);
      }
    }
  }

  netDrag(side, h) {
    const dx = this.pos.x - side * HOOP_X, dz = this.pos.z;
    const hd = Math.hypot(dx, dz);
    if (this.pos.y < RIM_Y && this.pos.y > RIM_Y - 0.5 && hd < RIM_R + 0.03) {
      const k = Math.exp(-7 * h);
      this.vel.x *= k;
      this.vel.z *= k;
      this.vel.x -= dx * 8 * h;
      this.vel.z -= dz * 8 * h;
      if (this.vel.y < -3.2) this.vel.y = -3.2;
    }
  }
}
