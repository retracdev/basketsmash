// Fully procedural audio: music sequencer, arena crowd, sound effects and announcer.
// Nothing is sampled, so there are no licensing concerns.

const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

// Note names to MIDI for readability in track definitions.
const N = {};
['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'].forEach((n, i) => {
  for (let o = 0; o < 8; o++) N[n + o] = 12 * (o + 1) + i;
});

const chord = (root, type) => {
  const iv = { m7: [0, 3, 7, 10], maj7: [0, 4, 7, 11], 7: [0, 4, 7, 10], m: [0, 3, 7], M: [0, 4, 7], sus: [0, 5, 7], m9: [0, 3, 7, 10, 14] }[type];
  return iv.map((x) => root + x);
};

// Patterns: 16 steps per bar. x = hit, o = accent/open, . = rest
const TRACKS = {
  menu: {
    bpm: 92,
    swing: 0.12,
    bars: 4,
    kick: 'x.....x...x..x..',
    snare: '....x.......x...',
    hat: 'x.x.x.x.x.x.x.xo',
    chords: [chord(N.A3, 'm7'), chord(N.F3, 'maj7'), chord(N.D3, 'm7'), chord(N.E3, '7')],
    stab: '..x....x..x.....',
    bass: [
      [N.A1, 0, 3], [N.A1, 6, 2], [N.C2, 10, 2], [N.E2, 13, 2],
    ],
    lead: [N.E5, null, N.G5, null, N.A5, null, null, N.G5, N.E5, null, N.D5, null, N.C5, null, N.A4, null],
    leadEvery: 2,
  },
  game: {
    bpm: 104,
    swing: 0.08,
    bars: 4,
    kick: 'x...x...x...x..x',
    snare: '....x.......x...',
    hat: '..x...x...x...xo',
    chords: [chord(N.D3, 'm7'), chord(N.D3, 'm7'), chord(N.A2 + 1, 'maj7'), chord(N.C3, '7')],
    stab: 'x.......x.x.....',
    bass: [
      [N.D2, 0, 2], [N.D2, 3, 1], [N.F2, 6, 2], [N.D2, 10, 1], [N.C2, 12, 2], [N.A1, 14, 2],
    ],
    lead: null,
  },
  intro: {
    bpm: 128,
    swing: 0,
    bars: 4,
    kick: 'x...x...x...x...',
    snare: '....x.......x.xx',
    hat: 'xxxxxxxxxxxxxxxo',
    chords: [chord(N.C3, 'M'), chord(N.G2 + 12, 'M'), chord(N.A3 - 12, 'm'), chord(N.F3, 'M')],
    stab: 'x..x..x...x.x...',
    brass: true,
    bass: [
      [N.C2, 0, 3], [N.C2, 4, 2], [N.C2, 8, 3], [N.C2, 12, 2],
    ],
    lead: [N.G4, null, null, N.C5, null, null, N.E5, null, N.G5, null, null, null, N.E5, null, N.G5, null],
    leadEvery: 1,
  },
};

class AudioEngine {
  constructor() {
    this.ctx = null;
    this.vol = { music: 0.6, sfx: 0.8, crowd: 0.7 };
    this.track = null;
    this.step = 0;
    this.nextTime = 0;
    this.announcer = true;
    this.lastSpeak = 0;
    this.excite = 0;
  }

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createDynamicsCompressor();
    this.master.threshold.value = -14;
    this.master.ratio.value = 4;
    this.master.connect(ctx.destination);

    this.musicBus = ctx.createGain();
    this.sfxBus = ctx.createGain();
    this.crowdBus = ctx.createGain();
    this.musicBus.connect(this.master);
    this.sfxBus.connect(this.master);
    this.crowdBus.connect(this.master);
    this.applyVolumes();

