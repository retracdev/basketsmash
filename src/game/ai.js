import * as THREE from 'three';
import { HOOP_X, THREE_R, RIM_Y, distToHoop2D, isThreePoint } from '../core/constants.js';
import { clamp, rand, chance } from '../core/utils.js';
import { shotRating, DIFF } from './shooting.js';

// Offensive spots in hoop-local coords: u = distance from hoop toward midcourt, z = lateral.
const SPOTS = [
  { u: 7.7, z: 0, kind: 'three' },
  { u: 5.9, z: -5.0, kind: 'three' },
  { u: 5.9, z: 5.0, kind: 'three' },
  { u: 0.7, z: -6.95, kind: 'three' },
  { u: 0.7, z: 6.95, kind: 'three' },
  { u: 4.7, z: -2.7, kind: 'mid' },
  { u: 4.7, z: 2.7, kind: 'mid' },
  { u: 1.1, z: -2.5, kind: 'post' },
  { u: 1.1, z: 2.5, kind: 'post' },
];

const _v = new THREE.Vector3();

export function spotPos(side, s, out = new THREE.Vector3()) {
  return out.set(side * (HOOP_X - s.u), 0, s.z);
}

export function moveTo(p, target, { sprint = false, arrive = 0.35, speed = 1 } = {}) {
  const dx = target.x - p.pos.x, dz = target.z - p.pos.z;
  const d = Math.hypot(dx, dz);
  if (d < arrive) {
    p.intent.x = 0;
    p.intent.z = 0;
    p.intent.sprint = false;
    return d;
  }
  const k = Math.min(1, d / 1.4) * speed;
  p.intent.x = (dx / d) * k;
  p.intent.z = (dz / d) * k;
  p.intent.sprint = sprint && d > 2.5 && p.stamina > 0.15;
  return d;
}

function nearestDist(p, others) {
  let best = Infinity;
  for (const o of others) {
    const d = Math.hypot(o.pos.x - p.pos.x, o.pos.z - p.pos.z);
    if (d < best) best = d;
  }
  return best;
}

function laneClear(world, p, side) {
  const hx = side * HOOP_X;
  const dx = hx - p.pos.x, dz = -p.pos.z;
  const L = Math.hypot(dx, dz) || 1;
  const ux = dx / L, uz = dz / L;
  for (const d of world.opponents(p)) {
    const rx = d.pos.x - p.pos.x, rz = d.pos.z - p.pos.z;
    const along = rx * ux + rz * uz;
    if (along < 0 || along > Math.min(4, L)) continue;
    const perp = Math.abs(rx * uz - rz * ux);
    if (perp < 1.15) return false;
  }
  return true;
}

function brain(p) {
  if (!p.ai) p.ai = { think: rand(0, 0.3), spot: null, spotT: 0, cutT: 0, drive: false, target: new THREE.Vector3(), contestT: -1 };
  return p.ai;
}

export function resetAI(players) {
  for (const p of players) {
    const ai = brain(p);
    ai.spot = null;
    ai.spotT = 0;
    ai.cutT = 0;
    ai.drive = false;
    ai.think = rand(0.1, 0.4);
    ai.contestT = -1;
  }
}

export function updateAI(match, dt) {
  const b = match.ball;
  for (const p of match.players) {
    if (p.isUser) continue;
    const ai = brain(p);
    ai.think -= dt;
    p.stance = false;
    p.intent.sprint = false;
    if (p.locked()) {
      p.intent.x = p.intent.z = 0;
      continue;
    }
    const holder = b.holder;
    if (b.state === 'loose' || b.state === 'shot') {
      rebound(match, p, ai, dt);
    } else if (holder && holder.team === p.team) {
      if (holder === p) offenseBall(match, p, ai, dt);
      else offenseOff(match, p, ai, dt);
    } else if (b.state === 'pass' && b.pass.from.team === p.team) {
      offenseOff(match, p, ai, dt);
    } else {
      defense(match, p, ai, dt);
    }
  }
}

