import * as THREE from 'three';
import { clamp, smooth } from '../core/utils.js';
import { ballTexture } from '../world/textures.js';
import { SKIN_TONES } from '../data/teams.js';
import { BALL_R } from '../core/constants.js';

const _w = new THREE.Vector3();
const _e = new THREE.Vector3();

// First-person hands + ball, parented to the camera.
// Positions are in camera space: +x right, +y up, -z forward.
export class ViewModel {
  constructor(camera) {
    this.camera = camera;
    this.group = new THREE.Group();
    this.group.visible = false;
    camera.add(this.group);

    this.skin = new THREE.MeshLambertMaterial({ color: SKIN_TONES[2] });
    this.band = new THREE.MeshLambertMaterial({ color: 0xff7a1a });
    this.R = this.buildArm(1);
    this.L = this.buildArm(-1);
    this.group.add(this.R.root, this.L.root);

    this.ball = new THREE.Mesh(
      new THREE.SphereGeometry(BALL_R, 24, 16),
      new THREE.MeshPhongMaterial({ map: ballTexture(false), shininess: 18, specular: 0x222222 }),
    );
    this.ball.visible = false;
    this.group.add(this.ball);

    // Smoothed pose state.
    this.pose = {
      r: new THREE.Vector3(0.24, -0.34, -0.4), l: new THREE.Vector3(-0.24, -0.34, -0.4),
      rRoll: 0, lRoll: 0, b: new THREE.Vector3(0, -0.25, -0.45),
    };
    this.t = 0;
  }

