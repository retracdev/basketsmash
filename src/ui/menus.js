import { TEAMS, overall, teamRatings, heightLabel } from '../data/teams.js';
import { hexToCss, clamp } from '../core/utils.js';
import { storage } from '../core/storage.js';
import { audio } from '../core/audio.js';
import { input } from '../core/input.js';
import { DIFF } from '../game/shooting.js';

const BALL = '<span class="bball"></span>';
const LOGO = '<span class="rs-logo"><span class="a">retrac</span><span class="b">.space</span></span>';

function lum(hex) {
  const r = (hex >> 16) & 255, g = (hex >> 8) & 255, b = hex & 255;
  return 0.299 * r + 0.587 * g + 0.114 * b;
}
const ink = (hex) => (lum(hex) > 170 ? '#10131f' : '#ffffff');
function shade(hex, f) {
  const r = Math.round(((hex >> 16) & 255) * f), g = Math.round(((hex >> 8) & 255) * f), b = Math.round((hex & 255) * f);
  return `rgb(${r},${g},${b})`;
}
const statColor = (v) => (v >= 85 ? '#30e070' : v >= 72 ? '#ffd60a' : v >= 60 ? '#ff9a3a' : '#ff5a4a');

function btn(act, label, { sub = '', cls = '', arg = '', badge = '', focus = false } = {}) {
  return `<button class="btn nav ${cls}" data-act="${act}" data-arg="${arg}" ${focus ? 'data-focus' : ''}>${cls.includes('center') ? '' : BALL}<span class="label">${label}${sub ? `<span class="sub">${sub}</span>` : ''}</span>${badge ? `<span class="badge">${badge}</span>` : ''}</button>`;
}

function seg(key, options, value) {
  return `<div class="seg nav" data-seg="${key}">${options
    .map(([v, l]) => `<button data-v="${v}" class="${String(v) === String(value) ? 'on' : ''}">${l}</button>`)
    .join('')}</div>`;
}

function teamCard(t, i, extra = '', cls = '') {
  const r = teamRatings(t);
  return `<button class="card nav ${cls}" data-act="team" data-arg="${i}" style="background:linear-gradient(135deg, ${hexToCss(t.primary)} 0%, ${shade(t.primary, 0.62)} 100%);color:${ink(t.primary)}">
    <div class="abbr">${t.abbr}</div>
    <div class="city">${t.city}</div>
    <div class="tname">${t.name.toUpperCase()}</div>
    <div class="ovr">${r.ovr}<small>OVR</small></div>
    <div class="ratings">OFF ${r.off} · DEF ${r.def}</div>
    <div class="stripe" style="background:${hexToCss(t.secondary)};border-top:3px solid ${hexToCss(t.accent)}"></div>
    ${extra}
  </button>`;
}

function playerCard(t, p, i) {
  const stats = [['SPD', p.spd], ['SHT', p.sht], ['3PT', p.thr], ['DNK', p.dnk], ['PAS', p.pas], ['DEF', p.def]];
  return `<button class="pcard nav" data-act="player" data-arg="${i}">
    <div class="top" style="background:linear-gradient(135deg, ${hexToCss(t.primary)}, ${shade(t.primary, 0.6)});color:${ink(t.primary)}">
      <div class="num">#${p.num}</div>
      <div class="posh"><b>${overall(p)}</b>OVR<br>${p.pos} · ${heightLabel(p.h)}</div>
    </div>
    <div class="pname">${p.name.toUpperCase()}</div>
    ${stats.map(([k, v]) => `<div class="stat"><span>${k}</span><span class="bar"><i style="width:${v}%;background:${statColor(v)}"></i></span><span>${v}</span></div>`).join('')}
  </button>`;
}

export class Menus {
  constructor(app) {
    this.app = app;
    this.root = document.getElementById('menu');
    this.screen = null;
    this.data = {};
    this.focus = 0;
    this.navCd = 0;
    this.root.addEventListener('click', (e) => this.onClick(e));
    // Keep DOM focus off buttons so Enter isn't handled twice (native click + our nav).
    this.root.addEventListener('mousedown', (e) => {
      if (e.target.closest('button')) e.preventDefault();
    });
    this.root.addEventListener('mouseover', (e) => {
      const el = e.target.closest('.nav');
      if (el) {
        const list = this.navs();
        const i = list.indexOf(el);
        if (i >= 0 && i !== this.focus) {
          this.setFocus(i, false);
          audio.ui('hover');
        }
      }
    });
    this.root.addEventListener('input', (e) => {
      if (e.target.matches('input[type=range]')) this.onRange(e.target);
    });
  }

