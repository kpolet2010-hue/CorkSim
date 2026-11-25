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
attribute float aShade;
varying float vAlpha;
varying float vShade;
uniform float uScale;
void main() {
  vAlpha = aAlpha;
  vShade = aShade;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * uScale / max(0.1, -mv.z);
  gl_Position = projectionMatrix * mv;
}`;

// Tone mapping and colour space chunks keep particles consistent with lit geometry whether the frame goes
// straight to the canvas (renderer applies them) or through the HDR post chain (OutputPass applies them).
const FRAG = /* glsl */ `
uniform sampler2D uMap;
uniform vec3 uLit;
uniform vec3 uShade;
varying float vAlpha;
varying float vShade;
void main() {
  vec4 t = texture2D(uMap, gl_PointCoord);
  // Sun-lit top, cool sky-lit underside: a puff separates from the snow behind it by its shading, like real
  // spray, instead of being white on white. (gl_PointCoord.y grows downwards.) vShade raises the terminator
  // for dense snow (impact skirts, chunks) whose self-shadowed side is larger, and whose lower half is often
  // hidden in the snow surface.
  vec3 c = mix(uLit, uShade, smoothstep(0.2 - vShade * 0.55, 0.95 - vShade * 0.4, gl_PointCoord.y));
  gl_FragColor = vec4(c, t.a * vAlpha);
  if (gl_FragColor.a < 0.01) discard;
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export interface EmitOptions {
  /** Random horizontal velocity spread (m/s). */
  spread: number;
  /** Random extra upward velocity (m/s). */
  upward: number;
  sizeScale?: number;
  /** Lifetime multiplier (base 0.5..1.2 s). */
  life?: number;
  /** Peak opacity. */
  alpha?: number;
  /** Random start position jitter (m). */
  jitter?: number;
  /** Downward acceleration (m/s^2). Default 4: loose powder hangs in the air; dense chunks use ~9.81. */
  gravity?: number;
  /** Air drag rate (1/s). Default 2.2; dense chunks keep their throw with a lower value. */
  drag?: number;
  /** Size growth (m/s) as the puff disperses. Default 0.12 x sizeScale; chunks do not grow. */
  growth?: number;
  /** Self-shadowing 0..1 (default 0): dense snow shows more of its cool sky-lit side. */
  shade?: number;
}

const DEFAULT_GRAVITY = 4;
const DEFAULT_DRAG = 2.2;
/** The default as stored in the Float32Array, so the common case reuses one exp() per frame. */
const DEFAULT_DRAG_F32 = Math.fround(DEFAULT_DRAG);

/**
 * Pooled snow spray particles (carving, braking, landings, crashes, box slides). Fixed-size typed arrays, no
 * allocation per particle; the oldest particles are recycled when the pool is full.
 */
export class SnowSpray {
  readonly points: Points;
  private readonly pos: Float32Array;
  private readonly vel: Float32Array;
  private readonly life: Float32Array;
  private readonly maxLife: Float32Array;
  private readonly size: Float32Array;
  private readonly alpha: Float32Array;
  private readonly peak: Float32Array;
  private readonly growth: Float32Array;
  private readonly gravity: Float32Array;
  private readonly drag: Float32Array;
  private readonly shade: Float32Array;
  /** Shade only changes on emit, so it is uploaded only then. */
  private shadeDirty = false;
  private next = 0;
  private live = 0;
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
    this.peak = new Float32Array(capacity);
    this.growth = new Float32Array(capacity);
    this.gravity = new Float32Array(capacity);
    this.drag = new Float32Array(capacity);
    this.shade = new Float32Array(capacity);
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(this.pos, 3));
    geo.setAttribute('aSize', new BufferAttribute(this.size, 1));
    geo.setAttribute('aAlpha', new BufferAttribute(this.alpha, 1));
    geo.setAttribute('aShade', new BufferAttribute(this.shade, 1));
    this.material = new ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uMap: { value: map },
        // Linear radiance before exposure: the lit side slightly above sunlit snow, the underside sky-blue.
        uLit: { value: new Vector3(1.45, 1.43, 1.4) },
        uShade: { value: new Vector3(0.36, 0.44, 0.62) },
        uScale: { value: 300 },
      },
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

  /** Number of live particles (for tests/diagnostics). */
  get liveCount(): number {
    return this.live;
  }

  emit(origin: Vector3, baseVelocity: Vector3, count: number, o: EmitOptions): void {
    const n = Math.min(count, this.capacity);
    const jitter = o.jitter ?? 0.3;
    const sizeScale = o.sizeScale ?? 1;
    const lifeScale = o.life ?? 1;
    const alpha = o.alpha ?? 0.85;
    const gravity = o.gravity ?? DEFAULT_GRAVITY;
    const drag = o.drag ?? DEFAULT_DRAG;
    const growth = o.growth ?? 0.12 * sizeScale;
    const shade = Math.min(1, Math.max(0, o.shade ?? 0));
    if (n > 0) this.shadeDirty = true;
    for (let c = 0; c < n; c++) {
      const i = this.next;
      this.next = (this.next + 1) % this.capacity;
      const k = i * 3;
      this.pos[k] = origin.x + (Math.random() - 0.5) * jitter;
      this.pos[k + 1] = origin.y + Math.random() * 0.1;
      this.pos[k + 2] = origin.z + (Math.random() - 0.5) * jitter;
      this.vel[k] = baseVelocity.x + (Math.random() - 0.5) * o.spread;
      this.vel[k + 1] = baseVelocity.y + Math.random() * o.upward;
      this.vel[k + 2] = baseVelocity.z + (Math.random() - 0.5) * o.spread;
      this.maxLife[i] = this.life[i] = (0.6 + Math.random() * 0.6) * lifeScale;
      this.size[i] = (0.14 + Math.random() * 0.24) * sizeScale;
      this.growth[i] = growth;
      this.gravity[i] = gravity;
      this.drag[i] = drag;
      this.shade[i] = shade;
      this.peak[i] = alpha * (0.75 + Math.random() * 0.25);
    }
  }

  clear(): void {
    this.life.fill(0);
    this.alpha.fill(0);
    this.live = 0;
    this.points.geometry.getAttribute('aAlpha').needsUpdate = true;
  }

  update(dt: number): void {
    const defaultDrag = Math.exp(-DEFAULT_DRAG * dt);
    let live = 0;
    for (let i = 0; i < this.capacity; i++) {
      if (this.life[i] <= 0) {
        this.alpha[i] = 0;
        continue;
      }
      live++;
      this.life[i] -= dt;
      const k = i * 3;
      const dk = this.drag[i];
      const drag = dk === DEFAULT_DRAG_F32 ? defaultDrag : Math.exp(-dk * dt);
      this.vel[k] *= drag;
      this.vel[k + 1] = this.vel[k + 1] * drag - this.gravity[i] * dt;
      this.vel[k + 2] *= drag;
      this.pos[k] += this.vel[k] * dt;
      this.pos[k + 1] += this.vel[k + 1] * dt;
      this.pos[k + 2] += this.vel[k + 2] * dt;
      const t = Math.max(0, this.life[i] / this.maxLife[i]);
      // Quick fade-in, long fade-out: puffs bloom then dissipate.
      this.alpha[i] = Math.min(1, (1 - t) * 8) * t * this.peak[i];
      this.size[i] += dt * this.growth[i];
    }
    this.live = live;
    const g = this.points.geometry;
    g.getAttribute('position').needsUpdate = true;
    g.getAttribute('aAlpha').needsUpdate = true;
    g.getAttribute('aSize').needsUpdate = true;
    if (this.shadeDirty) {
      g.getAttribute('aShade').needsUpdate = true;
      this.shadeDirty = false;
    }
  }

  dispose(): void {
    this.points.geometry.dispose();
    this.material.dispose();
  }
}

