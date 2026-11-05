import * as THREE from 'three';
import { JUMPER } from '../game/shooting.js';

const $ = (id) => document.getElementById(id);
const _v = new THREE.Vector3();

export class Hud {
  constructor() {
    this.el = $('hud');
    this.scorebug = $('scorebug');
    this.sb = {
      home: $('sb-home'), away: $('sb-away'), hs: $('sb-hs'), as: $('sb-as'),
      period: $('sb-period'), clock: $('sb-clock'), shot: $('sb-shot'),
      hc: $('sb-hc'), ac: $('sb-ac'), ph: $('sb-poss-h'), pa: $('sb-poss-a'),
    };
    this.popupEl = $('popup');
    this.toastsEl = $('toasts');
    this.meterEl = $('meter');
    this.meterFill = $('meter-fill');
    this.meterGreen = $('meter-green');
    this.meterMark = $('meter-mark');
    this.meterLabel = $('meter-label');
    this.meterContest = $('meter-contest');
    this.hintsEl = $('hints');
    this.staminaEl = $('stamina');
    this.staminaFill = $('stamina-fill');
    this.arcadeEl = $('arcadebar');
    this.tutEl = $('tutorial');
    this.introEl = $('intro-card');
    this.captionEl = $('caption');
    this.noticeEl = $('notice');
    this.viewBtn = $('view-btn');
    this.lookHint = $('look-hint');
    this.crosshair = $('crosshair');
    this.cache = {};
    this.showHints = true;
  }

  show(on) {
    this.el.classList.toggle('hidden', !on);
    if (!on) {
      this.caption(null);
      this.setLookHint(false);
      this.meterEl.classList.add('hidden');
      this.popupEl.className = '';
      this.popupEl.textContent = '';
    }
  }

  mode(m) {
    // 'match' | 'arcade' | 'tutorial' | 'none'
    this.scorebug.classList.toggle('hidden', m !== 'match');
    this.arcadeEl.classList.toggle('hidden', m !== 'arcade');
    this.tutEl.classList.toggle('hidden', m !== 'tutorial');
    this.staminaEl.classList.toggle('hidden', m === 'none');
    this.cache = {};
  }

  set(key, el, value, prop = 'textContent') {
    if (this.cache[key] === value) return;
    this.cache[key] = value;
    el[prop] = value;
  }

  setScorebug(s) {
    const sb = this.sb;
    this.set('home', sb.home, s.home);
    this.set('away', sb.away, s.away);
    this.set('hs', sb.hs, String(s.hs));
    this.set('as', sb.as, String(s.as));
    this.set('period', sb.period, s.period);
    this.set('clock', sb.clock, s.clock);
    this.set('shot', sb.shot, String(s.shot));
    if (this.cache.hc !== s.homeColor) {
      this.cache.hc = s.homeColor;
      sb.hc.style.background = s.homeColor;
    }
    if (this.cache.ac !== s.awayColor) {
      this.cache.ac = s.awayColor;
      sb.ac.style.background = s.awayColor;
    }
    if (this.cache.poss !== s.poss) {
      this.cache.poss = s.poss;
      sb.ph.classList.toggle('on', s.poss === 0);
      sb.pa.classList.toggle('on', s.poss === 1);
    }
    const low = typeof s.shot === 'number' && s.shot <= 5;
    if (this.cache.low !== low) {
      this.cache.low = low;
      sb.shot.classList.toggle('low', low);
    }
  }

  popup(text, cls = '') {
    const el = this.popupEl;
    el.className = '';
    void el.offsetWidth; // restart animation
    el.textContent = text;
    el.className = `show ${cls}`;
  }

  toast(text, cls = '') {
    const t = document.createElement('div');
    t.className = `toast ${cls}`;
    t.textContent = text;
    this.toastsEl.appendChild(t);
    while (this.toastsEl.children.length > 3) this.toastsEl.firstChild.remove();
    setTimeout(() => t.remove(), 2200);
  }

  // Play-by-play line at the bottom of the screen.
  caption(text) {
    clearTimeout(this.captionTimer);
    if (!text) {
      this.captionEl.classList.remove('show');
      return;
    }
    this.captionEl.innerHTML = `<b>&#9654;</b>${text}`;
    this.captionEl.classList.add('show');
    this.captionTimer = setTimeout(() => this.captionEl.classList.remove('show'), 2600);
  }

  notice(text) {
    const el = this.noticeEl;
    el.className = '';
    void el.offsetWidth;
    el.textContent = text;
    el.className = 'show';
  }

  setView(name, show = true) {
    this.viewBtn.classList.toggle('hidden', !show);
    $('view-name').textContent = name;
  }