  get visible() {
    return !!this.screen;
  }

  // ------------------------------------------------------------ render
  show(name, data = {}) {
    this.screen = name;
    this.data = data;
    const html = this[`r_${name}`](data);
    this.root.innerHTML = `<div class="screen ${name === 'title' || name === 'main' ? 'vignette' : ''}">${html}</div>`;
    this.root.classList.toggle('dim', ['pause', 'fullscreenExit', 'results', 'arcadeResults', 'settings', 'howto'].includes(name) && this.app.state !== 'menu');
    this.focus = 0;
    const pre = this.root.querySelector('[data-focus]');
    const list = this.navs();
    if (pre) this.focus = Math.max(0, list.indexOf(pre));
    this.setFocus(this.focus, false);
    if (this[`after_${name}`]) this[`after_${name}`](data);
  }

  hide() {
    this.screen = null;
    this.root.innerHTML = '';
    this.root.classList.remove('dim');
  }

  navs() {
    return [...this.root.querySelectorAll('.nav')];
  }

  setFocus(i, scroll = true) {
    const list = this.navs();
    if (!list.length) return;
    this.focus = clamp(i, 0, list.length - 1);
    list.forEach((el, k) => el.classList.toggle('focus', k === this.focus));
    if (scroll) list[this.focus].scrollIntoView({ block: 'nearest' });
  }

  r_title() {
    return `<div style="display:flex;flex-direction:column;align-items:center">
      <div class="logo"><span class="l1">BASKET</span><span class="l2">SMASH</span><span class="bball logo-ball"></span></div>
      <div class="press-start">PRESS ANY KEY</div>
      <div class="title-foot">a ${LOGO} game</div>
    </div>`;
  }

  r_main() {
    const c = storage.career;
    const r = storage.records;
    const newb = !storage.tutorialDone;
    return `<div class="main-wrap">
      <div style="display:flex;flex-direction:column;align-items:center">
        <div class="logo"><span class="l1">BASKET</span><span class="l2">SMASH</span><span class="bball logo-ball"></span></div>
        <div class="career">
          RECORD <b>${c.wins}-${c.games - c.wins}</b> · CAREER PTS <b>${c.points}</b> · BEST GAME <b>${c.bestGame}</b><br>
          3PT SHOOTOUT <b>${r.shootout}</b> · WORLD <b>${r.world}</b> · HOT SPOTS <b>${r.hotspots}</b>
        </div>
        <div class="title-foot" style="position:static;margin-top:16px">${LOGO} ARENA</div>
      </div>
      <div class="board menu-col">
        <div class="board-title">MAIN MENU</div>
        ${btn('play', 'PLAY GAME', { sub: '3-ON-3 FULL COURT EXHIBITION' })}
        ${btn('arcade', 'ARCADE', { sub: 'SHOOTOUT · AROUND THE WORLD · HOT SPOTS' })}
        ${btn('tutorial', 'TUTORIAL', { sub: 'LEARN THE MOVES', badge: newb ? 'START HERE' : '' })}
        ${btn('howto', 'HOW TO PLAY', { sub: 'CONTROLS & SHOOTING', cls: 'dark' })}
        ${btn('settings', 'SETTINGS', { sub: 'AUDIO · CAMERA · GRAPHICS', cls: 'dark' })}
      </div>
    </div>`;
  }

  r_arcade() {
    const r = storage.records;
    const card = (mode, title, desc, best) => `<button class="mcard nav" data-act="arcadeMode" data-arg="${mode}">
      <h3>${title}</h3>${desc}${best != null ? `<div class="best">BEST: ${best}</div>` : '<div class="best">NO TIMER · JUST HOOPS</div>'}</button>`;
    return `<div class="board">
      <div class="board-title">ARCADE</div>
      <div class="modes">
        ${card('shootout', '3-POINT SHOOTOUT', '5 racks around the arc, 60 seconds. Last ball of each rack is a 2-point MONEY BALL.', r.shootout)}
        ${card('world', 'AROUND THE WORLD', 'Hit 7 spots around the rim, then 7 from downtown. Miss and you stay. Finish early for a time bonus.', r.world)}
        ${card('hotspots', 'HOT SPOTS', 'Free roam for 60 seconds. Shots from glowing hot spots count DOUBLE. 3 in a row and you catch fire.', r.hotspots)}
        ${card('practice', 'SHOOTAROUND', 'Free practice. Work on your release, layups and dunks with the ball machine.', null)}
      </div>
      <div class="btn-row">${btn('back', 'BACK', { cls: 'dark small center' })}</div>
    </div>`;
  }

