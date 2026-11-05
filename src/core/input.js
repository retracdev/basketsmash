// Keyboard + mouse + gamepad input mapped to game actions.

const KEYMAP = {
  up: ['KeyW', 'ArrowUp'],
  down: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  sprint: ['ShiftLeft', 'ShiftRight'],
  shoot: ['Space', 'KeyJ', 'Mouse0'],
  pass: ['KeyE', 'KeyK', 'Mouse2'],
  move: ['KeyQ', 'KeyL'],
  pause: ['Escape', 'KeyP'],
  camera: ['KeyC', 'KeyV'],
  confirm: ['Enter', 'NumpadEnter'],
  skip: ['Tab'],
};

// Standard gamepad mapping.
const PADMAP = {
  shoot: [0], // A
  move: [1], // B
  pass: [2], // X
  camera: [3], // Y
  sprint: [7, 5, 6], // RT, RB, LT
  pause: [9], // Start
  skip: [8], // Back
  confirm: [0],
  up: [12],
  down: [13],
  left: [14],
  right: [15],
};

class Input {
  constructor() {
    this.keys = new Set();
    this.down = {};
    this.prev = {};
    this.axis = { x: 0, y: 0 }; // classic: WASD + all arrows + left stick
    this.povAxis = { x: 0, y: 0 }; // first person: WASD + up/down arrows + left stick
    this.turn = 0; // first person: left/right arrows + right stick (-1..1, + = turn right)
    this.lookY = 0; // right stick vertical
    this.mouse = { dx: 0, dy: 0 };
    this.pointerLocked = false;
    this.anyPressed = false;
    this.lastDevice = 'keyboard';
    this._rawPressed = false;
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space' || e.code === 'Tab' || e.code.startsWith('Arrow')) {
        if (!(e.target instanceof HTMLInputElement)) e.preventDefault();
      }
      this.keys.add(e.code);
      this._rawPressed = true;
      this.lastDevice = 'keyboard';
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    // Mouse buttons only count as game input while the pointer is captured,
    // so clicking menus never shoots or passes.
    window.addEventListener('mousedown', (e) => {
      if (this.pointerLocked) this.keys.add(`Mouse${e.button}`);
    });
    window.addEventListener('mouseup', (e) => this.keys.delete(`Mouse${e.button}`));
    window.addEventListener('mousemove', (e) => {
      if (!this.pointerLocked) return;
      this.mouse.dx += e.movementX || 0;
      this.mouse.dy += e.movementY || 0;
    });
    window.addEventListener('contextmenu', (e) => {
      if (this.pointerLocked) e.preventDefault();
    });
    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = !!document.pointerLockElement;
      if (!this.pointerLocked) {
        this.keys.delete('Mouse0');
        this.keys.delete('Mouse2');
      }
    });
    for (const a of Object.keys(KEYMAP)) {
      this.down[a] = false;
      this.prev[a] = false;
    }
  }

  requestPointerLock(el) {
    if (!this.pointerLocked && el.requestPointerLock) {
      try {
        const r = el.requestPointerLock();
        if (r && r.catch) r.catch(() => {});
      } catch {
        /* not allowed right now */
      }
    }
  }

  releasePointerLock() {
    if (document.pointerLockElement && document.exitPointerLock) document.exitPointerLock();
  }

  // Mouse movement accumulated since the last call.
  takeMouse() {
    const m = { dx: this.mouse.dx, dy: this.mouse.dy };
    this.mouse.dx = 0;
    this.mouse.dy = 0;
    return m;
  }

  // Call once per frame before game logic.
  update() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let pad = null;
    for (const gp of pads) if (gp && gp.connected) { pad = gp; break; }

    for (const a of Object.keys(KEYMAP)) {
      this.prev[a] = this.down[a];
      let d = KEYMAP[a].some((k) => this.keys.has(k));
      if (pad && PADMAP[a]) {
        if (PADMAP[a].some((b) => pad.buttons[b] && (pad.buttons[b].pressed || pad.buttons[b].value > 0.4))) {
          d = true;
          this.lastDevice = 'gamepad';
        }
      }
      this.down[a] = d;
    }

    const k = (c) => (this.keys.has(c) ? 1 : 0);
    let x = (this.down.right ? 1 : 0) - (this.down.left ? 1 : 0);
    let y = (this.down.up ? 1 : 0) - (this.down.down ? 1 : 0);
    let px = k('KeyD') - k('KeyA');
    let py = k('KeyW') + k('ArrowUp') - k('KeyS') - k('ArrowDown');
    let turn = k('ArrowRight') - k('ArrowLeft');
    let lookY = 0;
    if (pad) {
      const ax = pad.axes[0] || 0;
      const ay = -(pad.axes[1] || 0);
      if (Math.hypot(ax, ay) > 0.2) {
        x = px = ax;
        y = py = ay;
        this.lastDevice = 'gamepad';
      }
      const rx = pad.axes[2] || 0;
      const ry = pad.axes[3] || 0;
      if (Math.abs(rx) > 0.2) turn = rx;
      if (Math.abs(ry) > 0.2) lookY = -ry;
    }
    const norm = (o, a, b) => {
      const len = Math.hypot(a, b);
      o.x = len > 1 ? a / len : a;
      o.y = len > 1 ? b / len : b;
    };
    norm(this.axis, x, y);
    norm(this.povAxis, px, Math.max(-1, Math.min(1, py)));
    this.turn = Math.max(-1, Math.min(1, turn));
    this.lookY = lookY;

    this.anyPressed = this._rawPressed || Object.keys(this.down).some((a) => this.down[a] && !this.prev[a]);
    this._rawPressed = false;
  }

  held(a) {
    return this.down[a];
  }
  pressed(a) {
    return this.down[a] && !this.prev[a];
  }
  released(a) {
    return !this.down[a] && this.prev[a];
  }
  // Swallow an action so it doesn't also trigger gameplay this frame.
  consume(a) {
    this.prev[a] = this.down[a];
  }
}

export const input = new Input();
