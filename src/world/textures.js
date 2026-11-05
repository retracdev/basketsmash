import * as THREE from 'three';
import { makeCanvas, hexToCss } from '../core/utils.js';
import { COURT, HOOP_X, THREE_R, CORNER_Z, KEY_HALF_W } from '../core/constants.js';

const TITLE_FONT = 'Bungee, Impact, sans-serif';
const BODY_FONT = 'Teko, Impact, sans-serif';
const LOGO_FONT = '"Space Grotesk", "Segoe UI", Arial, sans-serif';
export const ARENA_NAME = 'retrac.space Arena';

// Draws the retrac.space wordmark: light "retrac", muted purple ".space".
export function drawRetracLogo(g, x, y, size, align = 'center', light = '#f1eeff', dark = '#8c89a6') {
  g.save();
  g.font = `700 ${size}px ${LOGO_FONT}`;
  g.textBaseline = 'middle';
  g.textAlign = 'left';
  const a = 'retrac', b = '.space';
  const wa = g.measureText(a).width;
  const w = wa + g.measureText(b).width;
  let sx = x;
  if (align === 'center') sx = x - w / 2;
  else if (align === 'right') sx = x - w;
  g.fillStyle = light;
  g.fillText(a, sx, y);
  g.fillStyle = dark;
  g.fillText(b, sx + wa, y);
  g.restore();
  return w;
}

function toTexture(canvas, { repeat = false, srgb = true } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.needsUpdate = true;
  return t;
}

// ------------------------------------------------------------------ court
export const FLOOR = { halfL: 16.3, halfW: 9.6 };

