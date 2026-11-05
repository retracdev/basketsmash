import * as THREE from 'three';
import { GRAVITY, HOOP_X, RIM_Y, THREE_R, isThreePoint, distToHoop2D } from '../core/constants.js';
import { clamp, gauss } from '../core/utils.js';

// Jump shot timeline (seconds). The meter is "full" at FILL; the sweet spot is the jump apex.
export const JUMPER = {
  gather: 0.22,
  jumpVy: 3.7,
  fill: 0.58,
};
JUMPER.apexT = JUMPER.gather + JUMPER.jumpVy / 15; // PLAYER_GRAVITY = 15
JUMPER.sweet = JUMPER.apexT / JUMPER.fill;
JUMPER.autoRelease = 1.14;

// User-facing difficulty tuning: [Rookie, Pro, All-Star, Legend]
export const DIFF = {
  names: ['ROOKIE', 'PRO', 'ALL-STAR', 'LEGEND'],
  userWindow: [0.03, 0.014, 0.004, -0.006],
  aiSigma: [1.8, 1.35, 1.1, 0.9],
  aiReact: [0.55, 0.4, 0.28, 0.18],
  aiSteal: [0.35, 0.7, 1.0, 1.3],
  userLayup: [0.15, 0.07, 0.02, 0],
};

export function shotRating(p, dist, three) {
  if (three) return p.s.thr;
  if (dist < 4.2) return p.s.sht * 0.55 + p.s.dnk * 0.45;
  return p.s.sht;
}

export function contestLevel(shooter, defenders, side) {
  const hx = side * HOOP_X;
  const toHoop = new THREE.Vector2(hx - shooter.pos.x, -shooter.pos.z).normalize();
  let c = 0;
  for (const d of defenders) {
    const dx = d.pos.x - shooter.pos.x, dz = d.pos.z - shooter.pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist > 2.6) continue;
    const front = dist > 0.01 ? (toHoop.x * dx + toHoop.y * dz) / dist : 1;
    const frontF = 0.3 + 0.7 * clamp((front + 0.3) / 1.3, 0, 1);
    const near = 1 - dist / 2.6;
    const hF = 1 + clamp(d.height - shooter.height, -0.2, 0.25) * 1.2;
    let v = near * frontF * (0.65 + 0.35 * d.s.def) * hF;
    if (d.airborne || (d.action && d.action.type === 'block')) v *= 1.35;
    if (d.action && d.action.type === 'stumble') v *= 0.1;
    c = Math.max(c, v);
  }
  return clamp(c, 0, 1);
}

// Half-width of the green window on the meter for this shooter/situation.
export function greenWindow(p, side, contest, { difficulty = 1, isUser = false, onFire = false } = {}) {
  const dist = distToHoop2D(p.pos, side);
  const three = isThreePoint(p.pos, side);
  const rating = shotRating(p, dist, three);
  let w = 0.02 + 0.042 * rating;
  w *= 1 - 0.55 * contest;
  if (dist > THREE_R + 0.7) w *= Math.max(0.2, 1 - (dist - THREE_R - 0.7) * 0.2);
  if (isUser) w += DIFF.userWindow[difficulty];
  if (onFire) w *= 1.5;
  return clamp(w, 0.01, 0.14);
}

// Converts a release value on the meter into an aim offset and feedback label.
export function resolveRelease(p, side, m, w, contest) {
  const dist = distToHoop2D(p.pos, side);
  const three = isThreePoint(p.pos, side);
  const rating = shotRating(p, dist, three);
  const e = m - JUMPER.sweet;
  const ae = Math.abs(e);
  const distF = 0.7 + dist / 12;
  if (ae <= w) {
    return { perfect: true, grade: 'perfect', label: 'PERFECT', depth: gauss() * 0.01, lat: gauss() * 0.008 };
  }
  const over = ae - w;
  const depth = Math.sign(e) * over * 1.45 * distF + gauss() * 0.03 * (1.25 - rating);
  const lat = gauss() * (0.022 + (1 - rating) * 0.055 + contest * 0.09) * distF;
  let label;
  if (over < 0.035) label = e < 0 ? 'SLIGHTLY EARLY' : 'SLIGHTLY LATE';
  else if (over < 0.11) label = e < 0 ? 'EARLY' : 'LATE';
  else label = e < 0 ? 'WAY EARLY' : 'WAY LATE';
  return { perfect: false, grade: over < 0.035 ? 'good' : 'bad', label, depth, lat };
}

// AI picks a release value; better shooters/difficulties cluster tighter around the sweet spot.
export function aiRelease(p, side, contest, sigmaMult) {
  const dist = distToHoop2D(p.pos, side);
  const rating = shotRating(p, dist, isThreePoint(p.pos, side));
  const sigma = ((0.11 - 0.05 * rating) * sigmaMult + contest * 0.03) * (1 + Math.max(0, dist - 7.5) * 0.12);
  return JUMPER.sweet + gauss() * sigma;
}

// Velocity to send the ball from `from` to `target` with launch angle `deg`.
export function solveLaunch(from, target, deg) {
  const dx = target.x - from.x, dz = target.z - from.z;
  const d = Math.max(0.05, Math.hypot(dx, dz));
  const h = target.y - from.y;
  let th = (deg * Math.PI) / 180;
  let denom = 0;
  for (let i = 0; i < 20; i++) {
    denom = 2 * Math.cos(th) ** 2 * (d * Math.tan(th) - h);
    if (denom > 0.05) break;
    th += 0.05;
  }
  const v = Math.sqrt((GRAVITY * d * d) / denom);
  return new THREE.Vector3((dx / d) * v * Math.cos(th), v * Math.sin(th), (dz / d) * v * Math.cos(th));
}

// Target point at the rim plane with aim error applied.
export function aimTarget(from, side, depth, lat) {
  const hx = side * HOOP_X;
  const dir = new THREE.Vector2(hx - from.x, -from.z);
  if (dir.lengthSq() < 1e-4) dir.set(side, 0);
  dir.normalize();
  return new THREE.Vector3(hx + dir.x * depth - dir.y * lat, RIM_Y, dir.y * depth + dir.x * lat);
}

export function arcFor(dist, perfect) {
  let a = 53 - Math.max(0, dist - 4) * 0.6;
  if (perfect) a += 1.5;
  return clamp(a, 45, 58);
}