// ------------------------------------------------------------- offense
function offenseBall(m, p, ai, dt) {
  const side = m.attackSide(p.team);
  const hoop = _v.set(side * HOOP_X, 0, 0).clone();
  const dist = distToHoop2D(p.pos, side);
  const opp = m.opponents(p);
  const open = nearestDist(p, opp);
  p.lookTarget = hoop;
  const react = DIFF.aiReact[m.difficulty];

  // User called for the ball.
  if (p.calledBy) {
    p.callT -= dt;
    if (!m.laneBlocked(p, p.calledBy) || p.callT < 0.2) {
      const to = p.calledBy;
      p.calledBy = null;
      const alley = to.intent.sprint && distToHoop2D(to.pos, side) < 4.5 && to.s.dnk > 0.55 && distToHoop2D(to.pos, side) > 1.2;
      m.pass(p, to, { alley, lob: alley || undefined });
      return;
    }
    if (p.callT <= 0) p.calledBy = null;
  }

  const inBack = side * p.pos.x < 0.8;
  if (inBack) {
    const ahead = opp.filter((d) => side * (d.pos.x - p.pos.x) > 0 && Math.abs(d.pos.z - p.pos.z) < 4).length;
    _v.set(side * 4.5, 0, clamp(p.pos.z * 0.6, -4, 4));
    moveTo(p, _v, { sprint: ahead === 0 || m.shotClock < 16 });
    // outlet to a teammate streaking ahead
    if (ai.think <= 0) {
      ai.think = react + rand(0.2, 0.4);
      for (const t of m.teammates(p)) {
        const tAhead = side * (t.pos.x - p.pos.x);
        if (tAhead > 6 && nearestDist(t, opp) > 3 && !m.laneBlocked(p, t) && chance(0.6)) {
          m.pass(p, t);
          return;
        }
      }
    }
    return;
  }

  if (ai.drive) {
    const dir = hoop.clone().sub(p.pos).setY(0).normalize();
    _v.copy(hoop).addScaledVector(dir, -0.6);
    moveTo(p, _v, { sprint: true, arrive: 0.1 });
    const dunkReady = p.s.dnk > 0.55 && dist < 1.6 + p.s.dnk * 1.6;
    if (dist < 2.2 || (dunkReady && chance(0.5))) {
      ai.drive = false;
      m.beginShot(p);
      return;
    }
    // defender cut him off
    for (const d of opp) {
      const rx = d.pos.x - p.pos.x, rz = d.pos.z - p.pos.z;
      const dd = Math.hypot(rx, rz);
      if (dd < 1.0 && (rx * dir.x + rz * dir.z) / dd > 0.6) {
        ai.drive = false;
        if (dist > 3.5 && dist < 6.5 && chance(0.4)) m.beginShot(p, 'jumper');
        else if (chance(0.35)) m.crossover(p);
        break;
      }
    }
    return;
  }

  if (ai.think <= 0) {
    ai.think = react + rand(0.15, 0.45);
    const three = isThreePoint(p.pos, side);
    const rating = shotRating(p, dist, three);
    const openF = clamp((open - 0.9) / 2.4, 0, 1);
    let quality = rating * 0.85 + openF * 0.75;
    if (dist > THREE_R + 1.2) quality -= 0.7;
    if (!three && dist > 4.2) quality -= 0.12;
    if (three) quality += (p.s.thr - 0.55) * 0.4;
    if (m.shotClock < 3.5 && dist < 11) {
      m.beginShot(p);
      return;
    }
    if (dist < 2.3) {
      m.beginShot(p);
      return;
    }
    const lane = laneClear(m, p, side);
    const driveScore = p.s.dnk * 0.55 + p.s.spd * 0.35 + (lane ? 0.45 : -0.6) - Math.max(0, dist - 5) * 0.05;
    const best = bestPass(m, p, side);
    if (quality > 1.0 + rand(-0.18, 0.12) && dist < 9) {
      m.beginShot(p);
      return;
    }
    if (driveScore > 0.78 + rand(-0.2, 0.15)) {
      ai.drive = true;
      return;
    }
    if (best && best.score > 0.62 + rand(-0.1, 0.15) && m.time - (p.lastPassT || -10) > 0.8) {
      m.pass(p, best.mate, { alley: best.alley, lob: best.alley || undefined });
      return;
    }
    // reposition with the dribble (keep a target for a while so movement isn't jittery)
    ai.dribbleT = (ai.dribbleT ?? 0) - (react + 0.3);
    if (ai.dribbleT <= 0 || ai.target.distanceTo(p.pos) < 0.7) {
      const spots = SPOTS.filter((s) => s.kind !== 'post');
      const s = spots[Math.floor(Math.random() * spots.length)];
      spotPos(side, s, ai.target);
      ai.target.x += rand(-1, 1);
      ai.target.z += rand(-1, 1);
      ai.dribbleT = rand(1.5, 3);
    }
    // crossover if pressured
    if (open < 1.5 && chance(0.25 + p.s.pas * 0.3)) m.crossover(p);
  }
  if (!ai.target || ai.target.lengthSq() === 0) spotPos(side, SPOTS[0], ai.target);
  moveTo(p, ai.target, { arrive: 0.6, speed: 0.75 });
}