export function courtTexture(maxAniso = 1) {
  const S = 62.8; // px per meter
  const W = Math.round(FLOOR.halfL * 2 * S);
  const H = Math.round(FLOOR.halfW * 2 * S);
  const c = makeCanvas(W, H);
  const g = c.getContext('2d');
  const X = (x) => (x + FLOOR.halfL) * S;
  const Y = (z) => (z + FLOOR.halfW) * S;

  // Apron (dark stain)
  g.fillStyle = '#2b1d14';
  g.fillRect(0, 0, W, H);

  // Hardwood planks inside court + a bit outside
  const x0 = X(-COURT.halfL - 0.9), x1 = X(COURT.halfL + 0.9);
  const y0 = Y(-COURT.halfW - 0.9), y1 = Y(COURT.halfW + 0.9);
  const plank = 0.11 * S;
  let row = 0;
  for (let y = y0; y < y1; y += plank, row++) {
    const base = 200 + ((row * 37) % 17) - 8;
    g.fillStyle = `rgb(${base},${Math.round(base * 0.66)},${Math.round(base * 0.38)})`;
    g.fillRect(x0, y, x1 - x0, plank + 1);
    // staggered seams
    let sx = x0 - ((row * 211) % 300);
    while (sx < x1) {
      const len = 90 + ((row * 53 + sx) % 160);
      g.fillStyle = 'rgba(70,40,20,0.35)';
      g.fillRect(sx, y, 1.5, plank);
      const shade = ((row * 13 + Math.floor(sx)) % 9) - 4;
      g.fillStyle = shade > 0 ? `rgba(255,230,190,${shade * 0.012})` : `rgba(60,30,10,${-shade * 0.015})`;
      g.fillRect(sx, y, len, plank);
      sx += len;
    }
    g.fillStyle = 'rgba(60,30,10,0.22)';
    g.fillRect(x0, y, x1 - x0, 1);
  }
  // Grain
  for (let i = 0; i < 9000; i++) {
    const gx = x0 + Math.random() * (x1 - x0);
    const gy = y0 + Math.random() * (y1 - y0);
    g.fillStyle = `rgba(90,50,20,${Math.random() * 0.08})`;
    g.fillRect(gx, gy, 6 + Math.random() * 30, 1);
  }

  // Painted keys
  const keyLen = 5.8;
  for (const side of [-1, 1]) {
    const bx = side * COURT.halfL;
    const fx = side * (COURT.halfL - keyLen);
    g.fillStyle = 'rgba(25,60,150,0.86)';
    g.fillRect(Math.min(X(bx), X(fx)), Y(-KEY_HALF_W), Math.abs(X(bx) - X(fx)), KEY_HALF_W * 2 * S);
  }
  // Center circle paint
  g.fillStyle = 'rgba(25,60,150,0.86)';
  g.beginPath();
  g.arc(X(0), Y(0), 1.83 * S, 0, Math.PI * 2);
  g.fill();

  // Lines
  g.strokeStyle = '#f5f5f0';
  g.lineWidth = 0.06 * S;
  g.strokeRect(X(-COURT.halfL), Y(-COURT.halfW), COURT.halfL * 2 * S, COURT.halfW * 2 * S);
  g.beginPath();
  g.moveTo(X(0), Y(-COURT.halfW));
  g.lineTo(X(0), Y(COURT.halfW));
  g.stroke();
  for (const r of [1.83, 0.61]) {
    g.beginPath();
    g.arc(X(0), Y(0), r * S, 0, Math.PI * 2);
    g.stroke();
  }

  const a = Math.asin(CORNER_Z / THREE_R);
  for (const side of [-1, 1]) {
    const hx = side * HOOP_X;
    const bx = side * COURT.halfL;
    const fx = side * (COURT.halfL - keyLen);
    const meet = hx - side * Math.sqrt(THREE_R * THREE_R - CORNER_Z * CORNER_Z);
    // key outline
    g.strokeRect(Math.min(X(bx), X(fx)), Y(-KEY_HALF_W), Math.abs(X(bx) - X(fx)), KEY_HALF_W * 2 * S);
    // free throw circle
    g.beginPath();
    if (side > 0) g.arc(X(fx), Y(0), 1.83 * S, Math.PI / 2, (Math.PI * 3) / 2);
    else g.arc(X(fx), Y(0), 1.83 * S, -Math.PI / 2, Math.PI / 2);
    g.stroke();
    g.setLineDash([0.3 * S, 0.3 * S]);
    g.beginPath();
    if (side > 0) g.arc(X(fx), Y(0), 1.83 * S, -Math.PI / 2, Math.PI / 2);
    else g.arc(X(fx), Y(0), 1.83 * S, Math.PI / 2, (Math.PI * 3) / 2);
    g.stroke();
    g.setLineDash([]);
    // three point line
    g.beginPath();
    g.moveTo(X(bx), Y(-CORNER_Z));
    g.lineTo(X(meet), Y(-CORNER_Z));
    if (side > 0) g.arc(X(hx), Y(0), THREE_R * S, Math.PI + a, Math.PI - a, true);
    else g.arc(X(hx), Y(0), THREE_R * S, -a, a, false);
    g.lineTo(X(bx), Y(CORNER_Z));
    g.stroke();
    // restricted area
    g.beginPath();
    if (side > 0) g.arc(X(hx), Y(0), 1.22 * S, Math.PI / 2, (Math.PI * 3) / 2);
    else g.arc(X(hx), Y(0), 1.22 * S, -Math.PI / 2, Math.PI / 2);
    g.stroke();
    // lane hash marks
    for (const d of [2.13, 3.05, 3.96, 4.88]) {
      const hxm = bx - side * d;
      for (const zs of [-1, 1]) {
        g.beginPath();
        g.moveTo(X(hxm), Y(zs * KEY_HALF_W));
        g.lineTo(X(hxm), Y(zs * (KEY_HALF_W + 0.2)));
        g.stroke();
      }
    }
  }

  // Center logo
  g.save();
  g.translate(X(0), Y(0));
  g.fillStyle = '#ff7a1a';
  g.beginPath();
  g.arc(0, 0, 0.55 * S, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = '#141414';
  g.lineWidth = 0.05 * S;
  g.beginPath();
  g.arc(0, 0, 0.55 * S, 0, Math.PI * 2);
  g.moveTo(-0.55 * S, 0);
  g.lineTo(0.55 * S, 0);
  g.moveTo(0, -0.55 * S);
  g.lineTo(0, 0.55 * S);
  g.stroke();
  g.beginPath();
  g.arc(-0.75 * S, 0, 0.55 * S, -0.8, 0.8);
  g.stroke();
  g.beginPath();
  g.arc(0.75 * S, 0, 0.55 * S, Math.PI - 0.8, Math.PI + 0.8);
  g.stroke();
  g.restore();

  // Apron lettering
  g.fillStyle = 'rgba(255,255,255,0.85)';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (const zs of [-1, 1]) {
    g.save();
    g.translate(X(0), Y(zs * (COURT.halfW + 0.85)));
    if (zs < 0) g.rotate(Math.PI);
    drawRetracLogo(g, -0.4 * S, 0, Math.round(0.85 * S), 'right');
    g.font = `${Math.round(0.8 * S)}px ${TITLE_FONT}`;
    g.fillStyle = 'rgba(255,255,255,0.88)';
    g.textAlign = 'left';
    g.fillText('ARENA', -0.1 * S, 0);
    // sideline sponsor marks near the benches
    drawRetracLogo(g, -9.5 * S, 0, Math.round(0.6 * S));
    drawRetracLogo(g, 9.5 * S, 0, Math.round(0.6 * S));
    g.restore();
  }
  g.font = `${Math.round(0.9 * S)}px ${TITLE_FONT}`;
  for (const side of [-1, 1]) {
    g.save();
    g.translate(X(side * (COURT.halfL + 0.95)), Y(0));
    g.rotate(side * Math.PI / 2);
    g.fillStyle = '#ff7a1a';
    g.fillText('BASKETSMASH', 0, 0);
    g.restore();
  }

  const t = toTexture(c);
  t.anisotropy = maxAniso;
  return t;
}

// ------------------------------------------------------------------- ball
export function ballTexture(money = false) {
  const W = 512, H = 256;
  const c = makeCanvas(W, H);
  const g = c.getContext('2d');
  g.fillStyle = money ? '#e8e8e8' : '#d8601c';
  g.fillRect(0, 0, W, H);
  if (money) {
    // Money ball: tri-color panels
    const cols = ['#d23b2a', '#f2f2f2', '#2353c4', '#f2f2f2'];
    for (let i = 0; i < 4; i++) {
      g.fillStyle = cols[i];
      g.fillRect((i * W) / 4, 0, W / 4, H);
    }
  }
  // Pebbles
  for (let i = 0; i < 14000; i++) {
    const x = Math.random() * W, y = Math.random() * H;
    g.fillStyle = Math.random() < 0.5 ? 'rgba(0,0,0,0.12)' : 'rgba(255,220,180,0.10)';
    g.fillRect(x, y, 2, 2);
  }
  g.strokeStyle = '#1a0d06';
  g.lineWidth = 5;
  g.beginPath();
  g.moveTo(0, H / 2);
  g.lineTo(W, H / 2);
  for (const x of [0, W / 4, W / 2, (3 * W) / 4, W]) {
    g.moveTo(x, 0);
    g.lineTo(x, H);
  }
  g.stroke();
  g.lineWidth = 4;
  for (const sgn of [-1, 1]) {
    g.beginPath();
    for (let x = 0; x <= W; x += 4) {
      const y = H / 2 + sgn * H * 0.3 * Math.cos((x / W) * Math.PI * 4);
      if (x === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
  }
  return toTexture(c);
}

// ----------------------------------------------------------------- jersey
export function jerseyTextures(team, player) {
  const make = (front) => {
    const c = makeCanvas(256, 256);
    const g = c.getContext('2d');
    g.fillStyle = hexToCss(team.primary);
    g.fillRect(0, 0, 256, 256);
    // side trim
    g.fillStyle = hexToCss(team.secondary);
    g.fillRect(0, 0, 18, 256);
    g.fillRect(238, 0, 18, 256);
    g.fillStyle = hexToCss(team.accent);
    g.fillRect(18, 0, 5, 256);
    g.fillRect(233, 0, 5, 256);
    // neckline
    g.fillStyle = hexToCss(team.secondary);
    g.beginPath();
    g.ellipse(128, 0, front ? 56 : 44, front ? 40 : 18, 0, 0, Math.PI);
    g.fill();
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const top = front ? team.abbr : player.name.split(' ').slice(-1)[0].toUpperCase();
    g.font = `${front ? 40 : 30}px ${TITLE_FONT}`;
    g.fillStyle = hexToCss(team.secondary);
    g.fillText(top, 128, front ? 72 : 60, 200);
    g.font = `${front ? 120 : 140}px ${TITLE_FONT}`;
    g.lineWidth = 10;
    g.strokeStyle = hexToCss(team.accent);
    g.strokeText(String(player.num), 128, front ? 168 : 165);
    g.fillStyle = hexToCss(team.secondary);
    g.fillText(String(player.num), 128, front ? 168 : 165);
    return toTexture(c);
  };
  return { front: make(true), back: make(false) };
}

// -------------------------------------------------------------- ad ribbon
// LED ribbon: the retrac.space wordmark repeated, nothing else.
export function ribbonTexture(maxAniso = 1) {
  const W = 2048, H = 128;
  const c = makeCanvas(W, H);
  const g = c.getContext('2d');
  const bg = g.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#1b1830');
  bg.addColorStop(1, '#0d0b1a');
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);
  const n = 4;
  const bw = W / n;
  for (let i = 0; i < n; i++) {
    drawRetracLogo(g, i * bw + bw / 2, H / 2 + 2, 58);
    // thin divider between logos
    g.fillStyle = 'rgba(140,137,166,0.35)';
    g.fillRect(i * bw, 30, 3, H - 60);
  }
  const t = toTexture(c, { repeat: true });
  t.anisotropy = maxAniso;
  return t;
}

// --------------------------------------------------------------- backboard
export function backboardTexture() {
  const c = makeCanvas(256, 150);
  const g = c.getContext('2d');
  g.clearRect(0, 0, 256, 150);
  g.fillStyle = 'rgba(200,230,255,0.18)';
  g.fillRect(0, 0, 256, 150);
  g.strokeStyle = '#ffffff';
  g.lineWidth = 8;
  g.strokeRect(4, 4, 248, 142);
  const bw = 256 * (0.61 / 1.83), bh = 150 * (0.45 / 1.07);
  const by = 150 - 150 * (0.15 / 1.07);
  g.lineWidth = 6;
  g.strokeRect(128 - bw / 2, by - bh, bw, bh);
  return toTexture(c);
}

// ------------------------------------------------------------------ blobs
export function radialTexture(inner = 'rgba(0,0,0,0.55)', outer = 'rgba(0,0,0,0)') {
  const c = makeCanvas(64, 64);
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, inner);
  gr.addColorStop(1, outer);
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  return toTexture(c);
}

export function ringTexture() {
  const c = makeCanvas(128, 128);
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 30, 64, 64, 62);
  gr.addColorStop(0, 'rgba(255,255,255,0)');
  gr.addColorStop(0.55, 'rgba(255,255,255,1)');
  gr.addColorStop(0.75, 'rgba(255,255,255,0.6)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 128, 128);
  return toTexture(c);
}

// --------------------------------------------------------------- banners
export function bannerTexture(title, sub, color) {
  const c = makeCanvas(128, 256);
  const g = c.getContext('2d');
  g.fillStyle = color;
  g.fillRect(0, 0, 128, 256);
  g.fillStyle = 'rgba(0,0,0,0.25)';
  g.fillRect(0, 220, 128, 36);
  g.fillStyle = '#fff';
  g.textAlign = 'center';
  g.font = `28px ${TITLE_FONT}`;
  g.fillText(title, 64, 70, 116);
  g.font = `34px ${BODY_FONT}`;
  g.fillText(sub, 64, 120, 116);
  g.beginPath();
  g.moveTo(10, 256);
  g.lineTo(64, 215);
  g.lineTo(118, 256);
  g.fillStyle = '#05060c';
  g.fill();
  return toTexture(c);
}

// -------------------------------------------------------------- jumbotron
export function createJumbotronCanvas() {
  const c = makeCanvas(512, 288);
  const tex = toTexture(c);
  const g = c.getContext('2d');
  let last = '';
  function draw(s) {
    const key = JSON.stringify(s);
    if (s.logo) {
      if (key === last) return;
      last = key;
      g.fillStyle = '#151320';
      g.fillRect(0, 0, 512, 288);
      drawRetracLogo(g, 256, 120, 76);
      g.fillStyle = '#ff7a1a';
      g.font = `40px ${TITLE_FONT}`;
      g.textAlign = 'center';
      g.fillText(s.sub || 'ARENA', 256, 205);
      tex.needsUpdate = true;
      return;
    }
    if (key === last) return;
    last = key;
    g.fillStyle = '#04050a';
    g.fillRect(0, 0, 512, 288);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    if (s.message) {
      const grd = g.createLinearGradient(0, 0, 512, 288);
      grd.addColorStop(0, '#ff7a1a');
      grd.addColorStop(1, '#ff2d55');
      g.fillStyle = grd;
      g.fillRect(0, 0, 512, 288);
      g.fillStyle = '#fff';
      g.font = `58px ${TITLE_FONT}`;
      g.fillText(s.message, 256, 125, 480);
      if (s.sub) {
        g.font = `44px ${BODY_FONT}`;
        g.fillText(s.sub, 256, 200, 480);
      }
      tex.needsUpdate = true;
      return;
    }
    // team panels
    const panel = (x, col, abbr, score) => {
      g.fillStyle = col;
      g.fillRect(x, 20, 220, 70);
      g.fillStyle = '#fff';
      g.font = `48px ${TITLE_FONT}`;
      g.fillText(abbr, x + 110, 58);
      g.fillStyle = '#ffd60a';
      g.font = `110px ${BODY_FONT}`;
      g.fillText(String(score), x + 110, 168);
    };
    panel(24, s.homeColor || '#333', s.home || 'HOME', s.hs ?? 0);
    panel(268, s.awayColor || '#333', s.away || 'AWAY', s.as ?? 0);
    g.fillStyle = '#ff3b30';
    g.font = `62px ${BODY_FONT}`;
    g.fillText(s.clock || '0:00', 256, 250);
    g.fillStyle = '#fff';
    g.font = `40px ${BODY_FONT}`;
    g.fillText(s.period || '', 70, 250);
    g.fillStyle = '#ffd60a';
    g.fillText(s.shot != null ? String(s.shot) : '', 442, 250);
    tex.needsUpdate = true;
  }
  return { texture: tex, draw };
}