const SPARK_VERT = /* glsl */ `
attribute float aSize;
attribute float aAlpha;
varying float vAlpha;
uniform float uScale;
void main() {
  vAlpha = aAlpha;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = max(1.5, aSize * uScale / max(0.1, -mv.z));
  gl_Position = projectionMatrix * mv;
}`;

const SPARK_FRAG = /* glsl */ `
uniform sampler2D uMap;
uniform vec3 uHot;
uniform vec3 uCool;
varying float vAlpha;
void main() {
  vec4 t = texture2D(uMap, gl_PointCoord);
  // HDR: hot sparks are white-yellow and > 1 so the bloom (high preset) catches them; cooling ones go orange.
  vec3 c = mix(uCool, uHot, vAlpha);
  gl_FragColor = vec4(c * t.a * vAlpha, 1.0);
  if (t.a * vAlpha < 0.01) discard;
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/**
 * Pooled metal grind sparks: short-lived, fast, gravity-bound, additive HDR points. Only emitted while the
 * simulation reports an actual grind on a metal rail.
 */
export class Sparks {
  readonly points: Points;
  private readonly pos: Float32Array;
  private readonly vel: Float32Array;
  private readonly life: Float32Array;
  private readonly maxLife: Float32Array;
  private readonly size: Float32Array;
  private readonly alpha: Float32Array;
  private next = 0;
  private live = 0;
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
      vertexShader: SPARK_VERT,
      fragmentShader: SPARK_FRAG,
      uniforms: {
        uMap: { value: map },
        uHot: { value: new Vector3(9, 6.5, 3) },
        uCool: { value: new Vector3(4, 1.1, 0.2) },
        uScale: { value: 300 },
      },
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

  get liveCount(): number {
    return this.live;
  }

  /** Sparks thrown backwards along the rail (`back` = unit direction) and up/sideways. */
  emit(origin: Vector3, back: Vector3, speed: number, count: number): void {
    const n = Math.min(count, this.capacity);
    for (let c = 0; c < n; c++) {
      const i = this.next;
      this.next = (this.next + 1) % this.capacity;
      const k = i * 3;
      this.pos[k] = origin.x;
      this.pos[k + 1] = origin.y;
      this.pos[k + 2] = origin.z;
      const v = speed * (0.25 + Math.random() * 0.45);
      this.vel[k] = back.x * v + (Math.random() - 0.5) * 3;
      this.vel[k + 1] = back.y * v + 0.8 + Math.random() * 2.2;
      this.vel[k + 2] = back.z * v + (Math.random() - 0.5) * 3;
      this.maxLife[i] = this.life[i] = 0.18 + Math.random() * 0.35;
      this.size[i] = 0.07 + Math.random() * 0.07;
    }
  }

  clear(): void {
    this.life.fill(0);
    this.alpha.fill(0);
    this.live = 0;
    this.points.geometry.getAttribute('aAlpha').needsUpdate = true;
  }

  update(dt: number): void {
    let live = 0;
    for (let i = 0; i < this.capacity; i++) {
      if (this.life[i] <= 0) {
        this.alpha[i] = 0;
        continue;
      }
      live++;
      this.life[i] -= dt;
      const k = i * 3;
      this.vel[k + 1] -= 9.81 * dt;
      this.pos[k] += this.vel[k] * dt;
      this.pos[k + 1] += this.vel[k + 1] * dt;
      this.pos[k + 2] += this.vel[k + 2] * dt;
      this.alpha[i] = Math.max(0, this.life[i] / this.maxLife[i]);
    }
    this.live = live;
    if (live === 0 && this.points.visible === false) return;
    this.points.visible = live > 0;
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
      alpha[i] = 0.35 + Math.random() * 0.4;
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(this.pos, 3));
    geo.setAttribute('aSize', new BufferAttribute(size, 1));
    geo.setAttribute('aAlpha', new BufferAttribute(alpha, 1));
    geo.setAttribute('aShade', new BufferAttribute(new Float32Array(count), 1));
    this.material = new ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uMap: { value: map },
        uLit: { value: new Vector3(1, 1, 1) },
        uShade: { value: new Vector3(0.85, 0.9, 1) },
        uScale: { value: 300 },
      },
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
