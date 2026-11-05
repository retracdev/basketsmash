import * as THREE from 'three';

// Small pooled CPU particle system (sparks, confetti, fire trail).
export class Particles {
  constructor(max = 700) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.baseSize = new Float32Array(max);
    this.next = 0;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        attribute float size;
        attribute vec3 color;
        varying vec3 vColor;
        void main() {
          vColor = color;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * (420.0 / max(0.1, -mv.z));
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vColor;
        void main() {
          vec2 d = gl_PointCoord - 0.5;
          float a = smoothstep(0.5, 0.1, length(d));
          if (a < 0.01) discard;
          gl_FragColor = vec4(vColor * a, a);
        }`,
    });
    this.points = new THREE.Points(g, mat);
    this.points.frustumCulled = false;
  }

  emit(p, count, o = {}) {
    const color = new THREE.Color(o.color ?? 0xffaa33);
    const colors = o.colors ? o.colors.map((c) => new THREE.Color(c)) : null;
    const speed = o.speed ?? 4;
    const spread = o.spread ?? 1;
    const up = o.up ?? 2;
    for (let n = 0; n < count; n++) {
      const i = this.next;
      this.next = (this.next + 1) % this.max;
      this.pos[i * 3] = p.x + (Math.random() - 0.5) * (o.jitter ?? 0.1);
      this.pos[i * 3 + 1] = p.y + (Math.random() - 0.5) * (o.jitter ?? 0.1);
      this.pos[i * 3 + 2] = p.z + (Math.random() - 0.5) * (o.jitter ?? 0.1);
      const th = Math.random() * Math.PI * 2;
      const r = Math.random() * spread;
      this.vel[i * 3] = Math.cos(th) * r * speed + (o.vx ?? 0);
      this.vel[i * 3 + 1] = (Math.random() * 0.5 + 0.5) * up + (o.vy ?? 0);
      this.vel[i * 3 + 2] = Math.sin(th) * r * speed + (o.vz ?? 0);
      const c = colors ? colors[Math.floor(Math.random() * colors.length)] : color;
      this.col[i * 3] = c.r;
      this.col[i * 3 + 1] = c.g;
      this.col[i * 3 + 2] = c.b;
      const life = (o.life ?? 1) * (0.6 + Math.random() * 0.6);
      this.life[i] = life;
      this.maxLife[i] = life;
      this.grav[i] = o.gravity ?? 6;
      this.baseSize[i] = (o.size ?? 0.15) * (0.6 + Math.random() * 0.8);
      this.size[i] = this.baseSize[i];
    }
  }

  update(dt) {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) {
        this.size[i] = 0;
        continue;
      }
      this.life[i] -= dt;
      this.vel[i * 3 + 1] -= this.grav[i] * dt;
      this.vel[i * 3] *= 1 - dt * 0.8;
      this.vel[i * 3 + 2] *= 1 - dt * 0.8;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      if (this.pos[i * 3 + 1] < 0.02) {
        this.pos[i * 3 + 1] = 0.02;
        this.vel[i * 3 + 1] *= -0.3;
      }
      this.size[i] = this.baseSize[i] * Math.max(0, this.life[i] / this.maxLife[i]);
    }
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.size.needsUpdate = true;
    g.attributes.color.needsUpdate = true;
  }
}
