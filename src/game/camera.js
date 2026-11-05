import * as THREE from 'three';
import { HOOP_X } from '../core/constants.js';
import { clamp, smooth, angleLerp } from '../core/utils.js';

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
    // First-person view state
    this.yaw = 0;
    this.pitch = 0;
    this.lookIdle = 9;
    this.autoLook = true;
    this.povReady = false;
    this.bob = 0;
  }

  // Manual look input (mouse / right stick / arrow keys), radians.
  addLook(dYaw, dPitch) {
    if (Math.abs(dYaw) + Math.abs(dPitch) < 1e-5) return;
    this.yaw += dYaw;
    this.pitch = clamp(this.pitch + dPitch, -1.1, 1.1);
    this.lookIdle = 0;
  }

  get isPov() {
    return this.mode === 'pov';
  }

  // First and third person both use mouse / stick look.
  get usesLook() {
    return this.mode === 'pov' || this.mode === 'third';
  }

  lookDir(minP = -1.1, maxP = 1.1, offset = 0) {
    const p = clamp(this.pitch + offset, minP, maxP);
    return new THREE.Vector3(Math.sin(this.yaw) * Math.cos(p), Math.sin(p), Math.cos(this.yaw) * Math.cos(p));
  }

  // Auto-look toward the action when the player isn't steering with mouse/stick.
  steer(dt, ctx, eye, u) {
    if (ctx.lookAt) {
      const dx = ctx.lookAt.x - eye.x, dz = ctx.lookAt.z - eye.z;
      const hd = Math.hypot(dx, dz);
      const tYaw = Math.atan2(dx, dz);
      const tPitch = clamp(Math.atan2(ctx.lookAt.y - eye.y, Math.max(hd, 0.5)), -0.4, 0.35);
      if (!this.povReady) {
        this.yaw = hd > 0.3 ? tYaw : u.facing;
        this.pitch = tPitch;
        this.povReady = true;
      } else if (this.autoLook && this.lookIdle > 0.65 && hd > 0.8) {
        // Ease in so the view never snaps around.
        const ease = clamp((this.lookIdle - 0.65) / 0.65, 0, 1);
        const k = (1 - Math.exp(-(ctx.steerRate ?? 2.4) * dt)) * ease;
        this.yaw = angleLerp(this.yaw, tYaw, k);
        this.pitch += (tPitch - this.pitch) * k;
      }
    } else if (!this.povReady) {
      this.yaw = u.facing;
      this.pitch = -0.08;
      this.povReady = true;
    }
    this.lookIdle += dt;
  }

  shake(a) {
    this.shakeAmt = Math.max(this.shakeAmt, a);
  }

  setMode(mode, snap = false) {
    const look = mode === 'pov' || mode === 'third';
    if (look && !this.usesLook) {
      this.povReady = false;
      snap = true;
    }
    if (mode === 'pov' || this.mode === 'pov') snap = true;
    this.mode = mode;
    this.snap = snap;
    // Tight near plane so first-person hands never clip.
    const near = mode === 'pov' ? 0.03 : 0.1;
    if (this.camera.near !== near) {
      this.camera.near = near;
      this.camera.updateProjectionMatrix();
    }
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
      case 'pov': {
        const u = ctx.user;
        if (!u) break;
        const eye = new THREE.Vector3(u.pos.x, u.y + u.height * 0.93, u.pos.z);
        this.steer(dt, ctx, eye, u);
        // Gentle head bob while running.
        const spd = u.airborne ? 0 : u.speed;
        this.bob += dt * (4 + spd * 1.6);
        eye.y += Math.sin(this.bob * 2) * Math.min(spd, 7) * 0.005;
        const fwd = this.lookDir();
        eye.addScaledVector(new THREE.Vector3(fwd.x, 0, fwd.z).normalize(), 0.1);
        tp.copy(eye);
        tl.copy(eye).add(fwd);
        fov = 72 + (u.intent.sprint && u.speed > 5.5 ? 6 : 0);
        rate = 1000;
        break;
      }
      case 'third': {
        // Over-the-shoulder chase cam that shares the first-person look controls.
        const u = ctx.user;
        if (!u) break;
        const head = new THREE.Vector3(u.pos.x, u.y + u.height * 0.9, u.pos.z);
        this.steer(dt, ctx, head, u);
        const fwd = this.lookDir(-0.55, 0.45, -0.2);
        const right = new THREE.Vector3(-Math.cos(this.yaw), 0, Math.sin(this.yaw));
        const pivot = head.clone().addScaledVector(right, 0.55);
        tp.copy(pivot).addScaledVector(fwd, -3.6);
        tp.y = Math.max(0.6, tp.y + 0.35);
        tl.copy(pivot).addScaledVector(fwd, 4);
        fov = 62 + (u.intent.sprint && u.speed > 5.5 ? 5 : 0);
        rate = 14;
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