  r_team(d) {
    const title = d.flow === 'arcade' ? 'PICK YOUR SHOOTER\'S TEAM' : 'CHOOSE YOUR TEAM';
    return `<div class="select-wrap board">
      <div class="board-title">${title}</div>
      <div class="team-grid">${TEAMS.map((t, i) => teamCard(t, i)).join('')}</div>
      <div class="hint-line"><kbd>ARROWS</kbd> move · <kbd>ENTER</kbd> select · <kbd>ESC</kbd> back</div>
    </div>`;
  }

  r_player(d) {
    const t = TEAMS[d.team];
    return `<div class="select-wrap board">
      <div class="board-title">${t.city.toUpperCase()} ${t.name.toUpperCase()} · CHOOSE YOUR PLAYER</div>
      <div class="roster">${t.players.map((p, i) => playerCard(t, p, i)).join('')}</div>
      <div class="hint-line">${d.flow === 'arcade' ? 'Your shooter\'s ratings affect every shot.' : 'You control this player. The two best remaining players start with you.'}</div>
      <div class="btn-row">${btn('back', 'BACK', { cls: 'dark small center' })}</div>
    </div>`;
  }

  r_matchup(d) {
    const s = storage.settings;
    const me = TEAMS[d.team];
    const p = me.players[d.player];
    const opp = TEAMS[d.opp];
    return `<div class="board">
      <div class="board-title">MATCHUP</div>
      <div class="matchup">
        <div class="side-col">
          <h3>YOUR TEAM</h3>
          ${teamCard(me, d.team, '', 'big').replace('class="card nav', 'class="card')}
          <div class="you-tag">YOU: #${p.num} ${p.name.toUpperCase()} · ${overall(p)} OVR</div>
        </div>
        <div class="vs">VS</div>
        <div class="side-col">
          <h3>OPPONENT</h3>
          <div id="opp-card">${teamCard(opp, d.opp, '', 'big').replace('class="card nav', 'class="card')}</div>
          <div style="display:flex;gap:10px">
            <button class="btn dark small center nav" data-act="oppPrev">◀</button>
            ${btn('randomOpp', 'RANDOM', { cls: 'dark small' })}
            <button class="btn dark small center nav" data-act="oppNext">▶</button>
          </div>
        </div>
      </div>
      <div class="opts">
        <label>QUARTER LENGTH</label>${seg('quarter', [[2, '2 MIN'], [3, '3 MIN'], [4, '4 MIN'], [5, '5 MIN']], s.quarter)}
        <label>DIFFICULTY</label>${seg('difficulty', DIFF.names.map((n, i) => [i, n]), s.difficulty)}
      </div>
      <div class="btn-row">
        ${btn('back', 'BACK', { cls: 'dark small center' })}
        <button class="btn nav" data-act="tipoff" data-focus>${BALL}<span class="label">TIP OFF!</span></button>
      </div>
    </div>`;
  }

  after_matchup(d) {
    if (!d.spun) {
      d.spun = true;
      this.spinOpponent();
    }
  }

