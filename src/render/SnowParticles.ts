import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  NormalBlending,
  Points,
  ShaderMaterial,
  Vector3,
  type Texture,
} from 'three';

const VERT = /* glsl */ `
attribute float aSize;
attribute float aAlpha;
varying float vAlpha;
uniform float uScale;
void main() {
  vAlpha = aAlpha;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * uScale / max(0.1, -mv.z);
  gl_Position = projectionMatrix * mv;
}`;

const FRAG = /* glsl */ `
uniform sampler2D uMap;
uniform vec3 uColor;
varying float vAlpha;
void main() {
  vec4 t = texture2D(uMap, gl_PointCoord);
  gl_FragColor = vec4(uColor, t.a * vAlpha);
  if (gl_FragColor.a < 0.01) discard;
}`;

/**
 * Pooled snow spray particles (carving, braking, landings, crashes). Fixed-size typed arrays, no
 * allocation per particle; dead particles are recycled.
 */
export class SnowSpray {
  readonly points: Points;
  private readonly pos: Float32Array;
  private readonly vel: Float32Array;
  private readonly life: Float32Array;
  private readonly maxLife: Float32Array;
  private readonly size: Float32Array;
  private readonly alpha: Float32Array;
  private next = 0;
  private readonly material: ShaderMaterial;

  constructor(
    private readonly capacity: number,
    map: Texture,
  ) {
    this.pos = new Float32Array(capacity * 3);
    this.vel = new Float32Array(capacity * 3);
    this.life = new Float32Array(capacity);
    this.maxLife = new Float32Array(capacity);
    this.size = new Float32Array(capacity);
    this.alpha = new Float32Array(capacity);
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(this.pos, 3));
    geo.setAttribute('aSize', new BufferAttribute(this.size, 1));
    geo.setAttribute('aAlpha', new BufferAttribute(this.alpha, 1));
    this.material = new ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uMap: { value: map }, uColor: { value: new Vector3(1, 1, 1) }, uScale: { value: 300 } },
      transparent: true,
      depthWrite: false,
      blending: NormalBlending,
    });
    this.points = new Points(geo, this.material);
    this.points.frustumCulled = false;
  }

  setPixelScale(scale: number): void {
    this.material.uniforms.uScale.value = scale;
  }

  emit(
    origin: Vector3,
    baseVelocity: Vector3,
    count: number,
    spread: number,
    upward: number,
    sizeScale = 1,
  ): void {
    for (let n = 0; n < count; n++) {
      const i = this.next;
      this.next = (this.next + 1) % this.capacity;
      const k = i * 3;
      this.pos[k] = origin.x + (Math.random() - 0.5) * 0.3;
      this.pos[k + 1] = origin.y + Math.random() * 0.1;
      this.pos[k + 2] = origin.z + (Math.random() - 0.5) * 0.3;
      this.vel[k] = baseVelocity.x + (Math.random() - 0.5) * spread;
      this.vel[k + 1] = baseVelocity.y + Math.random() * upward;
      this.vel[k + 2] = baseVelocity.z + (Math.random() - 0.5) * spread;
      this.maxLife[i] = this.life[i] = 0.5 + Math.random() * 0.7;
      this.size[i] = (0.12 + Math.random() * 0.25) * sizeScale;
    }
  }

  update(dt: number): void {
    const drag = Math.exp(-2.2 * dt);
    for (let i = 0; i < this.capacity; i++) {
      if (this.life[i] <= 0) {
        this.alpha[i] = 0;
        continue;
      }
      this.life[i] -= dt;
      const k = i * 3;
      this.vel[k] *= drag;
      this.vel[k + 1] = this.vel[k + 1] * drag - 6 * dt;
      this.vel[k + 2] *= drag;
      this.pos[k] += this.vel[k] * dt;
      this.pos[k + 1] += this.vel[k + 1] * dt;
      this.pos[k + 2] += this.vel[k + 2] * dt;
      const t = this.life[i] / this.maxLife[i];
      this.alpha[i] = Math.max(0, t) * 0.85;
      this.size[i] += dt * 0.5;
    }
    const g = this.points.geometry;
    g.getAttribute('position').needsUpdate = true;
    g.getAttribute('aAlpha').needsUpdate = true;
    g.getAttribute('aSize').needsUpdate = true;
  }

  dispose(): void {
    this.points.geometry.dispose();
    this.material.dispose();
  }
}

/** Gentle ambient snowfall in a box that follows the camera (wraps around, no allocations). */
export class Snowfall {
  readonly points: Points;
  private readonly pos: Float32Array;
  private readonly material: ShaderMaterial;
  private readonly box = 40;
  private time = 0;

  constructor(
    private readonly count: number,
    map: Texture,
  ) {
    this.pos = new Float32Array(count * 3);
    const size = new Float32Array(count);
    const alpha = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      this.pos[i * 3] = (Math.random() - 0.5) * this.box;
      this.pos[i * 3 + 1] = (Math.random() - 0.5) * this.box;
      this.pos[i * 3 + 2] = (Math.random() - 0.5) * this.box;
      size[i] = 0.03 + Math.random() * 0.05;
      alpha[i] = 0.5 + Math.random() * 0.5;
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(this.pos, 3));
    geo.setAttribute('aSize', new BufferAttribute(size, 1));
    geo.setAttribute('aAlpha', new BufferAttribute(alpha, 1));
    this.material = new ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uMap: { value: map }, uColor: { value: new Vector3(1, 1, 1) }, uScale: { value: 300 } },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    this.points = new Points(geo, this.material);
    this.points.frustumCulled = false;
  }

  setPixelScale(scale: number): void {
    this.material.uniforms.uScale.value = scale;
  }

  update(center: Vector3, dt: number): void {
    this.time += dt;
    const half = this.box / 2;
    const windX = Math.sin(this.time * 0.3) * 0.8;
    for (let i = 0; i < this.count; i++) {
      const k = i * 3;
      this.pos[k] += (windX + Math.sin(this.time + i) * 0.3) * dt;
      this.pos[k + 1] -= (0.8 + (i % 5) * 0.15) * dt;
      this.pos[k + 2] += Math.cos(this.time * 0.7 + i) * 0.3 * dt;
      // Wrap relative to the camera centre.
      for (let a = 0; a < 3; a++) {
        const rel = this.pos[k + a] - (a === 0 ? center.x : a === 1 ? center.y : center.z);
        if (rel < -half) this.pos[k + a] += this.box;
        else if (rel > half) this.pos[k + a] -= this.box;
      }
    }
    this.points.geometry.getAttribute('position').needsUpdate = true;
  }

  dispose(): void {
    this.points.geometry.dispose();
    this.material.dispose();
  }
}