  setCrosshair(show) {
    this.crosshair.classList.toggle('hidden', !show);
  }

  setLookHint(show) {
    if (this.cache.lookHint === show) return;
    this.cache.lookHint = show;
    this.lookHint.classList.toggle('hidden', !show);
  }

  shotFeedback(label, grade) {
    this.meterLabel.textContent = label;
    this.meterLabel.className = grade || '';
  }

  setHints(list) {
    if (!this.showHints) {
      this.set('hints', this.hintsEl, '', 'innerHTML');
      return;
    }
    const html = list.map(([k, v]) => `<span><kbd>${k}</kbd>${v}</span>`).join('');
    this.set('hints', this.hintsEl, html, 'innerHTML');
  }

  setStamina(v) {
    const w = `${Math.round(v * 100)}%`;
    this.set('stam', this.staminaFill.style, w, 'width');
    const low = v < 0.25;
    if (this.cache.stamLow !== low) {
      this.cache.stamLow = low;
      this.staminaEl.classList.toggle('low', low);
    }
  }

  setArcade(o) {
    this.set('a-title', $('ab-title'), o.title);
    this.set('a-score', $('ab-score'), String(o.score));
    this.set('a-time', $('ab-time'), o.time);
    this.set('a-info', $('ab-info'), o.info);
  }

  setTutorial(o) {
    $('tut-step').textContent = `STEP ${o.index + 1} / ${o.total}`;
    $('tut-title').textContent = o.title;
    $('tut-text').innerHTML = o.text;
    $('tut-skip').classList.toggle('hidden', !!o.final);
    const bar = $('tut-progress');
    bar.style.width = `${((o.index + 1) / o.total) * 100}%`;
    this.tutEl.classList.remove('pop');
    void this.tutEl.offsetWidth;
    this.tutEl.classList.add('pop');
  }

  introCard(title, sub, html = false) {
    const el = this.introEl;
    if (!title) {
      el.className = 'hidden';
      return;
    }
    el.className = '';
    void el.offsetWidth;
    if (html) $('intro-title').innerHTML = title;
    else $('intro-title').textContent = title;
    $('intro-sub').textContent = sub || '';
    el.className = 'show';
  }

  // Shot meter floats beside the shooter.
  updateMeter(meter, camera, w, h, fixed = false) {
    const el = this.meterEl;
    if (!meter) {
      if (!this.cache.meterHidden) {
        el.classList.add('hidden');
        this.cache.meterHidden = true;
      }
      return;
    }
    if (this.cache.meterHidden !== false) {
      el.classList.remove('hidden');
      this.cache.meterHidden = false;
      this.meterLabel.textContent = '';
      this.meterLabel.className = '';
    }
    const p = meter.player;
    let x, y;
    if (fixed) {
      // First person: the shooter is the camera, so pin the meter beside the crosshair area.
      x = w * 0.5 + 110;
      y = h * 0.5 - 60;
    } else {
      _v.set(p.pos.x, p.y + p.height * 0.75, p.pos.z).project(camera);
      x = (_v.x * 0.5 + 0.5) * w + 46;
      y = (-_v.y * 0.5 + 0.5) * h - 70;
    }
    el.style.transform = `translate(${x.toFixed(0)}px, ${y.toFixed(0)}px)`;
    const scale = JUMPER.autoRelease;
    const fill = Math.min(1, meter.value / scale);
    this.meterFill.style.height = `${(fill * 100).toFixed(1)}%`;
    const g0 = Math.max(0, (meter.sweet - meter.w) / scale);
    const g1 = Math.min(1, (meter.sweet + meter.w) / scale);
    this.meterGreen.style.bottom = `${(g0 * 100).toFixed(1)}%`;
    this.meterGreen.style.height = `${((g1 - g0) * 100).toFixed(1)}%`;
    this.meterMark.style.bottom = `${((meter.sweet / scale) * 100).toFixed(1)}%`;
    const cls = meter.done ? `done ${meter.grade}` : '';
    if (this.cache.meterCls !== cls) {
      this.cache.meterCls = cls;
      el.className = cls;
    }
    el.style.opacity = meter.done ? Math.min(1, meter.fade * 2).toFixed(2) : '1';
    const c = meter.contest;
    const ct = c > 0.45 ? 'SMOTHERED' : c > 0.2 ? 'CONTESTED' : c < 0.04 ? 'WIDE OPEN' : 'OPEN';
    this.set('contest', this.meterContest, ct);
    const ccls = c > 0.2 ? 'bad' : c < 0.04 ? 'good' : '';
    if (this.cache.ccls !== ccls) {
      this.cache.ccls = ccls;
      this.meterContest.className = ccls;
    }
  }
}