  r_settings() {
    const s = storage.settings;
    const range = (k) => `<input type="range" class="nav" min="0" max="1" step="0.05" value="${s[k]}" data-key="${k}" style="--v:${s[k] * 100}%">`;
    return `<div class="board">
      <div class="board-title">SETTINGS</div>
      <div class="settings">
        <label>MUSIC</label>${range('music')}
        <label>SOUND FX</label>${range('sfx')}
        <label>CROWD</label>${range('crowd')}
        <label>COMMENTARY</label>${seg('announcer', [[true, 'ON'], [false, 'OFF']], s.announcer)}
        <label>CONTROL HINTS</label>${seg('hints', [[true, 'ON'], [false, 'OFF']], s.hints)}
        <label>VIEW</label>${seg('view', [['pov', '1ST PERSON'], ['third', '3RD PERSON'], ['court', 'COURT']], s.view)}
        <label>AUTO CAMERA</label>${seg('autoLook', [['max', 'MAX'], ['on', 'ON'], ['off', 'OFF']], s.autoLook)}
        <label>GRAPHICS</label>${seg('quality', [['low', 'LOW'], ['medium', 'MEDIUM'], ['high', 'HIGH']], s.quality)}
        <label>DIFFICULTY</label>${seg('difficulty', DIFF.names.map((n, i) => [i, n]), s.difficulty)}
      </div>
      <div class="note">Auto Camera: MAX (default) turns and looks up/down to follow the rim or ball for trackpad play. ON uses gentle tracking with limited vertical movement. OFF gives full manual look. Manual look overrides assistance briefly.<br>Graphics changes apply after reload. Use LOW on older computers.</div>
      <div class="btn-row">${btn('back', 'DONE', { cls: 'small center' })}</div>
    </div>`;
  }

  r_howto() {
    return `<div class="board">
      <div class="board-title">HOW TO PLAY</div>
      <div class="howto">
        <div>
          <h4>OFFENSE</h4>
          <div class="ctrl">
            <div><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd></div><div>Move (or arrow keys)</div>
            <div><kbd>SHIFT</kbd></div><div>Sprint (uses stamina)</div>
            <div><kbd>SPACE</kbd></div><div>Hold to shoot, release at the top</div>
            <div><kbd>E</kbd></div><div>Pass (aim with movement keys)</div>
            <div><kbd>Q</kbd></div><div>Crossover - burst of speed, can break ankles</div>
            <div><kbd>E</kbd> no ball</div><div>Call for the ball (sprint to rim = alley-oop!)</div>
          </div>
          <h4 style="margin-top:16px">DEFENSE</h4>
          <div class="ctrl">
            <div><kbd>SPACE</kbd></div><div>Jump to block / rebound</div>
            <div><kbd>E</kbd></div><div>Steal - get close and face the ball</div>
            <div><kbd>Q</kbd> hold</div><div>Auto-guard your man</div>
          </div>
          <h4 style="margin-top:16px">OTHER</h4>
          <div class="ctrl">
            <div><kbd>C</kbd></div><div>Switch view: first person / third person / court (any time)</div>
            <div>AUTO CAMERA</div><div>MAX by default: turns and looks up/down for you. Settings: MAX / ON / OFF.</div>
            <div>MOUSE</div><div>1st/3rd person: click to look · left click shoot · right click pass</div>
            <div><kbd>&larr;</kbd><kbd>&rarr;</kbd></div><div>1st/3rd person: turn without a mouse</div>
            <div><kbd>ESC</kbd></div><div>Pause</div>
            <div>GAMEPAD</div><div>L-stick move · R-stick look · A shoot · X pass/steal · B crossover · RT sprint · Y view</div>
          </div>
        </div>
        <div>
          <h4>THE SHOT METER</h4>
          <div class="meter-demo">
            <div class="mbar"><i></i><b></b></div>
            <div>Hold <kbd>SPACE</kbd> and your player rises. The meter fills as you jump.
            Let go when it reaches the <b class="g">GREEN</b> zone at the top of your jump for a <b class="g">PERFECT</b> release.<br><br>
            Early releases fall short, late releases go long.</div>
          </div>
          <h4 style="margin-top:16px">WHAT CHANGES THE GREEN ZONE</h4>
          <div>· Player ratings (SHT for mid-range, 3PT from deep)<br>
          · Defenders close to you - look for WIDE OPEN shots<br>
          · Distance - deep heaves are tough<br>
          · Being ON FIRE (3 makes in a row) makes it bigger</div>
          <h4 style="margin-top:16px">AT THE RIM</h4>
          <div>Close to the hoop, <kbd>SPACE</kbd> does a layup. Sprint at the rim with a good dunker and it's a DUNK. Defenders can still block it!</div>
        </div>
      </div>
      <div class="btn-row">${btn('back', 'GOT IT', { cls: 'small center' })}</div>
    </div>`;
  }

