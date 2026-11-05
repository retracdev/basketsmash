import '@fontsource/bungee';
import '@fontsource/teko/400.css';
import '@fontsource/teko/600.css';
import '@fontsource/space-grotesk/700.css';
import './styles.css';
import * as THREE from 'three';
import { Arena } from './world/arena.js';
import { Particles } from './world/particles.js';
import { ViewModel } from './entities/viewmodel.js';
import { CameraRig } from './game/camera.js';
import { Match } from './game/match.js';
import { Arcade } from './game/arcade.js';
import { Tutorial } from './game/tutorial.js';
import { Hud } from './ui/hud.js';
import { Menus } from './ui/menus.js';
import { input } from './core/input.js';
import { audio } from './core/audio.js';
import { storage } from './core/storage.js';
import { initTabBranding } from './core/tab-branding.js';
import { initAccountWelcome } from './ui/account-welcome.js';
import { LEADERBOARDS, submitCompletedScore } from './core/leaderboards.js';

async function loadFonts() {
  if (!document.fonts) return;
  const wait = Promise.all([
    document.fonts.load('40px Bungee'),
    document.fonts.load('40px Teko'),
    document.fonts.load('600 40px Teko'),
    document.fonts.load('700 40px "Space Grotesk"'),
  ]);
  await Promise.race([wait, new Promise((r) => setTimeout(r, 2500))]).catch(() => {});
}

// Fly-through path: starts up in the rafters, sweeps past the jumbotron,
// dives under one hoop and lands on the broadcast camera position.
const INTRO_POS = [
  [34, 21, 26], [20, 17, 16], [4, 15.5, 9], [-12, 10, 9], [-18, 4.5, 3],
  [-15.6, 3.2, -1.5], [-8, 2.4, -5], [0, 3.5, 8], [0, 9.6, 18.8],
];
const INTRO_LOOK = [
  [0, 8, 0], [0, 12, 0], [0, 14, 0], [-10, 4, 0], [-12.75, 3.05, 0],
  [-12.75, 3.05, 0], [0, 1.5, 0], [0, 1.2, 0], [0, 0.9, 0.6],
];
const INTRO_LEN = 9.5;

const VIEWS = ['pov', 'third', 'court'];
const VIEW_NAMES = { pov: 'FIRST PERSON', third: 'THIRD PERSON', court: 'COURT' };

