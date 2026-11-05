import * as THREE from 'three';
import {
  COURT, HOOP_X, RIM_Y, RIM_R, RIM_TUBE, BOARD_X, BOARD_T, BOARD_Y0, BOARD_Y1, BOARD_HALF_W,
} from '../core/constants.js';
import { courtTexture, ribbonTexture, backboardTexture, bannerTexture, createJumbotronCanvas, FLOOR } from './textures.js';

// Rounded rectangle path in the XZ plane. Returns [[x, z], ...] going counter-clockwise.
function roundedRect(a, b, r, segs = 8) {
  const pts = [];
  const corners = [
    [a - r, b - r, 0],
    [-(a - r), b - r, Math.PI / 2],
    [-(a - r), -(b - r), Math.PI],
    [a - r, -(b - r), (Math.PI * 3) / 2],
  ];
  for (const [cx, cz, a0] of corners) {
    for (let i = 0; i <= segs; i++) {
      const ang = a0 + (i / segs) * (Math.PI / 2);
      pts.push([cx + Math.cos(ang) * r, cz + Math.sin(ang) * r]);
    }
  }
  return pts;
}

// Builds a vertical strip (wall) or horizontal strip (tread) between two paths.
function stripGeometry(pathA, yA, pathB, yB, uvScale = 1) {
  const pos = [];
  const uv = [];
  let u = 0;
  for (let i = 0; i < pathA.length; i++) {
    const j = (i + 1) % pathA.length;
    const a0 = pathA[i], a1 = pathA[j], b0 = pathB[i], b1 = pathB[j];
    const seg = Math.hypot(a1[0] - a0[0], a1[1] - a0[1]);
    const u1 = u + seg * uvScale;
    pos.push(a0[0], yA, a0[1], b0[0], yB, b0[1], a1[0], yA, a1[1]);
    pos.push(a1[0], yA, a1[1], b0[0], yB, b0[1], b1[0], yB, b1[1]);
    uv.push(u, 0, u, 1, u1, 0, u1, 0, u, 1, u1, 1);
    u = u1;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

function mergeSimple(geoms) {
  let count = 0;
  for (const g of geoms) count += g.attributes.position.count;
  const pos = new Float32Array(count * 3);
  const nor = new Float32Array(count * 3);
  let o = 0;
  for (const g of geoms) {
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    o += g.attributes.position.count;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  return out;
}

const crowdVert = /* glsl */ `
  uniform float uTime;
  uniform float uExcite;
  attribute vec3 aColor;
  attribute float aPhase;
  varying vec3 vColor;
  varying vec3 vSkin;
  varying float vH;
  varying float vShade;
  varying float vDist;
  void main() {
    vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
    float bob = sin(uTime * (1.5 + aPhase * 2.0) + aPhase * 40.0) * 0.03;
    float jump = uExcite * max(0.0, sin(uTime * (6.0 + aPhase * 3.0) + aPhase * 90.0)) * 0.32;
    wp.y += bob + jump * step(0.25, fract(aPhase * 7.0));
    vColor = aColor;
    float s = fract(aPhase * 13.0);
    vSkin = s < 0.2 ? vec3(0.95,0.79,0.65) : s < 0.4 ? vec3(0.88,0.67,0.41) : s < 0.6 ? vec3(0.78,0.53,0.26) : s < 0.8 ? vec3(0.6,0.41,0.24) : vec3(0.36,0.22,0.13);
    vH = position.y;
    vec3 n = normalize(mat3(modelMatrix * instanceMatrix) * normal);
    vShade = 0.55 + 0.45 * max(dot(n, normalize(vec3(0.2, 1.0, 0.3))), 0.0);
    vec4 mv = viewMatrix * wp;
    vDist = -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

const crowdFrag = /* glsl */ `
  uniform vec3 uFog;
  uniform float uBright;
  varying vec3 vColor;
  varying vec3 vSkin;
  varying float vH;
  varying float vShade;
  varying float vDist;
  void main() {
    vec3 c = vH > 0.6 ? vSkin : vColor;
    c *= vShade * uBright;
    float f = smoothstep(45.0, 140.0, vDist);
    gl_FragColor = vec4(mix(c, uFog, f), 1.0);
    #include <colorspace_fragment>
  }
`;

export class Arena {
  constructor(renderer, quality) {
    this.group = new THREE.Group();
    this.quality = quality;
    this.time = 0;
    this.excite = 0;
    this.exciteTarget = 0;
    this.nets = [];
    this.spots = [];
    this.ribbons = [];
    this.ledMats = [];
    const aniso = renderer.capabilities.getMaxAnisotropy();
    this.aniso = aniso;
    this.buildFloor(aniso);
    this.buildHoop(1);
    this.buildHoop(-1);
    this.buildBowl();
    this.buildCourtside();
    this.buildCeiling();
    this.buildJumbotron();
    this.buildSpotlights();
    this.buildLights();
  }

  // ------------------------------------------------------------ floor
  buildFloor(aniso) {
    const tex = courtTexture(aniso);
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(FLOOR.halfL * 2, FLOOR.halfW * 2),
      new THREE.MeshPhongMaterial({ map: tex, shininess: 60, specular: 0x3a3028 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.group.add(floor);
    this.floor = floor;

    const under = new THREE.Mesh(
      new THREE.PlaneGeometry(90, 70),
      new THREE.MeshLambertMaterial({ color: 0x141018 }),
    );
    under.rotation.x = -Math.PI / 2;
    under.position.y = -0.02;
    this.group.add(under);
  }

  // ------------------------------------------------------------- hoops
  buildHoop(side) {
    const g = new THREE.Group();
    const padMat = new THREE.MeshLambertMaterial({ color: 0x1d3f8f });
    const steel = new THREE.MeshLambertMaterial({ color: 0x2a2d35 });
    const orange = new THREE.MeshLambertMaterial({ color: 0xff7a1a });

    const base = new THREE.Mesh(new THREE.BoxGeometry(1.3, 1.1, 1.9), padMat);
    base.position.set(side * (COURT.halfL + 1.75), 0.55, 0);
    g.add(base);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(1.32, 0.12, 1.92), orange);
    stripe.position.set(base.position.x, 0.9, 0);
    g.add(stripe);

    const poleX = side * (COURT.halfL + 1.4);
    const pole = new THREE.Mesh(new THREE.BoxGeometry(0.28, 3.2, 0.28), padMat);
    pole.position.set(poleX, 1.1 + 1.6, 0);
    g.add(pole);

    const armLen = Math.abs(poleX - side * (BOARD_X + BOARD_T));
    const arm = new THREE.Mesh(new THREE.BoxGeometry(armLen, 0.16, 0.16), steel);
    arm.position.set((poleX + side * (BOARD_X + BOARD_T)) / 2, 3.65, 0);
    g.add(arm);
    const brace = new THREE.Mesh(new THREE.BoxGeometry(armLen * 1.05, 0.1, 0.1), steel);
    brace.position.set(arm.position.x, 3.2, 0);
    brace.rotation.z = side * -0.32;
    g.add(brace);

    // Glass
    const bw = BOARD_HALF_W * 2, bh = BOARD_Y1 - BOARD_Y0;
    const glass = new THREE.Mesh(
      new THREE.BoxGeometry(BOARD_T, bh, bw),
      new THREE.MeshPhongMaterial({ color: 0xbfe3ff, transparent: true, opacity: 0.22, shininess: 120, depthWrite: false }),
    );
    glass.position.set(side * (BOARD_X + BOARD_T / 2), (BOARD_Y0 + BOARD_Y1) / 2, 0);
    g.add(glass);
    const lines = new THREE.Mesh(
      new THREE.PlaneGeometry(bw, bh),
      new THREE.MeshBasicMaterial({ map: backboardTexture(), transparent: true, depthWrite: false }),
    );
    lines.position.set(side * (BOARD_X - 0.003), glass.position.y, 0);
    lines.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
    g.add(lines);
    const pad = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.08, bw), orange);
    pad.position.set(glass.position.x, BOARD_Y0 - 0.04, 0);
    g.add(pad);

    // Rim + bracket
    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(RIM_R, RIM_TUBE, 8, 40),
      new THREE.MeshPhongMaterial({ color: 0xff4a12, emissive: 0x3a0a00, shininess: 80 }),
    );
    rim.rotation.x = Math.PI / 2;
    rim.position.set(side * HOOP_X, RIM_Y, 0);
    g.add(rim);
    const bracket = new THREE.Mesh(new THREE.BoxGeometry(BOARD_X - HOOP_X - RIM_R, 0.04, 0.12), rim.material);
    bracket.position.set(side * (BOARD_X - (BOARD_X - HOOP_X - RIM_R) / 2), RIM_Y - 0.02, 0);
    g.add(bracket);

    // Net: diamond mesh of line segments with animated vertices.
    const levels = 5, around = 14, depth = 0.45;
    const base0 = [];
    for (let l = 0; l < levels; l++) {
      const f = l / (levels - 1);
      const r = RIM_R * (1 - f) + 0.13 * f;
      for (let j = 0; j < around; j++) {
        const a = ((j + (l % 2) * 0.5) / around) * Math.PI * 2;
        base0.push([Math.cos(a) * r, -f * depth, Math.sin(a) * r, f]);
      }
    }
    const segs = [];
    for (let l = 0; l < levels - 1; l++) {
      for (let j = 0; j < around; j++) {
        const i0 = l * around + j;
        const jn = l % 2 === 0 ? j : (j + 1) % around;
        const jp = l % 2 === 0 ? (j - 1 + around) % around : j;
        segs.push(i0, (l + 1) * around + jn, i0, (l + 1) * around + jp);
      }
    }
    const netPos = new Float32Array(segs.length * 3);
    const netGeo = new THREE.BufferGeometry();
    netGeo.setAttribute('position', new THREE.BufferAttribute(netPos, 3));
    const net = new THREE.LineSegments(netGeo, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 }));
    net.position.set(side * HOOP_X, RIM_Y - 0.01, 0);
    net.frustumCulled = false;
    g.add(net);
    const netState = { side, net, base: base0, segs, pos: netPos, impulse: 0, swayX: 0, swayZ: 0 };
    this.nets.push(netState);
    this.updateNet(netState, 0);

    this.group.add(g);
  }

  updateNet(n, t) {
    const imp = n.impulse;
    for (let k = 0; k < n.segs.length; k++) {
      const [x, y, z, f] = n.base[n.segs[k]];
      const squeeze = 1 - 0.3 * imp * f;
      const wob = Math.sin(t * 18 + f * 4) * imp * 0.04 * f;
      n.pos[k * 3] = x * squeeze + n.swayX * f * imp + wob;
      n.pos[k * 3 + 1] = y * (1 + 0.25 * imp);
      n.pos[k * 3 + 2] = z * squeeze + n.swayZ * f * imp + wob;
    }
    n.net.geometry.attributes.position.needsUpdate = true;
  }

  // Called when the ball drops through the hoop.
  swishNet(side, strength = 1, vx = 0, vz = 0) {
    const n = this.nets.find((x) => x.side === side);
    if (!n) return;
    n.impulse = Math.min(1.4, n.impulse + strength);
    n.swayX = vx * 0.04;
    n.swayZ = vz * 0.04;
  }

  // ------------------------------------------------------------- bowl
  buildBowl() {
    const crowdFrac = { low: 0.4, medium: 0.7, high: 0.95 }[this.quality] ?? 0.7;
    const seatGeoms = [];
    const riserGeoms = [];
    const people = [];

    const addTier = (startOff, y0, rows, depth, rise, a0, b0, r0) => {
      for (let i = 0; i < rows; i++) {
        const o = startOff + i * depth;
        const y = y0 + i * rise;
        const inner = roundedRect(a0 + o, b0 + o, r0 + o);
        const outer = roundedRect(a0 + o + depth, b0 + o + depth, r0 + o + depth);
        riserGeoms.push(stripGeometry(inner, y, inner, y + rise));
        seatGeoms.push(stripGeometry(inner, y + rise, outer, y + rise));
        // crowd on this tread
        const mid = roundedRect(a0 + o + depth * 0.45, b0 + o + depth * 0.45, r0 + o + depth * 0.45, 10);
        const spacing = 0.58;
        let acc = 0;
        for (let k = 0; k < mid.length; k++) {
          const p = mid[k], q = mid[(k + 1) % mid.length];
          const seg = Math.hypot(q[0] - p[0], q[1] - p[1]);
          let s = (spacing - (acc % spacing)) % spacing;
          for (; s < seg; s += spacing) {
            const along = acc + s;
            if (along % 11 < 1.3) continue; // aisle
            if (Math.random() > crowdFrac) continue;
            const t = s / seg;
            const x = p[0] + (q[0] - p[0]) * t;
            const z = p[1] + (q[1] - p[1]) * t;
            people.push([x, y + rise, z]);
          }
          acc += seg;
        }
      }
    };

    const A = 19, B = 12.6, R = 5;
    addTier(0, 0.45, 14, 0.85, 0.42, A, B, R);
    const lowerTopOff = 14 * 0.85;
    const lowerTopY = 0.45 + 14 * 0.42;
    addTier(lowerTopOff + 1.4, lowerTopY + 2.6, 12, 0.8, 0.56, A, B, R);

    const seats = new THREE.Mesh(mergeSimple(seatGeoms), new THREE.MeshLambertMaterial({ color: 0x232a40, side: THREE.DoubleSide }));
    const risers = new THREE.Mesh(mergeSimple(riserGeoms), new THREE.MeshLambertMaterial({ color: 0x141826, side: THREE.DoubleSide }));
    this.group.add(seats, risers);

    // Front wall with LED ad ribbon around the floor.
    const wallPath = roundedRect(A - 0.05, B - 0.05, R - 0.05);
    const ribTex = ribbonTexture(this.aniso);
    ribTex.repeat.set(1 / 8, 1);
    const ribbonMat = new THREE.MeshBasicMaterial({ map: ribTex, side: THREE.DoubleSide });
    const wall = new THREE.Mesh(stripGeometry(wallPath, 0, wallPath, 0.95, 1), ribbonMat);
    this.group.add(wall);
    this.ribbons.push({ tex: ribTex, speed: 0.012 });

    // Fascia ribbon between tiers.
    const fOff = lowerTopOff + 0.6;
    const fPath = roundedRect(A + fOff, B + fOff, R + fOff);
    const fTex = ribbonTexture(this.aniso);
    fTex.repeat.set(1 / 10, 1);
    // Sit the ribbon in front of the fascia wall so the two never z-fight.
    const rPath = roundedRect(A + fOff - 0.12, B + fOff - 0.12, R + fOff - 0.12);
    const fascia = new THREE.Mesh(stripGeometry(rPath, lowerTopY + 0.5, rPath, lowerTopY + 2.3, 1), new THREE.MeshBasicMaterial({ map: fTex, side: THREE.DoubleSide }));
    this.group.add(fascia);
    this.ribbons.push({ tex: fTex, speed: -0.008 });
    const fWall = new THREE.Mesh(stripGeometry(fPath, lowerTopY, fPath, lowerTopY + 2.6), new THREE.MeshLambertMaterial({ color: 0x0c0e16, side: THREE.DoubleSide }));
    this.group.add(fWall);

    // Outer wall
    const oPath = roundedRect(A + 24, B + 24, R + 24);
    const outer = new THREE.Mesh(stripGeometry(oPath, 0, oPath, 34), new THREE.MeshBasicMaterial({ color: 0x07080f, side: THREE.DoubleSide }));
    this.group.add(outer);

    // Crowd
    const body = new THREE.BoxGeometry(0.44, 0.8, 0.32);
    body.translate(0, 0.4, 0);
    const count = people.length;
    const phase = new Float32Array(count);
    const color = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) phase[i] = Math.random();
    const geo = body;
    geo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phase, 1));
    geo.setAttribute('aColor', new THREE.InstancedBufferAttribute(color, 3));
    this.crowdMat = new THREE.ShaderMaterial({
      vertexShader: crowdVert,
      fragmentShader: crowdFrag,
      uniforms: {
        uTime: { value: 0 },
        uExcite: { value: 0 },
        uFog: { value: new THREE.Color(0x07080f) },
        uBright: { value: 0.75 },
      },
    });
    const crowd = new THREE.InstancedMesh(geo, this.crowdMat, count);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const sc = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
      const [x, y, z] = people[i];
      const tx = Math.max(-12, Math.min(12, x)), tz = Math.max(-5, Math.min(5, z));
      q.setFromAxisAngle(up, Math.atan2(tx - x, tz - z));
      const s = 0.9 + Math.random() * 0.22;
      sc.set(s, s, s);
      m.compose(new THREE.Vector3(x, y, z), q, sc);
      crowd.setMatrixAt(i, m);
    }
    crowd.frustumCulled = false;
    this.crowd = crowd;
    this.crowdColor = color;
    this.group.add(crowd);
    this.setCrowdColors(0xff7a1a, 0x1d3f8f);
  }

  setCrowdColors(home, away) {
    const c = new THREE.Color();
    const cols = this.crowdColor;
    const homeC = new THREE.Color(home), awayC = new THREE.Color(away);
    const misc = [0xffffff, 0x1a1a1a, 0x3a5fa0, 0xb02a2a, 0x7a7a7a, 0x2e7d32, 0xf2c14e];
    for (let i = 0; i < cols.length / 3; i++) {
      const r = Math.random();
      if (r < 0.42) c.copy(homeC);
      else if (r < 0.62) c.copy(awayC);
      else c.setHex(misc[Math.floor(Math.random() * misc.length)]);
      c.multiplyScalar(0.75 + Math.random() * 0.35);
      cols[i * 3] = c.r;
      cols[i * 3 + 1] = c.g;
      cols[i * 3 + 2] = c.b;
    }
    this.crowd.geometry.attributes.aColor.needsUpdate = true;
  }

  // ------------------------------------------------------- courtside
  buildCourtside() {
    // Scorer's table with LED front
    const tableZ = -(COURT.halfW + 1.7);
    const table = new THREE.Mesh(new THREE.BoxGeometry(8, 0.85, 0.8), new THREE.MeshLambertMaterial({ color: 0x0b0d14 }));
    table.position.set(0, 0.425, tableZ);
    this.group.add(table);
    const tTex = ribbonTexture(this.aniso);
    tTex.repeat.set(0.5, 1);
    const tFront = new THREE.Mesh(new THREE.PlaneGeometry(8, 0.7), new THREE.MeshBasicMaterial({ map: tTex }));
    tFront.position.set(0, 0.45, tableZ + 0.41);
    this.group.add(tFront);
    this.ribbons.push({ tex: tTex, speed: 0.03 });

    // Team benches
    this.benchMats = [new THREE.MeshLambertMaterial({ color: 0x555555 }), new THREE.MeshLambertMaterial({ color: 0x555555 })];
    const chairGeo = new THREE.BoxGeometry(0.5, 0.9, 0.5);
    for (const [k, sx] of [[0, -1], [1, 1]]) {
      const chairs = new THREE.InstancedMesh(chairGeo, this.benchMats[k], 8);
      const m = new THREE.Matrix4();
      for (let i = 0; i < 8; i++) {
        m.makeTranslation(sx * (5 + i * 0.85), 0.45, -(COURT.halfW + 1.9));
        chairs.setMatrixAt(i, m);
      }
      this.group.add(chairs);
    }

    // Photographers row / baseline pads
    for (const side of [-1, 1]) {
      const pad = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.5, 9), new THREE.MeshLambertMaterial({ color: 0x0f111a }));
      pad.position.set(side * (COURT.halfL + 3.4), 0.25, 0);
      this.group.add(pad);
    }
  }

  setBenchColors(home, away) {
    this.benchMats[0].color.setHex(home);
    this.benchMats[1].color.setHex(away);
  }

  // --------------------------------------------------------- ceiling
  buildCeiling() {
    const roof = new THREE.Mesh(new THREE.PlaneGeometry(110, 90), new THREE.MeshBasicMaterial({ color: 0x05060b }));
    roof.rotation.x = Math.PI / 2;
    roof.position.y = 30;
    this.group.add(roof);

    // Truss ring with light cans
    const trussMat = new THREE.MeshLambertMaterial({ color: 0x23262f });
    const tPath = roundedRect(20, 13, 6, 4);
    for (let i = 0; i < tPath.length; i++) {
      const p = tPath[i], q = tPath[(i + 1) % tPath.length];
      const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (len < 0.01) continue;
      const beam = new THREE.Mesh(new THREE.BoxGeometry(len, 0.5, 0.5), trussMat);
      beam.position.set((p[0] + q[0]) / 2, 22, (p[1] + q[1]) / 2);
      beam.rotation.y = -Math.atan2(q[1] - p[1], q[0] - p[0]);
      this.group.add(beam);
    }
    const lampMat = new THREE.MeshBasicMaterial({ color: 0xfff6dd });
    const lampGeo = new THREE.BoxGeometry(0.7, 0.2, 0.7);
    const lamps = new THREE.InstancedMesh(lampGeo, lampMat, 28);
    const m = new THREE.Matrix4();
    let li = 0;
    for (let i = 0; i < 14; i++) {
      for (const zs of [-1, 1]) {
        m.makeTranslation(-18 + i * 2.77, 21.7, zs * 13);
        lamps.setMatrixAt(li++, m);
      }
    }
    this.group.add(lamps);

    // Banners (fictional history)
    const banners = [
      ['CHAMPS', '2019', '#b3122e'], ['CHAMPS', '2022', '#b3122e'], ['CHAMPS', '2025', '#b3122e'],
      ['WEST', 'TITLE', '#1d3f8f'], ['100', 'WINS', '#1d3f8f'], ['RETIRED', '#32', '#2a2a2a'],
    ];
    banners.forEach(([t, s, c], i) => {
      const b = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 4.4), new THREE.MeshBasicMaterial({ map: bannerTexture(t, s, c), side: THREE.DoubleSide }));
      const side = i < 3 ? -1 : 1;
      b.position.set(side * 27, 19, -6 + (i % 3) * 6);
      b.rotation.y = side * -Math.PI / 2;
      this.group.add(b);
    });
  }

  // ------------------------------------------------------- jumbotron
  buildJumbotron() {
    const j = new THREE.Group();
    j.position.set(0, 14.5, 0);
    const core = new THREE.Mesh(new THREE.BoxGeometry(5.0, 3.6, 6.8), new THREE.MeshLambertMaterial({ color: 0x0b0c12 }));
    j.add(core);
    this.jumbo = createJumbotronCanvas();
    const screenMat = new THREE.MeshBasicMaterial({ map: this.jumbo.texture });
    const big = new THREE.PlaneGeometry(6.4, 3.3);
    const small = new THREE.PlaneGeometry(4.7, 3.3);
    for (const zs of [-1, 1]) {
      const s = new THREE.Mesh(small, screenMat);
      s.position.z = zs * 3.41;
      if (zs < 0) s.rotation.y = Math.PI;
      j.add(s);
    }
    for (const xs of [-1, 1]) {
      const s = new THREE.Mesh(big, screenMat);
      s.position.x = xs * 2.51;
      s.rotation.y = xs * Math.PI / 2;
      j.add(s);
    }
    this.ledTop = new THREE.MeshBasicMaterial({ color: 0xff7a1a });
    this.ledBot = new THREE.MeshBasicMaterial({ color: 0x1d6bff });
    const ringTop = new THREE.Mesh(new THREE.BoxGeometry(5.3, 0.35, 7.1), this.ledTop);
    ringTop.position.y = 2.0;
    const ringBot = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.4, 5.9), this.ledBot);
    ringBot.position.y = -2.0;
    j.add(ringTop, ringBot);
    const cable = new THREE.Mesh(new THREE.BoxGeometry(0.1, 13, 0.1), new THREE.MeshBasicMaterial({ color: 0x111111 }));
    cable.position.y = 8.5;
    j.add(cable);
    this.group.add(j);
    this.jumbotron = j;
    this.jumbo.draw({ logo: true, sub: 'ARENA' });
  }

  setLedColors(a, b) {
    this.ledTop.color.setHex(a);
    this.ledBot.color.setHex(b);
  }

  // ------------------------------------------------------ spotlights
  buildSpotlights() {
    const geo = new THREE.CylinderGeometry(0.25, 3.2, 22, 20, 1, true);
    geo.translate(0, -11, 0);
    const c = document.createElement('canvas');
    c.width = 4; c.height = 128;
    const g = c.getContext('2d');
    const gr = g.createLinearGradient(0, 0, 0, 128);
    gr.addColorStop(0, 'rgba(255,255,255,0.0)');
    gr.addColorStop(0.3, 'rgba(255,255,255,0.35)');
    gr.addColorStop(1, 'rgba(255,255,255,0.9)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 4, 128);
    const tex = new THREE.CanvasTexture(c);
    for (let i = 0; i < 6; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: i % 2 ? 0xff7a1a : 0x4aa3ff, map: tex, transparent: true, opacity: 0.35,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      });
      const cone = new THREE.Mesh(geo, mat);
      const pivot = new THREE.Group();
      pivot.position.set(-15 + i * 6, 22, i % 2 ? -11 : 11);
      pivot.add(cone);
      pivot.visible = false;
      this.group.add(pivot);
      this.spots.push({ pivot, phase: i * 1.3, mat });
    }
  }

  setSpotlights(on, colors) {
    this.spotsOn = on;
    this.spots.forEach((s, i) => {
      s.pivot.visible = on;
      if (colors) s.mat.color.setHex(colors[i % colors.length]);
    });
  }

  // ------------------------------------------------------------ lights
  buildLights() {
    const hemi = new THREE.HemisphereLight(0xe6ecff, 0x2a1d12, 1.25);
    this.group.add(hemi);
    this.group.add(new THREE.AmbientLight(0xffffff, 0.35));
    const sun = new THREE.DirectionalLight(0xfff2dc, 2.0);
    sun.position.set(6, 30, 12);
    if (this.quality === 'high') {
      sun.castShadow = true;
      sun.shadow.mapSize.set(1024, 1024);
      const cam = sun.shadow.camera;
      cam.left = -17; cam.right = 17; cam.top = 11; cam.bottom = -11;
      cam.near = 5; cam.far = 60;
      sun.shadow.bias = -0.0008;
    }
    this.group.add(sun);
    this.group.add(sun.target);
    const fill = new THREE.DirectionalLight(0xcfd8ff, 0.6);
    fill.position.set(-8, 18, -14);
    this.group.add(fill);
  }

  // ------------------------------------------------------------ update
  cheer(level = 1) {
    this.excite = Math.max(this.excite, level);
  }

  update(dt) {
    this.time += dt;
    const t = this.time;
    this.excite = Math.max(this.exciteTarget, this.excite - dt * 0.35);
    this.crowdMat.uniforms.uTime.value = t;
    this.crowdMat.uniforms.uExcite.value = this.excite;
    for (const r of this.ribbons) r.tex.offset.x = (r.tex.offset.x + r.speed * dt) % 1;
    for (const n of this.nets) {
      if (n.impulse > 0.001) {
        n.impulse *= Math.exp(-3.5 * dt);
        this.updateNet(n, t);
      }
    }
    if (this.spotsOn) {
      for (const s of this.spots) {
        s.pivot.rotation.x = Math.sin(t * 0.7 + s.phase) * 0.5;
        s.pivot.rotation.z = Math.cos(t * 0.9 + s.phase * 1.7) * 0.45;
      }
    }
  }

  jumboDraw(state) {
    this.jumbo.draw(state);
  }
}