function bestPass(m, p, side) {
  const opp = m.opponents(p);
  let best = null;
  for (const t of m.teammates(p)) {
    if (t.locked()) continue;
    const d = distToHoop2D(t.pos, side);
    const open = nearestDist(t, opp);
    const three = isThreePoint(t.pos, side);
    const rating = shotRating(t, d, three);
    let score = clamp((open - 1) / 2.5, 0, 1) * 0.6 + rating * 0.45;
    if (d > THREE_R + 1.5) score -= 0.4;
    if (t.ai && t.ai.cutT > 0 && d < 4) score += 0.4;
    if (t.isUser) score += 0.12;
    if (m.laneBlocked(p, t)) score -= 0.6;
    const alley = t.ai && t.ai.cutT > 0 && d < 4.5 && d > 1.5 && t.s.dnk > 0.7 && p.s.pas > 0.55 && chance(0.5);
    if (alley) score += 0.3;
    if (!best || score > best.score) best = { mate: t, score, alley };
  }
  return best;
}

function offenseOff(m, p, ai, dt) {
  const side = m.attackSide(p.team);
  const b = m.ball;
  const hoop = new THREE.Vector3(side * HOOP_X, 0, 0);
  p.lookTarget = b.pos;

  // Incoming pass: meet it.
  if (b.state === 'pass' && b.pass.to === p) {
    if (b.pass.alley) {
      const dir = hoop.clone().sub(p.pos).setY(0).normalize();
      moveTo(p, hoop.clone().addScaledVector(dir, -0.7), { sprint: true, arrive: 0.2 });
      const hd = Math.hypot(b.pos.x - p.pos.x, b.pos.z - p.pos.z);
      if (hd < 2.2 && b.vel.y < 1 && !p.airborne) m.jumpFor(p);
    } else {
      // Run to where the pass is headed.
      moveTo(p, b.pass.tgt || b.pos, { sprint: true, arrive: 0.1 });
    }
    return;
  }

  const holder = b.holder;
  ai.spotT -= dt;
  if (ai.cutT > 0) {
    ai.cutT -= dt;
    const dir = hoop.clone().sub(p.pos).setY(0).normalize();
    moveTo(p, hoop.clone().addScaledVector(dir, -1.0), { sprint: true, arrive: 0.3 });
    return;
  }
  if (!ai.spot || ai.spotT <= 0 || (holder && holder.pos.distanceTo(spotPos(side, ai.spot, _v)) < 2.6)) {
    ai.spot = chooseSpot(m, p, side);
    ai.spotT = rand(2.5, 4.5);
  }
  const target = spotPos(side, ai.spot, new THREE.Vector3());
  const inBack = side * p.pos.x < 0;
  const d = moveTo(p, target, { sprint: inBack || side * (target.x - p.pos.x) > 6, arrive: 0.4 });

  // Cut to the rim if the defender is sleeping.
  if (ai.think <= 0) {
    ai.think = rand(0.5, 1.0);
    if (!inBack && d < 1 && holder && holder.team === p.team) {
      const def = m.opponents(p).reduce((a, o) => (!a || o.pos.distanceTo(p.pos) < a.pos.distanceTo(p.pos) ? o : a), null);
      const defDist = def ? def.pos.distanceTo(p.pos) : 9;
      if ((defDist > 2.2 && chance(0.35)) || chance(0.08)) ai.cutT = rand(1.0, 1.6);
    }
  }
}

function chooseSpot(m, p, side) {
  const others = m.teamPlayers(p.team).filter((q) => q !== p);
  let best = null, bestS = -Infinity;
  for (const s of SPOTS) {
    const sp = spotPos(side, s, new THREE.Vector3());
    let minD = Infinity;
    for (const o of others) {
      const op = o.ai && o.ai.spot && !o.hasBall ? spotPos(side, o.ai.spot, new THREE.Vector3()) : o.pos;
      minD = Math.min(minD, op.distanceTo(sp));
    }
    let score = Math.min(minD, 6) * 0.5;
    if (s.kind === 'three') score += (p.s.thr - 0.5) * 3;
    if (s.kind === 'post') score += (p.s.dnk - 0.6) * 3 + (p.height - 2.0) * 4;
    if (s.kind === 'mid') score += (p.s.sht - 0.55) * 2;
    score += Math.random() * 1.2;
    if (s === p.ai.spot) score -= 1;
    if (score > bestS) { bestS = score; best = s; }
  }
  return best;
}

// ------------------------------------------------------------- defense
export function guardPosition(m, p, man) {
  const side = m.attackSide(man.team);
  const hoop = new THREE.Vector3(side * HOOP_X, 0, 0);
  const b = m.ball;
  if (man.hasBall) {
    const dir = hoop.clone().sub(man.pos).setY(0);
    const dist = dir.length();
    dir.normalize();
    let gap = 1.05 + (man.s.spd - p.s.spd) * 0.4;
    if (man.s.thr < 0.4) gap += 0.6;
    if (dist > 9) gap += 1.0;
    gap = Math.min(gap, Math.max(0.6, dist - 0.4));
    return man.pos.clone().addScaledVector(dir, gap).addScaledVector(man.vel, 0.12);
  }
  const t = man.pos.clone().lerp(hoop, 0.32);
  const bp = b.holder ? b.holder.pos : b.pos;
  t.x += (bp.x - t.x) * 0.15;
  t.z += (bp.z - t.z) * 0.15;
  t.y = 0;
  return t;
}

