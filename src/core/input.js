// Keyboard + gamepad input mapped to game actions.

const KEYMAP = {
  up: ['KeyW', 'ArrowUp'],
  down: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  sprint: ['ShiftLeft', 'ShiftRight'],
  shoot: ['Space', 'KeyJ'],
  pass: ['KeyE', 'KeyK'],
  move: ['KeyQ', 'KeyL'],
  pause: ['Escape', 'KeyP'],
  camera: ['KeyC'],
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
    this.axis = { x: 0, y: 0 };
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
    for (const a of Object.keys(KEYMAP)) {
      this.down[a] = false;
      this.prev[a] = false;
    }
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

    let x = (this.down.right ? 1 : 0) - (this.down.left ? 1 : 0);
    let y = (this.down.up ? 1 : 0) - (this.down.down ? 1 : 0);
    if (pad) {
      const ax = pad.axes[0] || 0;
      const ay = -(pad.axes[1] || 0);
      if (Math.hypot(ax, ay) > 0.2) {
        x = ax;
        y = ay;
        this.lastDevice = 'gamepad';
      }
    }
    const len = Math.hypot(x, y);
    if (len > 1) { x /= len; y /= len; }
    this.axis.x = x;
    this.axis.y = y;

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