    // Shared noise buffer.
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    this.startCrowd();
    this.timer = setInterval(() => this.schedule(), 25);
  }

  setVolumes(v) {
    Object.assign(this.vol, v);
    this.applyVolumes();
  }

  applyVolumes() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.musicBus.gain.setTargetAtTime(this.vol.music * 0.55, t, 0.1);
    this.sfxBus.gain.setTargetAtTime(this.vol.sfx, t, 0.05);
    this.crowdBus.gain.setTargetAtTime(this.vol.crowd, t, 0.1);
  }

  get now() {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  // ---------------------------------------------------------------- music
  playMusic(name, level = 1) {
    if (!this.ctx) return;
    const t = this.now;
    this.musicLevel = level;
    if (this.trackGain) {
      const old = this.trackGain;
      old.gain.setTargetAtTime(0, t, 0.25);
      setTimeout(() => old.disconnect(), 1500);
    }
    if (!name) {
      this.track = null;
      this.trackGain = null;
      return;
    }
    this.track = TRACKS[name];
    this.trackName = name;
    this.trackGain = this.ctx.createGain();
    this.trackGain.gain.value = 0;
    this.trackGain.gain.setTargetAtTime(level, t, 0.3);
    this.trackGain.connect(this.musicBus);
    this.step = 0;
    this.nextTime = t + 0.08;
  }

  setMusicLevel(level) {
    if (this.trackGain) this.trackGain.gain.setTargetAtTime(level, this.now, 0.4);
  }

  schedule() {
    if (!this.ctx || !this.track) return;
    const tr = this.track;
    const stepDur = 60 / tr.bpm / 4;
    while (this.nextTime < this.now + 0.12) {
      const s = this.step % 16;
      const bar = Math.floor(this.step / 16) % tr.bars;
      const loop = Math.floor(this.step / (16 * tr.bars));
      const swing = s % 2 === 1 ? tr.swing * stepDur : 0;
      const t = this.nextTime + swing;
      const out = this.trackGain;

      if (tr.kick[s] !== '.') this.kick(t, out);
      if (tr.snare[s] !== '.') this.snare(t, out, tr.snare[s] === 'x' ? 1 : 0.6);
      if (tr.hat[s] !== '.') this.hat(t, out, tr.hat[s] === 'o');
      if (tr.stab[s] !== '.') {
        const notes = tr.chords[bar];
        if (tr.brass) this.brass(t, notes, stepDur * 2.5, out);
        else this.stab(t, notes, stepDur * 1.6, out);
      }
      for (const [note, at, len] of tr.bass) {
        if (at === s) {
          const shift = tr.chords[bar][0] - tr.chords[0][0];
          this.bass(t, note + shift, stepDur * len, out);
        }
      }
      if (tr.lead && loop % tr.leadEvery === tr.leadEvery - 1) {
        const n = tr.lead[s];
        if (n) this.lead(t, n + (bar % 2 === 1 ? -2 : 0), stepDur * 1.8, out);
      }
      this.nextTime += stepDur;
      this.step++;
    }
  }

  // ------------------------------------------------------------ instruments
  env(g, t, a, peak, d) {
    peak = Math.max(peak, 0.0002);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }

  noiseSrc(t, dur) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise;
    s.start(t, Math.random() * 1.5, dur + 0.05);
    return s;
  }

  kick(t, out, vol = 0.9) {
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    this.env(g, t, 0.003, vol, 0.32);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + 0.4);
  }

  snare(t, out, vol = 1) {
    const n = this.noiseSrc(t, 0.22);
    const f = this.ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 1400;
    const g = this.ctx.createGain();
    this.env(g, t, 0.002, 0.35 * vol, 0.18);
    n.connect(f).connect(g).connect(out);
    const o = this.ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(220, t);
    o.frequency.exponentialRampToValueAtTime(120, t + 0.08);
    const g2 = this.ctx.createGain();
    this.env(g2, t, 0.002, 0.25 * vol, 0.1);
    o.connect(g2).connect(out);
    o.start(t);
    o.stop(t + 0.15);
  }

  hat(t, out, open) {
    const dur = open ? 0.22 : 0.045;
    const n = this.noiseSrc(t, dur);
    const f = this.ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 7500;
    const g = this.ctx.createGain();
    this.env(g, t, 0.001, open ? 0.12 : 0.09, dur);
    n.connect(f).connect(g).connect(out);
  }

  bass(t, midi, dur, out) {
    const o = this.ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = mtof(midi);
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.Q.value = 6;
    f.frequency.setValueAtTime(1100, t);
    f.frequency.exponentialRampToValueAtTime(220, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.32, t + 0.01);
    g.gain.setValueAtTime(0.32, t + dur * 0.8);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.05);
    o.connect(f).connect(g).connect(out);
    o.start(t);
    o.stop(t + dur + 0.1);
  }

  stab(t, notes, dur, out) {
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(2400, t);
    f.frequency.exponentialRampToValueAtTime(600, t + dur);
    const g = this.ctx.createGain();
    this.env(g, t, 0.005, 0.07, dur);
    f.connect(g).connect(out);
    for (const n of notes) {
      for (const det of [-6, 6]) {
        const o = this.ctx.createOscillator();
        o.type = 'square';
        o.frequency.value = mtof(n + 12);
        o.detune.value = det;
        o.connect(f);
        o.start(t);
        o.stop(t + dur + 0.05);
      }
    }
  }

  brass(t, notes, dur, out) {
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(400, t);
    f.frequency.exponentialRampToValueAtTime(3200, t + 0.08);
    f.frequency.exponentialRampToValueAtTime(900, t + dur);
    const g = this.ctx.createGain();
    this.env(g, t, 0.02, 0.06, dur);
    f.connect(g).connect(out);
    for (const n of notes) {
      for (const det of [-9, 0, 9]) {
        const o = this.ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = mtof(n + 12);
        o.detune.value = det;
        o.connect(f);
        o.start(t);
        o.stop(t + dur + 0.05);
      }
    }
  }

  lead(t, midi, dur, out) {
    const o = this.ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = mtof(midi);
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 5.5;
    const lg = this.ctx.createGain();
    lg.gain.value = 6;
    lfo.connect(lg).connect(o.detune);
    const g = this.ctx.createGain();
    this.env(g, t, 0.01, 0.12, dur);
    o.connect(g).connect(out);
    o.start(t);
    lfo.start(t);
    o.stop(t + dur + 0.05);
    lfo.stop(t + dur + 0.05);
  }

  // ------------------------------------------------------------------ crowd
  startCrowd() {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 850;
    bp.Q.value = 0.5;
    this.crowdGain = ctx.createGain();
    this.crowdGain.gain.value = 0.0;
    src.connect(bp).connect(this.crowdGain).connect(this.crowdBus);
    src.start();

    // Slow random swell so the murmur feels alive.
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.23;
    const lg = ctx.createGain();
    lg.gain.value = 0.02;
    lfo.connect(lg).connect(this.crowdGain.gain);
    lfo.start();
    this.crowdBase = 0;
  }

  setCrowd(level) {
    if (!this.ctx) return;
    this.crowdBase = level;
    this.crowdGain.gain.setTargetAtTime(0.09 * level, this.now, 0.6);
  }

  cheer(intensity = 1, dur = 2.2) {
    if (!this.ctx) return;
    const t = this.now;
    const n = this.noiseSrc(t, dur + 0.5);
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 0.7;
    f.frequency.setValueAtTime(700, t);
    f.frequency.linearRampToValueAtTime(1500, t + 0.4);
    f.frequency.linearRampToValueAtTime(1000, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.35 * intensity, t + 0.25);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    n.connect(f).connect(g).connect(this.crowdBus);
    // A few "whoo" voices on top.
    for (let i = 0; i < 5 * intensity; i++) {
      const o = this.ctx.createOscillator();
      o.type = 'sawtooth';
      const st = t + Math.random() * 0.5;
      const base = 500 + Math.random() * 400;
      o.frequency.setValueAtTime(base, st);
      o.frequency.linearRampToValueAtTime(base * 1.4, st + 0.3);
      o.frequency.linearRampToValueAtTime(base * 0.9, st + 1.0);
      const lp = this.ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 1400;
      const vg = this.ctx.createGain();
      this.env(vg, st, 0.08, 0.012 * intensity, 1.0);
      o.connect(lp).connect(vg).connect(this.crowdBus);
      o.start(st);
      o.stop(st + 1.2);
    }
  }

  ooh() {
    if (!this.ctx) return;
    const t = this.now;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(500, t);
    lp.frequency.linearRampToValueAtTime(900, t + 0.5);
    const g = this.ctx.createGain();
    this.env(g, t, 0.15, 0.06, 1.2);
    lp.connect(g).connect(this.crowdBus);
    for (let i = 0; i < 10; i++) {
      const o = this.ctx.createOscillator();
      o.type = 'sawtooth';
      const f0 = 150 + Math.random() * 180;
      o.frequency.setValueAtTime(f0, t);
      o.frequency.linearRampToValueAtTime(f0 * 0.82, t + 1.3);
      o.connect(lp);
      o.start(t);
      o.stop(t + 1.5);
    }
  }

  clapChant() {
    if (!this.ctx) return;
    const t0 = this.now;
    const beats = [0, 0.4, 0.8, 1.0, 1.2];
    for (let r = 0; r < 2; r++) {
      for (const b of beats) {
        const t = t0 + r * 1.8 + b;
        const n = this.noiseSrc(t, 0.08);
        const f = this.ctx.createBiquadFilter();
        f.type = 'bandpass';
        f.frequency.value = 1300;
        f.Q.value = 0.8;
        const g = this.ctx.createGain();
        this.env(g, t, 0.003, 0.18, 0.09);
        n.connect(f).connect(g).connect(this.crowdBus);
      }
    }
  }

  // ------------------------------------------------------------------- sfx
  tone(type, f0, f1, dur, vol, t = this.now, out = this.sfxBus) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = this.ctx.createGain();
    this.env(g, t, 0.004, vol, dur);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  noiseHit(freq, type, q, dur, vol, t = this.now) {
    const n = this.noiseSrc(t, dur);
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = this.ctx.createGain();
    this.env(g, t, 0.003, vol, dur);
    n.connect(f).connect(g).connect(this.sfxBus);
  }

  bounce(vol = 1) {
    if (!this.ctx || vol < 0.03) return;
    vol = Math.min(1, vol);
    this.tone('sine', 120, 55, 0.14, 0.55 * vol);
    this.noiseHit(900, 'lowpass', 0.7, 0.04, 0.2 * vol);
  }

  swish() {
    if (!this.ctx) return;
    const t = this.now;
    const n = this.noiseSrc(t, 0.4);
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 1.2;
    f.frequency.setValueAtTime(5000, t);
    f.frequency.exponentialRampToValueAtTime(2200, t + 0.35);
    const g = this.ctx.createGain();
    this.env(g, t, 0.02, 0.45, 0.35);
    n.connect(f).connect(g).connect(this.sfxBus);
  }

  rim(vol = 1) {
    if (!this.ctx) return;
    vol = Math.min(1, vol);
    const t = this.now;
    for (const [f, a, d] of [[420, 0.25, 0.35], [1130, 0.16, 0.25], [1790, 0.1, 0.18], [2650, 0.06, 0.12]]) {
      this.tone('triangle', f, f * 0.98, d, a * vol, t);
    }
    this.noiseHit(3000, 'bandpass', 2, 0.03, 0.2 * vol, t);
  }

  board(vol = 1) {
    if (!this.ctx) return;
    vol = Math.min(1, vol);
    this.tone('sine', 190, 120, 0.18, 0.4 * vol);
    this.noiseHit(400, 'lowpass', 1, 0.12, 0.35 * vol);
  }

  catchBall() {
    if (!this.ctx) return;
    this.noiseHit(600, 'lowpass', 1, 0.05, 0.25);
    this.tone('sine', 160, 90, 0.06, 0.2);
  }

  squeak() {
    if (!this.ctx) return;
    const f = 1800 + Math.random() * 900;
    const t = this.now;
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(f, t);
    o.frequency.linearRampToValueAtTime(f * 1.25, t + 0.06);
    o.frequency.linearRampToValueAtTime(f * 0.95, t + 0.12);
    const g = this.ctx.createGain();
    this.env(g, t, 0.01, 0.05, 0.12);
    o.connect(g).connect(this.sfxBus);
    o.start(t);
    o.stop(t + 0.2);
  }

  buzzer() {
    if (!this.ctx) return;
    const t = this.now;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.22, t + 0.02);
    g.gain.setValueAtTime(0.22, t + 1.0);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.15);
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 1800;
    f.connect(g).connect(this.sfxBus);
    for (const [type, fr] of [['sawtooth', 196], ['square', 198.5], ['sawtooth', 392]]) {
      const o = this.ctx.createOscillator();
      o.type = type;
      o.frequency.value = fr;
      o.connect(f);
      o.start(t);
      o.stop(t + 1.2);
    }
  }

  whistle() {
    if (!this.ctx) return;
    const t = this.now;
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = 2900;
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 38;
    const lg = this.ctx.createGain();
    lg.gain.value = 140;
    lfo.connect(lg).connect(o.frequency);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.18, t + 0.02);
    g.gain.setValueAtTime(0.18, t + 0.38);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
    o.connect(g).connect(this.sfxBus);
    o.start(t);
    lfo.start(t);
    o.stop(t + 0.5);
    lfo.stop(t + 0.5);
  }

  horn() {
    if (!this.ctx) return;
    const t = this.now;
    for (const [fr, st] of [[233, 0], [233, 0.22], [311, 0.44]]) {
      this.tone('sawtooth', fr, fr, 0.2, 0.12, t + st);
      this.tone('square', fr * 1.5, fr * 1.5, 0.2, 0.05, t + st);
    }
  }

  perfect() {
    if (!this.ctx) return;
    const t = this.now;
    this.tone('sine', 1318, 1318, 0.25, 0.18, t);
    this.tone('sine', 1975, 1975, 0.35, 0.14, t + 0.06);
  }

  meterTick() {
    if (!this.ctx) return;
    this.tone('square', 660, 660, 0.03, 0.04);
  }

  steal() {
    if (!this.ctx) return;
    this.noiseHit(2500, 'bandpass', 1.5, 0.12, 0.3);
    this.tone('sine', 300, 140, 0.1, 0.25);
  }

  whoosh() {
    if (!this.ctx) return;
    const t = this.now;
    const n = this.noiseSrc(t, 0.3);
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 2;
    f.frequency.setValueAtTime(400, t);
    f.frequency.exponentialRampToValueAtTime(2500, t + 0.25);
    const g = this.ctx.createGain();
    this.env(g, t, 0.08, 0.2, 0.2);
    n.connect(f).connect(g).connect(this.sfxBus);
  }

  slam() {
    if (!this.ctx) return;
    this.rim(1);
    this.tone('sine', 90, 35, 0.4, 0.6);
    this.noiseHit(250, 'lowpass', 1, 0.3, 0.5);
  }

  boom() {
    if (!this.ctx) return;
    this.tone('sine', 70, 30, 0.8, 0.7);
    this.noiseHit(180, 'lowpass', 0.8, 0.9, 0.6);
  }

  ui(kind = 'hover') {
    if (!this.ctx) return;
    const t = this.now;
    if (kind === 'hover') this.tone('square', 880, 990, 0.04, 0.035, t);
    else if (kind === 'select') {
      this.tone('square', 660, 660, 0.06, 0.06, t);
      this.tone('square', 990, 990, 0.08, 0.06, t + 0.06);
    } else if (kind === 'back') this.tone('square', 520, 330, 0.1, 0.05, t);
    else if (kind === 'tick') this.tone('square', 1200, 1200, 0.02, 0.04, t);
  }

  // -------------------------------------------------------------- announcer
  announce(text, { force = false, rate = 1.05, pitch = 0.75 } = {}) {
    if (!this.announcer || !('speechSynthesis' in window)) return;
    const now = performance.now();
    if (!force && now - this.lastSpeak < 3500) return;
    this.lastSpeak = now;
    const synth = window.speechSynthesis;
    if (force) synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const voices = synth.getVoices();
    const v =
      voices.find((x) => /en/i.test(x.lang) && /male|david|daniel|guy|fred|alex/i.test(x.name)) ||
      voices.find((x) => /en/i.test(x.lang));
    if (v) u.voice = v;
    u.rate = rate;
    u.pitch = pitch;
    u.volume = Math.min(1, this.vol.sfx + 0.1);
    synth.speak(u);
  }

  stopSpeech() {
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  }
}

export const audio = new AudioEngine();