  r_fullscreen(d) {
    return `<div class="board menu-col fullscreen-prompt" role="dialog" aria-modal="true" aria-labelledby="fullscreen-title" aria-describedby="fullscreen-description">
      <div class="board-title" id="fullscreen-title">Turn on fullscreen</div>
      <p id="fullscreen-description">Get the best experience by going fullscreen.</p>
      ${btn('fullscreenOn', 'Turn on fullscreen', { focus: storage.settings.fullscreen })}
      ${btn('fullscreenOff', 'Keep fullscreen off', { cls: 'dark', focus: !storage.settings.fullscreen })}
      <div class="note">Your choice is saved. We ask before each game.</div>
      <p class="fullscreen-error" role="status">${d.error || ''}</p>
    </div>`;
  }

  r_fullscreenExit(d) {
    return `<div class="board menu-col fullscreen-prompt" role="dialog" aria-modal="true" aria-labelledby="fullscreen-title" aria-describedby="fullscreen-description">
      <div class="board-title" id="fullscreen-title">You left fullscreen.</div>
      <p id="fullscreen-description">You left fullscreen mode. Do you want to enter fullscreen again, or play without it?</p>
      ${btn('fullscreenOn', 'Back into fullscreen', { focus: storage.settings.fullscreen })}
      ${btn('fullscreenOff', 'Turn off fullscreen', { cls: 'dark', focus: !storage.settings.fullscreen })}
      <p class="fullscreen-error" role="status">${d.error || ''}</p>
    </div>`;
  }

  r_pause() {
    return `<div class="board menu-col">
      <div class="board-title">PAUSED</div>
      ${btn('resume', 'RESUME')}
      ${btn('howto', 'HOW TO PLAY', { cls: 'dark' })}
      ${btn('settings', 'SETTINGS', { cls: 'dark' })}
      ${btn('quit', 'QUIT TO MENU', { cls: 'dark' })}
    </div>`;
  }