function defense(m, p, ai) {
  const man = p.ai.man;
  const b = m.ball;
  if (!man) {
    moveTo(p, b.pos, { sprint: true });
    return;
  }
  const side = m.attackSide(man.team);
  const hoop = new THREE.Vector3(side * HOOP_X, 0, 0);
  let target = guardPosition(m, p, man);
  const holder = b.holder;

  // Help defense on a drive.
  if (holder && holder !== man && distToHoop2D(holder.pos, side) < 3.6) {
    const helpers = m.teamPlayers(p.team).filter((q) => q.ai && q.ai.man !== holder);
    const closest = helpers.reduce((a, q) => (!a || q.pos.distanceTo(holder.pos) < a.pos.distanceTo(holder.pos) ? q : a), null);
    if (closest === p) target = holder.pos.clone().lerp(hoop, 0.5).setY(0);
  }
  // Jump the passing lane when the ball is going to my man.
  if (b.state === 'pass' && b.pass.to === man) {
    target = b.pos.clone().lerp(man.pos, 0.5).setY(0);
  }

  const d = moveTo(p, target, { sprint: target.distanceTo(p.pos) > 2.5, arrive: 0.15 });
  p.stance = d < 2.5;
  p.lookTarget = man.hasBall ? man.pos : b.pos;

  // Contest shots.
  const shooter = holder && holder.action && (holder.action.type === 'jumper' || holder.action.type === 'layup' || holder.action.type === 'dunk') ? holder : null;
  if (shooter && !p.airborne && ai.contestT !== -2) {
    const sd = shooter.pos.distanceTo(p.pos);
    const range = shooter.action.type === 'jumper' ? 1.7 : 2.2;
    if (sd < range) {
      if (ai.contestT < 0) {
        // Not every defender bites; some just hold their ground and contest.
        if (!chance(0.55 + p.s.def * 0.3)) {
          ai.contestT = -2;
          return;
        }
        ai.contestT = DIFF.aiReact[m.difficulty] * rand(0.5, 1.3) + (shooter.action.type === 'jumper' ? 0.12 : 0);
      }
      ai.contestT -= 1 / 60;
      if (ai.contestT <= 0) {
        p.setAction('block');
        p.jump(1);
        ai.contestT = -1;
      }
    }
  } else if (!shooter) {
    ai.contestT = -1;
  }

  // Steal attempts.
  if (man.hasBall && ai.think <= 0) {
    ai.think = rand(0.35, 0.8);
    if (man.pos.distanceTo(p.pos) < 1.35 && chance(0.05 * DIFF.aiSteal[m.difficulty] * (0.6 + p.s.def))) {
      p.faceToward(man.pos, 1);
      m.trySteal(p);
    }
  }
}

// ------------------------------------------------------------- rebound
function rebound(m, p, ai) {
  const b = m.ball;
  const side = b.shot ? b.shot.side : (b.pos.x > 0 ? 1 : -1);
  const hoop = new THREE.Vector3(side * HOOP_X, 0, 0);
  p.lookTarget = b.pos;

  // Predict where the ball is headed.
  const land = b.pos.clone().addScaledVector(b.vel, b.state === 'shot' ? 0.15 : 0.35);
  land.y = 0;
  if (b.state === 'shot' && !b.touchedRim) {
    land.copy(hoop).add(new THREE.Vector3(-side * 1.2, 0, 0));
  }
  const mates = m.teamPlayers(p.team).slice().sort((a, c) => a.pos.distanceTo(land) - c.pos.distanceTo(land));
  const rank = mates.indexOf(p);
  if (rank <= 1 || b.state === 'loose') {
    moveTo(p, land, { sprint: true, arrive: 0.05 });
  } else {
    const back = m.attackSide(p.team) === side ? 6 : 3;
    moveTo(p, new THREE.Vector3(side * (HOOP_X - back), 0, clamp(p.pos.z, -4, 4)), { sprint: false });
  }
  const hd = Math.hypot(b.pos.x - p.pos.x, b.pos.z - p.pos.z);
  if (hd < 1.1 && b.vel.y < 0.5 && b.pos.y > p.reach - 0.05 && b.pos.y < p.reach + 0.9 && b.pos.y < RIM_Y + 0.4) {
    m.jumpFor(p);
  }
}