class App {
  async init() {
    initAccountWelcome();
    initTabBranding((inactive) => audio.setMuted(inactive));
    await loadFonts();
    this.settings = storage.settings;
    const q = this.settings.quality;
    const dpr = window.devicePixelRatio || 1;
    this.renderer = new THREE.WebGLRenderer({
      canvas: document.getElementById('game'),
      antialias: q === 'high',
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(q === 'low' ? Math.min(0.75, dpr) : q === 'medium' ? Math.min(1, dpr) : Math.min(2, dpr));
    if (q === 'high') {
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    }

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x07080f);
    this.scene.fog = new THREE.Fog(0x07080f, 45, 140);
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 300);
    this.scene.add(this.camera); // the camera carries the first-person hands
    this.viewmodel = new ViewModel(this.camera);
    this.arena = new Arena(this.renderer, q);
    this.scene.add(this.arena.group);
    this.particles = new Particles(q === 'low' ? 400 : 800);
    this.scene.add(this.particles.points);
    this.rig = new CameraRig(this.camera);
    this.hud = new Hud();
    this.menus = new Menus(this);
    this.world = null;
    this.state = 'title';
    this.applySettings();
    this.arena.setSpotlights(true, [0xff7a1a, 0x4aa3ff]);
    audio.onCaption = (text) => this.hud.caption(text);

    // First person: click the game to capture the mouse for looking around.
    const canvas = this.renderer.domElement;
    canvas.addEventListener('click', () => {
      if (this.state === 'play' && this.rig.usesLook) input.requestPointerLock(canvas);
    });
    document.addEventListener('pointerlockchange', () => {
      // Browsers release the mouse on Esc; treat that as a pause request.
      if (!document.pointerLockElement && this.state === 'play' && !this.intentUnlock) this.pause();
      this.intentUnlock = false;
    });
    document.getElementById('view-btn').addEventListener('click', () => this.toggleView());
    this.wasFullscreen = !!document.fullscreenElement;
    document.addEventListener('fullscreenchange', () => {
      const active = !!document.fullscreenElement;
      const exited = this.wasFullscreen && !active;
      this.wasFullscreen = active;
      if (exited && !this.fullscreenBusy && ['play', 'intro', 'paused'].includes(this.state)) {
        this.fullscreenResumePending = true;
        this.suppressPause = true;
        this.pause();
      }
    });

    this.resize();
    window.addEventListener('resize', () => this.resize());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.pause();
    });
    // Audio must start from a real user gesture.
    const unlock = () => audio.init();
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);

    this.menus.show('title');
    const load = document.getElementById('loading');
    load.classList.add('fade');
    setTimeout(() => load.remove(), 600);

    this.last = performance.now();
    this.renderer.setAnimationLoop((t) => this.frame(t));
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  applySettings(key) {
    const s = storage.settings;
    audio.setVolumes({ music: s.music, sfx: s.sfx, crowd: s.crowd });
    audio.announcer = s.announcer;
    this.hud.showHints = s.hints;
    this.rig.autoLook = s.autoLook;
    if (key === 'announcer' && !s.announcer) audio.clearCommentary();
    if (key === 'view' && this.world && this.state !== 'intro') this.applyView();
    if (key === 'difficulty' && this.world) this.world.difficulty = s.difficulty;
  }

  // ------------------------------------------------------------- view
  // First person (default) or the mode's court camera (broadcast / behind the shooter).
  applyView(snap = false) {
    const w = this.world;
    if (!w || !w.user) return;
    const view = VIEWS.includes(storage.settings.view) ? storage.settings.view : 'pov';
    const pov = view === 'pov';
    this.rig.setMode(pov ? 'pov' : view === 'third' ? 'third' : w.courtView || 'broadcast', snap);
    w.user.setFirstPerson(pov);
    this.viewmodel.setPlayer(w.user);
    this.viewmodel.setVisible(pov);
    this.hud.setView(VIEW_NAMES[view], true);
    this.hud.setCrosshair(pov);
    if (view === 'court') this.unlockMouse();
  }

  // C / VIEW button cycles: first person -> third person -> court.
  toggleView() {
    if (!this.world || this.state === 'intro') return;
    const cur = VIEWS.indexOf(storage.settings.view);
    const next = VIEWS[(Math.max(0, cur) + 1) % VIEWS.length];
    storage.setSetting('view', next);
    this.applyView();
    this.hud.toast(`${VIEW_NAMES[next]} VIEW`);
    audio.ui('tick');
  }

  unlockMouse() {
    if (document.pointerLockElement) {
      this.intentUnlock = true;
      input.releasePointerLock();
    }
  }

  // ------------------------------------------------------------- flow
  offerFullscreen(onContinue) {
    this.unlockMouse();
    this.clearWorld();
    this.state = 'menu';
    this.rig.setMode('menu');
    this.menus.show('fullscreen', { onContinue });
  }

  async chooseFullscreen(enabled) {
    if (this.fullscreenBusy) return;
    const screen = this.menus.screen;
    if (screen !== 'fullscreen' && screen !== 'fullscreenExit') return;
    const data = this.menus.data;
    this.fullscreenBusy = true;
    try {
      if (enabled && !document.fullscreenElement) {
        if (!document.documentElement.requestFullscreen) {
          throw new Error('unsupported');
        }
        await document.documentElement.requestFullscreen();
      } else if (!enabled && document.fullscreenElement) {
        await document.exitFullscreen();
      }
      storage.setSetting('fullscreen', enabled);
      // Do not replay an Esc press that the browser used to exit fullscreen.
      input.consume('pause');
      if (screen === 'fullscreenExit') this.resume(true);
      else data.onContinue();
    } catch {
      this.menus.show(screen, {
        ...data,
        error: enabled
          ? 'Fullscreen could not start. Try the button again, or choose to play without fullscreen.'
          : 'Fullscreen could not close. Try the button again.',
      });
    } finally {
      this.fullscreenBusy = false;
    }
  }

  leaveTitle() {
    audio.init();
    audio.playMusic('menu');
    audio.setCrowd(0.5);
    audio.ui('select');
    this.state = 'menu';
    this.menus.show('main');
  }

  clearWorld() {
    this.fullscreenResumePending = false;
    if (this.world) {
      this.world.dispose();
      this.world = null;
    }
    this.hud.show(false);
    this.hud.setView('', false);
    this.hud.setCrosshair(false);
    this.viewmodel.setVisible(false);
    this.hud.introCard(null);
    document.getElementById('skip-hint').classList.add('hidden');
  }

  startMatch(cfg, ready = false) {
    if (!ready) return this.offerFullscreen(() => this.startMatch(cfg, true));
    this.clearWorld();
    this.lastMatch = cfg;
    this.menus.hide();
    const m = new Match(this, cfg);
    this.world = m;
    const home = cfg.home, away = m.teams[1].data;
    this.arena.setCrowdColors(home.primary, away.primary);
    this.arena.setBenchColors(home.primary, away.primary);
    this.arena.setLedColors(home.primary, away.primary);
    this.arena.setSpotlights(true, [home.primary, away.primary, 0xffffff]);
    this.arena.jumboDraw({ logo: true, sub: `${home.abbr} vs ${away.abbr}` });
    m.userEnabled = false;
    m.onFinished = (res) => {
      if (this.world !== m || this.state !== 'play' || m.phase !== 'final') return;
      this.finishMatch(res, m);
    };

    this.hud.show(true);
    this.hud.mode('none');
    this.hud.setHints([]);
    this.state = 'intro';
    this.introT = 0;
    this.introCues = new Set();
    audio.playMusic('intro');
    audio.setCrowd(1.4);
    audio.cheer(1, 3);
    document.getElementById('skip-hint').classList.remove('hidden');
    this.rig.playIntro(INTRO_POS, INTRO_LOOK, INTRO_LEN, () => this.beginMatchPlay());
  }

  introTimeline(dt) {
    this.introT += dt;
    const t = this.introT;
    const m = this.world;
    const home = m.teams[0].data, away = m.teams[1].data;
    const cue = (name, at, fn) => {
      if (t >= at && !this.introCues.has(name)) {
        this.introCues.add(name);
        fn();
      }
    };
    cue('welcome', 0.2, () => {
      this.hud.introCard('<span class="rs-logo"><span class="a">retrac</span><span class="b">.space</span></span> ARENA', 'WELCOME TO', true);
      audio.commentary('Welcome to the retrac.space Arena!', { force: true });
    });
    cue('teams', 3.4, () => {
      this.hud.introCard(`${home.abbr}  VS  ${away.abbr}`, `${home.city.toUpperCase()} ${home.name.toUpperCase()} vs ${away.city.toUpperCase()} ${away.name.toUpperCase()}`);
      audio.commentary(`Tonight, the ${away.city} ${away.name} take on your ${home.city} ${home.name}!`);
      this.arena.cheer(0.7);
    });
    cue('pyro', 6.0, () => {
      audio.boom();
      audio.cheer(1.5, 3);
      this.arena.cheer(1);
      this.rig.shake(0.25);
    });
    if (t > 6.0 && t < 8.0) {
      const cols = [home.primary, away.primary, 0xffd60a, 0xffffff];
      for (const [x, z] of [[-15.5, -8.8], [-15.5, 8.8], [15.5, -8.8], [15.5, 8.8]]) {
        this.particles.emit(new THREE.Vector3(x, 0.4, z), 2, { colors: cols, speed: 0.6, up: 11, gravity: 8, life: 1.6, size: 0.22, jitter: 0.3 });
      }
    }
    cue('letsplay', 7.4, () => {
      this.hud.introCard("LET'S PLAY!", `YOU ARE #${m.user.data.num} ${m.user.name.toUpperCase()}`);
    });
  }

  beginMatchPlay() {
    const m = this.world;
    if (!(m instanceof Match)) return;
    this.state = 'play';
    this.hud.introCard(null);
    document.getElementById('skip-hint').classList.add('hidden');
    this.arena.setSpotlights(false);
    audio.playMusic('game', 0.45);
    audio.setCrowd(1);
    this.hud.mode('match');
    m.userEnabled = true;
    m.startTipoff();
    this.applyView(true);
  }

  finishMatch(res, match) {
    this.unlockMouse();
    storage.recordGame({ won: res.won, points: res.user ? res.user.pts : 0 });
    this.state = 'results';
    this.hud.show(false);
    audio.playMusic('menu', 0.8);
    this.menus.show('results', res);
    submitCompletedScore(match, 'play-game', res.home.score,
      (state) => this.menus.updateScoreSubmission(res, state));
  }

  rematch() {
    if (this.lastMatch) this.startMatch(this.lastMatch);
  }

  startArcade(cfg, ready = false) {
    if (!ready) return this.offerFullscreen(() => this.startArcade(cfg, true));
    this.clearWorld();
    this.lastArcade = cfg;
    this.menus.hide();
    const a = new Arcade(this, { ...cfg, difficulty: storage.settings.difficulty });
    this.world = a;
    this.arena.setCrowdColors(cfg.team.primary, 0xff7a1a);
    this.arena.setLedColors(cfg.team.primary, 0xffd60a);
    this.arena.setSpotlights(false);
    this.arena.jumboDraw({ message: a.def.title, sub: `#${cfg.player.num} ${cfg.player.name.toUpperCase()}` });
    a.onFinished = (res) => {
      if (this.world !== a || this.state !== 'play' || !a.ended || !a.started) return;
      this.unlockMouse();
      const record = res.mode !== 'practice' && storage.submitRecord(res.mode, res.score);
      this.state = 'results';
      this.hud.show(false);
      if (record) {
        audio.cheer(1.5, 3);
        audio.commentary('A new record!', { force: true });
      }
      const result = { ...res, record };
      this.menus.show('arcadeResults', result);
      const board = LEADERBOARDS.find((b) => b.mode === a.mode);
      if (board) submitCompletedScore(a, board.id, res.score,
        (state) => this.menus.updateScoreSubmission(result, state));
    };
    this.hud.show(true);
    this.hud.mode('arcade');
    this.state = 'play';
    this.applyView(true);
    audio.playMusic('game', 0.4);
    audio.setCrowd(0.7);
  }

  replayArcade() {
    if (this.lastArcade) this.startArcade(this.lastArcade);
  }

  startTutorial(ready = false) {
    if (!ready) return this.offerFullscreen(() => this.startTutorial(true));
    this.clearWorld();
    this.menus.hide();
    const t = new Tutorial(this);
    this.world = t;
    this.arena.setSpotlights(false);
    this.arena.jumboDraw({ message: 'TUTORIAL', sub: 'BASKETSMASH ACADEMY' });
    t.onFinished = () => {
      storage.markTutorialDone();
      audio.commentary("You're ready. Let's play!", { force: true });
      this.quitToMenu();
    };
    this.hud.show(true);
    this.hud.mode('tutorial');
    this.state = 'play';
    this.applyView(true);
    audio.playMusic('game', 0.35);
    audio.setCrowd(0.4);
  }

  pause() {
    if (this.state !== 'play' && this.state !== 'intro') return;
    this.pausedState = this.state;
    this.unlockMouse();
    this.state = 'paused';
    audio.setMusicLevel(0.15);
    audio.clearCommentary();
    this.menus.show('pause');
  }

  resume(fullscreenChoice = false) {
    if (this.state !== 'paused') return;
    if (this.menus.screen === 'fullscreenExit' && !fullscreenChoice) return;
    if (this.fullscreenResumePending && !document.fullscreenElement && !fullscreenChoice) {
      this.menus.show('fullscreenExit');
      return;
    }
    this.fullscreenResumePending = false;
    this.menus.hide();
    this.state = this.pausedState || 'play';
    audio.setMusicLevel(this.state === 'intro' ? 1 : this.world instanceof Match ? 0.45 : 0.4);
  }

  quitToMenu(showMain = true) {
    this.unlockMouse();
    this.clearWorld();
    this.state = 'menu';
    this.rig.setMode('menu');
    audio.clearCommentary();
    if (audio.trackName !== 'menu' || !audio.track) audio.playMusic('menu');
    audio.setCrowd(0.5);
    this.arena.setSpotlights(true, [0xff7a1a, 0x4aa3ff]);
    this.arena.setLedColors(0xff7a1a, 0x1d6bff);
    this.arena.jumboDraw({ logo: true, sub: 'ARENA' });
    this.arena.exciteTarget = 0;
    if (showMain) this.menus.show('main');
  }

  // ------------------------------------------------------------- loop
  frame(now) {
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    input.update();
    // Esc leaving fullscreen must not also dismiss the pause menu it just opened.
    if (this.suppressPause) {
      input.consume('pause');
      this.suppressPause = input.held('pause');
    }
    const w = this.world;

    switch (this.state) {
      case 'title':
      case 'menu':
      case 'results':
        if (this.state !== 'results') this.rig.mode = 'menu';
        this.menus.update(dt);
        break;
      case 'intro':
        this.introTimeline(dt);
        if (w) w.update(dt);
        if (this.introT > 0.7 && input.anyPressed) {
          audio.clearCommentary();
          this.rig.skipIntro();
        }
        break;
      case 'play':
        if (input.pressed('pause')) {
          this.pause();
          break;
        }
        if (input.pressed('camera')) this.toggleView();
        if (w) w.update(dt * w.timeScale);
        break;
      case 'paused':
        this.menus.update(dt);
        break;
    }

    const ctx = w && w.cameraContext ? w.cameraContext() : {};
    this.rig.update(this.state === 'paused' ? 0 : dt, ctx);
    this.arena.update(dt);
    this.particles.update(dt);
    const playing = this.state === 'play' && !!w;
    this.hud.updateMeter(playing ? w.meter : null, this.camera, window.innerWidth, window.innerHeight, this.rig.isPov);
    this.hud.setLookHint(playing && this.rig.usesLook && this.rig.autoLook === 'off' && !input.pointerLocked && input.lastDevice !== 'gamepad');
    // First person: the held ball is drawn by the hands, not the hidden body.
    if (w && w.user) {
      const fp = this.rig.isPov && this.viewmodel.group.visible;
      for (const b of w.balls) b.mesh.visible = !(fp && b.holder === w.user);
      if (fp) {
        this.camera.updateMatrixWorld();
        this.viewmodel.update(this.state === 'play' ? dt : 0, w.user);
      }
    }
    this.renderer.render(this.scene, this.camera);
  }
}

new App().init();