  r_results(d) {
    const { home, away, homeBox, awayBox, won } = d;
    const table = (team, rows) => `<table class="box">
      <caption style="color:${hexToCss(team.data.primary === 0x141414 ? 0xffffff : team.data.primary)}">${team.data.city.toUpperCase()} ${team.data.name.toUpperCase()}</caption>
      <tr><th>PLAYER</th><th>PTS</th><th>FG</th><th>3PT</th><th>REB</th><th>AST</th><th>STL</th><th>BLK</th></tr>
      ${rows.map((r) => `<tr class="${r.isUser ? 'me' : ''}"><td>#${r.num} ${r.name}${r.isUser ? ' (YOU)' : ''}</td><td>${r.pts}</td><td>${r.fgm}-${r.fga}</td><td>${r.tpm}-${r.tpa}</td><td>${r.reb}</td><td>${r.ast}</td><td>${r.stl}</td><td>${r.blk}</td></tr>`).join('')}
    </table>`;
    const abbr = (t) => `<span class="fs-abbr" style="background:${hexToCss(t.data.primary)};color:${ink(t.data.primary)}">${t.abbr}</span>`;
    return `<div class="board results">
      <div class="board-title">FINAL</div>
      <div class="final-score">
        <div class="fs-team">${abbr(home)}</div><div class="fs-num">${home.score}</div>
        <div class="dash">-</div>
        <div class="fs-num">${away.score}</div><div class="fs-team">${abbr(away)}</div>
      </div>
      <div class="verdict ${won ? 'win' : 'loss'}">${won ? 'VICTORY!' : 'DEFEAT'}</div>
      ${table(home, homeBox)}
      ${table(away, awayBox)}
      <div class="btn-row">
        <button class="btn nav" data-act="rematch" data-focus>${BALL}<span class="label">REMATCH</span></button>
        ${btn('newgame', 'NEW GAME', { cls: 'dark' })}
        ${btn('quit', 'MAIN MENU', { cls: 'dark' })}
      </div>
    </div>`;
  }

  r_arcadeResults(d) {
    const sub = d.mode === 'practice'
      ? `${d.made} / ${d.att} MADE · ${d.att ? Math.round((d.made / d.att) * 100) : 0}%`
      : `${d.made} / ${d.att} SHOTS MADE${d.bonus ? ` · TIME BONUS +${d.bonus}` : ''}`;
    return `<div class="board" style="min-width:520px">
      <div class="board-title">${d.title}</div>
      <div class="arcade-score">${d.mode === 'practice' ? d.made : d.score}</div>
      <div class="arcade-sub">${sub}</div>
      ${d.mode !== 'practice' ? `<div class="arcade-sub">BEST: ${storage.records[d.mode] ?? 0}</div>` : ''}
      ${d.record ? '<div class="record">NEW RECORD!</div>' : ''}
      <div class="btn-row">
        <button class="btn nav" data-act="again" data-focus>${BALL}<span class="label">PLAY AGAIN</span></button>
        ${btn('arcade', 'ARCADE MENU', { cls: 'dark' })}
        ${btn('quit', 'MAIN MENU', { cls: 'dark' })}
      </div>
    </div>`;
  }

  // ------------------------------------------------------------ actions
  onClick(e) {
    if (this.screen === 'title') {
      this.app.leaveTitle();
      return;
    }
    const segBtn = e.target.closest('.seg button');
    if (segBtn) {
      const segEl = segBtn.parentElement;
      this.setSeg(segEl, segBtn.dataset.v);
      return;
    }
    const el = e.target.closest('[data-act]');
    if (!el) return;
    this.act(el.dataset.act, el.dataset.arg, el);
  }

  act(act, arg) {
    if (this.app.fullscreenBusy) return;
    const app = this.app;
    const d = this.data;
    if (act === 'back') audio.ui('back');
    else audio.ui('select');
    switch (act) {
      case 'fullscreenOn':
      case 'fullscreenOff':
        app.chooseFullscreen(act === 'fullscreenOn');
        break;
      case 'play':
        this.show('team', { flow: 'match' });
        break;
      case 'arcade':
        if (app.state !== 'menu') app.quitToMenu(false);
        this.show('arcade');
        break;
      case 'arcadeMode':
        this.show('team', { flow: 'arcade', mode: arg });
        break;
      case 'tutorial':
        app.startTutorial();
        break;
      case 'howto':
        this.show('howto', { from: this.screen });
        break;
      case 'settings':
        this.show('settings', { from: this.screen });
        break;
      case 'team':
        this.show('player', { ...d, team: +arg });
        break;
      case 'player':
        if (d.flow === 'arcade') {
          app.startArcade({ mode: d.mode, team: TEAMS[d.team], player: TEAMS[d.team].players[+arg] });
        } else {
          let opp = Math.floor(Math.random() * (TEAMS.length - 1));
          if (opp >= d.team) opp++;
          this.show('matchup', { team: d.team, player: +arg, opp });
        }
        break;
      case 'oppPrev':
      case 'oppNext': {
        let o = d.opp;
        do o = (o + (act === 'oppNext' ? 1 : TEAMS.length - 1)) % TEAMS.length;
        while (o === d.team);
        d.opp = o;
        this.refreshOpp();
        break;
      }
      case 'randomOpp':
        this.spinOpponent();
        break;
      case 'tipoff':
        if (this.spinning) return;
        app.startMatch({
          home: TEAMS[d.team], away: TEAMS[d.opp], userIndex: d.player,
          quarter: storage.settings.quarter, difficulty: storage.settings.difficulty,
          teamIdx: d.team, oppIdx: d.opp,
        });
        break;
      case 'resume':
        app.resume();
        break;
      case 'quit':
        app.quitToMenu();
        break;
      case 'rematch':
        app.rematch();
        break;
      case 'newgame':
        app.quitToMenu(false);
        this.show('team', { flow: 'match' });
        break;
      case 'again':
        app.replayArcade();
        break;
      case 'back':
        this.back();
        break;
    }
  }

  back() {
    const s = this.screen;
    const d = this.data;
    const app = this.app;
    if (s === 'settings' || s === 'howto') {
      if (d.from === 'pause') this.show('pause');
      else this.show('main');
    } else if (s === 'arcade') this.show('main');
    else if (s === 'team') this.show(d.flow === 'arcade' ? 'arcade' : 'main');
    else if (s === 'player') this.show('team', { flow: d.flow, mode: d.mode });
    else if (s === 'matchup') this.show('player', { flow: 'match', team: d.team });
    else if (s === 'pause') app.resume();
  }

  refreshOpp() {
    const el = document.getElementById('opp-card');
    if (el) el.innerHTML = teamCard(TEAMS[this.data.opp], this.data.opp, '', 'big').replace('class="card nav', 'class="card');
  }

  spinOpponent() {
    if (this.spinning) return;
    this.spinning = true;
    const d = this.data;
    let n = 0;
    const total = 14 + Math.floor(Math.random() * 6);
    const step = () => {
      let o;
      do o = Math.floor(Math.random() * TEAMS.length);
      while (o === d.team || o === d.opp);
      d.opp = o;
      this.refreshOpp();
      const c = document.querySelector('#opp-card .card');
      audio.ui('tick');
      n++;
      if (n < total) {
        if (c) c.classList.add('spin');
        setTimeout(step, 50 + n * 9);
      } else {
        audio.horn();
        this.spinning = false;
      }
    };
    step();
  }

  setSeg(segEl, v) {
    const key = segEl.dataset.seg;
    [...segEl.children].forEach((b) => b.classList.toggle('on', b.dataset.v === v));
    let val = v;
    if (v === 'true') val = true;
    else if (v === 'false') val = false;
    else if (!isNaN(+v)) val = +v;
    storage.setSetting(key, val);
    this.app.applySettings(key);
    audio.ui('tick');
  }

  cycleSeg(segEl, dir) {
    const kids = [...segEl.children];
    const i = kids.findIndex((b) => b.classList.contains('on'));
    const n = kids[clamp(i + dir, 0, kids.length - 1)];
    if (n && n !== kids[i]) this.setSeg(segEl, n.dataset.v);
  }

  onRange(el) {
    const v = parseFloat(el.value);
    el.style.setProperty('--v', `${v * 100}%`);
    storage.setSetting(el.dataset.key, v);
    this.app.applySettings(el.dataset.key);
  }

  // ------------------------------------------------------------ input
  update(dt) {
    if (!this.screen) return;
    if (this.screen === 'title') {
      if (input.anyPressed) this.app.leaveTitle();
      return;
    }
    const list = this.navs();
    const cur = list[this.focus];
    this.navCd -= dt;
    let dx = 0, dy = 0;
    if (input.pressed('left')) dx = -1;
    else if (input.pressed('right')) dx = 1;
    else if (input.pressed('up')) dy = -1;
    else if (input.pressed('down')) dy = 1;
    else if (input.lastDevice === 'gamepad' && this.navCd <= 0 && Math.hypot(input.axis.x, input.axis.y) > 0.6) {
      if (Math.abs(input.axis.x) > Math.abs(input.axis.y)) dx = Math.sign(input.axis.x);
      else dy = -Math.sign(input.axis.y);
      this.navCd = 0.22;
    }
    if (cur && (dx || dy)) {
      if (dx && cur.classList.contains('seg')) {
        this.cycleSeg(cur, dx);
      } else if (dx && cur.matches('input[type=range]')) {
        cur.value = clamp(parseFloat(cur.value) + dx * 0.05, 0, 1);
        this.onRange(cur);
        audio.ui('tick');
      } else {
        const next = this.spatial(list, cur, dx, dy);
        if (next >= 0) {
          this.setFocus(next);
          audio.ui('hover');
        }
      }
    }
    if ((input.pressed('confirm') || input.pressed('shoot')) && cur) {
      if (cur.classList.contains('seg')) this.cycleSeg(cur, 1);
      else if (cur.dataset.act) this.act(cur.dataset.act, cur.dataset.arg, cur);
    }
    if (input.pressed('pause') || (input.lastDevice === 'gamepad' && input.pressed('move'))) {
      if (this.screen !== 'main' && this.screen !== 'results' && this.screen !== 'arcadeResults') this.back();
    }
  }

  spatial(list, cur, dx, dy) {
    const r0 = cur.getBoundingClientRect();
    const cx = r0.left + r0.width / 2, cy = r0.top + r0.height / 2;
    let best = -1, bestS = Infinity;
    list.forEach((el, i) => {
      if (el === cur) return;
      const r = el.getBoundingClientRect();
      const x = r.left + r.width / 2, y = r.top + r.height / 2;
      const px = (x - cx) * dx + (y - cy) * dy;
      if (px <= 4) return;
      const off = Math.abs(dx ? y - cy : x - cx);
      const s = px + off * 2.2;
      if (s < bestS) { bestS = s; best = i; }
    });
    return best;
  }
}