  buildArm(side) {
    const root = new THREE.Group();
    // Forearm runs along +z (toward the elbow, behind the hand).
    const fore = new THREE.Mesh(new THREE.CapsuleGeometry(0.042, 0.3, 3, 10).rotateX(Math.PI / 2).translate(0, 0, 0.22), this.skin);
    root.add(fore);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.06, 12).rotateX(Math.PI / 2).translate(0, 0, 0.1), this.band);
    root.add(band);
    // Hand: palm plus fingers pointing forward (-z).
    const hand = new THREE.Group();
    const palm = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 8), this.skin);
    palm.scale.set(1, 0.45, 1.15);
    hand.add(palm);
    const fingerGeo = new THREE.CapsuleGeometry(0.0115, 0.045, 2, 6).rotateX(Math.PI / 2);
    for (let i = 0; i < 4; i++) {
      const f = new THREE.Mesh(fingerGeo, this.skin);
      f.position.set((i - 1.5) * 0.022, 0.004, -0.075 + Math.abs(i - 1.5) * 0.008);
      f.rotation.x = -0.12;
      hand.add(f);
    }
    const thumb = new THREE.Mesh(fingerGeo, this.skin);
    thumb.position.set(-side * 0.048, -0.006, -0.03);
    thumb.rotation.y = side * 0.7;
    hand.add(thumb);
    root.add(hand);
    return { root, hand, side };
  }

  setPlayer(p) {
    if (!p) return;
    this.skin.color.setHex(SKIN_TONES[p.data.skin] ?? SKIN_TONES[2]);
    this.band.color.setHex(p.teamData.accent === 0xffffff ? p.teamData.primary : p.teamData.accent);
  }

  setVisible(on) {
    this.group.visible = on;
  }

  // Aim an arm so its forearm comes from a natural elbow position below/behind/outside the hand.
  placeArm(arm, pos, roll, elbowUp = 0) {
    arm.root.position.copy(pos);
    _e.set(pos.x + arm.side * 0.16, pos.y - 0.3 + elbowUp, pos.z + 0.3);
    this.camera.localToWorld(_w.copy(_e));
    arm.root.lookAt(_w);
    arm.root.rotateZ(roll);
  }

  update(dt, u) {
    if (!this.group.visible || !u) return;
    this.t += dt;
    if (u.callT > 0) u.callT -= dt;
    const P = this.pose;
    const a = u.action;
    const at = a ? a.t : 0;
    const run = clamp(u.speed / 6, 0, 1) * (u.airborne ? 0 : 1);
    const sway = Math.sin(this.t * (5 + u.speed * 1.4)) * 0.018 * run;
    const swayX = Math.cos(this.t * (2.5 + u.speed * 0.7)) * 0.012 * run;

    // Targets
    const r = new THREE.Vector3(0.26, -0.36, -0.38);
    const l = new THREE.Vector3(-0.26, -0.36, -0.38);
    const b = new THREE.Vector3(0, -0.24, -0.44);
    let rRoll = -0.3, lRoll = 0.3;
    let showBall = false;
    let elbowUp = 0;
    let worldDribble = false;
    let rate = 16;

    if (u.hasBall) showBall = true;

    if (a && a.type === 'jumper') {
      const rise = clamp(at / (a.gather + 0.22), 0, 1);
      if (!a.released) {
        b.set(0.02, -0.22 + rise * 0.36, -0.42 + rise * 0.04);
        r.set(0.07, b.y - 0.07, b.z + 0.03);
        l.set(-0.1, b.y - 0.02, b.z + 0.02);
        rRoll = Math.PI * 0.95;
        lRoll = -1.4;
        elbowUp = rise * 0.15;
        rate = 26;
      } else {
        // Follow-through: gooseneck the shooting hand toward the rim.
        r.set(0.06, 0.16, -0.58);
        l.set(-0.16, 0.06, -0.48);
        rRoll = Math.PI;
        lRoll = -1.3;
        elbowUp = 0.2;
        rate = 22;
      }
    } else if (a && a.type === 'layup') {
      r.set(0.12, 0.14, -0.5);
      l.set(-0.18, -0.12, -0.42);
      b.set(0.12, 0.27, -0.52);
      rRoll = Math.PI * 0.9;
      elbowUp = 0.15;
      rate = 22;
    } else if (a && a.type === 'dunk') {
      if (!a.slammed) {
        b.set(0, 0.3, -0.5);
        r.set(0.1, 0.2, -0.48);
        l.set(-0.1, 0.2, -0.48);
        rRoll = Math.PI * 0.9;
        lRoll = -Math.PI * 0.9;
      } else {
        // Hanging on the rim.
        r.set(0.16, 0.26, -0.36);
        l.set(-0.16, 0.26, -0.36);
        rRoll = Math.PI;
        lRoll = -Math.PI;
      }
      elbowUp = 0.2;
      rate = 24;
    } else if (a && (a.type === 'block' || a.type === 'rebound' || a.type === 'tip')) {
      r.set(0.17, 0.24, -0.4);
      l.set(-0.17, 0.24, -0.4);
      rRoll = Math.PI;
      lRoll = -Math.PI;
      elbowUp = 0.2;
      rate = 26;
    } else if (a && a.type === 'steal') {
      const k = Math.sin(clamp(at / 0.28, 0, 1) * Math.PI);
      const hand = a.hand === 'l' ? l : r;
      hand.set((a.hand === 'l' ? -1 : 1) * (0.2 - k * 0.12), -0.38 + k * 0.06, -0.38 - k * 0.42);
      rate = 34;
    } else if (a && a.type === 'pass') {
      r.set(0.1, -0.2, -0.68);
      l.set(-0.1, -0.2, -0.68);
      rRoll = -Math.PI * 0.5;
      lRoll = Math.PI * 0.5;
      rate = 30;
    } else if (a && a.type === 'celebrate') {
      const k = Math.sin(at * 11) * 0.05;
      r.set(0.24, 0.18 + k, -0.4);
      l.set(-0.24, 0.18 - k, -0.4);
      rRoll = Math.PI;
      lRoll = -Math.PI;
      elbowUp = 0.25;
    } else if (a && a.type === 'stumble') {
      r.set(0.38, -0.15 + Math.sin(at * 18) * 0.08, -0.3);
      l.set(-0.38, -0.1 + Math.cos(at * 16) * 0.08, -0.3);
    } else if (u.hasBall && (u.holding || (a && (a.type === 'catch' || a.type === 'inbound')))) {
      // Cradle the ball in both hands.
      b.set(0, -0.24, -0.45);
      r.set(0.12, -0.27, -0.44);
      l.set(-0.12, -0.27, -0.44);
      rRoll = -Math.PI * 0.5;
      lRoll = Math.PI * 0.5;
    } else if (u.hasBall) {
      // Dribble: hand pumps, the ball drops straight down to the floor in world space.
      const k = Math.abs(Math.cos(Math.PI * u.dribblePhase));
      const crossing = a && a.type === 'crossover';
      const side = crossing ? a.from + (a.to - a.from) * clamp(at / a.dur, 0, 1) : u.ballSide;
      const hand = side >= 0 ? r : l;
      const other = side >= 0 ? l : r;
      hand.set(side * 0.2, -0.36 + k * 0.05, -0.46);
      other.set(-side * 0.32, -0.3, -0.36);
      rRoll = side >= 0 ? 0.1 : -0.2;
      lRoll = side >= 0 ? 0.2 : -0.1;
      b.set(hand.x, hand.y - 0.13, hand.z);
      worldDribble = (1 - k) * (crossing ? 0.55 : 1);
      rate = 24;
    } else if (u.stance) {
      // Defensive stance: hands wide and active.
      const shuffle = Math.sin(this.t * 6) * 0.02;
      r.set(0.44, -0.22 + shuffle, -0.36);
      l.set(-0.44, -0.22 - shuffle, -0.36);
      rRoll = Math.PI * 0.8;
      lRoll = -Math.PI * 0.8;
    } else if (u.callT > 0) {
      // Calling for the ball.
      l.set(-0.2, 0.08 + Math.sin(this.t * 14) * 0.03, -0.45);
      lRoll = -Math.PI;
      elbowUp = 0.1;
    }

    r.y += sway; l.y -= sway;
    r.x += swayX; l.x += swayX;
    if (u.airborne && !(a && (a.type === 'jumper' || a.type === 'dunk'))) {
      r.y += 0.04;
      l.y += 0.04;
    }

    const k = 1 - Math.exp(-rate * dt);
    P.r.lerp(r, k);
    P.l.lerp(l, k);
    P.b.lerp(b, k);
    P.rRoll += (rRoll - P.rRoll) * k;
    P.lRoll += (lRoll - P.lRoll) * k;
    P.elbow = smooth(P.elbow || 0, elbowUp, rate, dt);

    this.placeArm(this.R, P.r, P.rRoll, P.elbow);
    this.placeArm(this.L, P.l, P.lRoll, P.elbow);

    this.ball.visible = showBall;
    if (showBall) {
      if (worldDribble !== false) {
        // Drop the ball toward the floor along world "down", from the dribbling hand.
        this.camera.localToWorld(_w.copy(P.b));
        const drop = Math.max(0, _w.y - BALL_R) * worldDribble;
        _w.y -= drop;
        this.camera.worldToLocal(_w);
        this.ball.position.copy(_w);
      } else {
        this.ball.position.copy(P.b);
      }
      this.ball.rotation.x -= dt * (2 + u.speed * 2);
    }
  }
}
