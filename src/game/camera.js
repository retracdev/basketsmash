import * as THREE from 'three';
import { HOOP_X } from '../core/constants.js';
import { clamp, smooth } from '../core/utils.js';

export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.mode = 'menu';
    this.pos = new THREE.Vector3(20, 8, 16);
    this.look = new THREE.Vector3(0, 2, 0);
    this.dir = new THREE.Vector3(1, 0, 0);
    this.shakeAmt = 0;
    this.orbit = 0;
    this.intro = null;
    this.fov = 45;
  }

  shake(a) {
    this.shakeAmt = Math.max(this.shakeAmt, a);
  }

  setMode(mode, snap = false) {
    this.mode = mode;
    this.snap = snap;
  }

  // Path flythrough: points are [x,y,z] arrays.
  playIntro(posPts, lookPts, duration, onDone) {
    this.intro = {
      pos: new THREE.CatmullRomCurve3(posPts.map((p) => new THREE.Vector3(...p))),
      look: new THREE.CatmullRomCurve3(lookPts.map((p) => new THREE.Vector3(...p))),
      t: 0,
      duration,
      onDone,
    };
    this.mode = 'intro';
  }

  skipIntro() {
    if (this.intro) {
      const cb = this.intro.onDone;
      this.intro = null;
      if (cb) cb();
    }
  }

  // Camera-relative movement basis on the floor plane.
  basis() {
    const f = new THREE.Vector3();
    this.camera.getWorldDirection(f);
    f.y = 0;
    if (f.lengthSq() < 1e-4) f.set(0, 0, -1);
    f.normalize();
    const r = new THREE.Vector3(-f.z, 0, f.x);
    return { fwd: f, right: r };
  }

  update(dt, ctx = {}) {
    const cam = this.camera;
    let tp = this.pos.clone(), tl = this.look.clone();
    let rate = 3.2;
    let fov = 45;

    switch (this.mode) {
      case 'menu': {
        this.orbit += dt * 0.05;
        const a = this.orbit;
        tp.set(Math.cos(a) * 23, 6.5 + Math.sin(a * 0.7) * 2.5, Math.sin(a) * 15);
        tl.set(0, 2.2, 0);
        rate = 2;
        break;
      }
      case 'intro': {
        const it = this.intro;
        if (it) {
          it.t += dt;
          const k = clamp(it.t / it.duration, 0, 1);
          const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
          it.pos.getPoint(e, tp);
          it.look.getPoint(e, tl);
          rate = 1000;
          fov = 50;
          if (k >= 1) this.skipIntro();
        }
        break;
      }
      case 'broadcast': {
        const fx = clamp(ctx.focus ? ctx.focus.x : 0, -10.5, 10.5);
        tp.set(fx * 0.9, 9.6, 18.8);
        tl.set(fx, 0.9, 0.6);
        fov = 40;
        rate = 2.8;
        break;
      }
      case 'player':
      case 'arcade': {
        const u = ctx.user;
        if (!u) break;
        const target = new THREE.Vector3();
        if (ctx.offense || this.mode === 'arcade') {
          target.set(ctx.side * HOOP_X - u.pos.x, 0, -u.pos.z);
        } else {
          target.set(u.pos.x - ctx.side * HOOP_X, 0, u.pos.z);
        }
        if (target.lengthSq() < 0.5) target.set(ctx.side, 0, 0);
        target.normalize();
        this.dir.lerp(target, 1 - Math.exp(-2.5 * dt)).normalize();
        const back = this.mode === 'arcade' ? 6.2 : 7.6;
        const up = this.mode === 'arcade' ? 3.4 : 4.4;
        tp.copy(u.pos).addScaledVector(this.dir, -back);
        tp.y = up;
        tl.copy(u.pos).addScaledVector(this.dir, 4.5);
        tl.y = 1.6;
        fov = 52;
        rate = 4;
        break;
      }
      case 'fixed': {
        tp.copy(ctx.pos || tp);
        tl.copy(ctx.look || tl);
        rate = 3;
        break;
      }
    }

    if (this.snap) {
      this.pos.copy(tp);
      this.look.copy(tl);
      this.snap = false;
    } else {
      const k = 1 - Math.exp(-rate * dt);
      this.pos.lerp(tp, k);
      this.look.lerp(tl, k);
    }
    this.fov = smooth(this.fov, fov, 3, dt);
    if (Math.abs(cam.fov - this.fov) > 0.01) {
      cam.fov = this.fov;
      cam.updateProjectionMatrix();
    }

    cam.position.copy(this.pos);
    if (this.shakeAmt > 0.001) {
      const s = this.shakeAmt;
      cam.position.x += (Math.random() - 0.5) * s;
      cam.position.y += (Math.random() - 0.5) * s;
      cam.position.z += (Math.random() - 0.5) * s * 0.5;
      this.shakeAmt *= Math.exp(-7 * dt);
    }
    cam.lookAt(this.look);
  }
}
