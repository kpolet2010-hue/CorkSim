import { type Scene, type Texture, Vector3 } from 'three';
import type { Simulation } from '../sim/Simulation';
import {
  type BurstParams,
  crashBurst,
  crashTrailRate,
  type GrindParams,
  grindRate,
  landingBurst,
  skiSpray,
  type SprayParams,
} from './effectsModel';
import type { QualityProfile } from './quality';
import { SkiTracks } from './SkiTracks';
import { SnowSpray, Snowfall, Sparks } from './SnowParticles';
import { createPuffTexture, createSoftDotTexture } from './textures';

const _v = new Vector3();
const _side = new Vector3();
const _p = new Vector3();
const _t = new Vector3();
const _spray: SprayParams = {
  rate: 0,
  throwSpeed: 0,
  carry: 0,
  spread: 0,
  upward: 0,
  sizeScale: 0,
  alpha: 0,
  life: 0,
};
const _burst: BurstParams = { count: 0, throwSpeed: 0, spread: 0, upward: 0, sizeScale: 0 };
const _grind: GrindParams = { sparks: 0, flecks: 0 };
/** Per-frame emission cap per emitter, so a long hitch cannot dump the whole pool at once. */
const MAX_PER_FRAME = 24;

/**
 * Gameplay-coupled visual effects: snow spray from carving/skidding/braking, landing bursts, crash clouds,
 * grind sparks (metal rails) and snow flecks (boxes), falling snow and ski tracks. Everything is driven from
 * the simulation state (read only) so effects never contradict physics. All particles are pooled; nothing is
 * allocated per frame. Owned by graphics.
 */
export class Effects {
  private readonly dot: Texture;
  private readonly puff: Texture;
  private readonly spray: SnowSpray;
  private readonly sparks: Sparks;
  private readonly snowfall: Snowfall | null = null;
  private readonly tracks: SkiTracks;
  /** Fractional emission carried between frames: ski 0, ski 1, sparks, flecks. */
  private readonly acc = new Float32Array(4);

  constructor(scene: Scene, quality: QualityProfile) {
    this.dot = createSoftDotTexture();
    this.puff = createPuffTexture();
    this.spray = new SnowSpray(quality.spray, this.puff);
    scene.add(this.spray.points);
    this.sparks = new Sparks(quality.sparks, this.dot);
    scene.add(this.sparks.points);
    if (quality.snowfall > 0) {
      this.snowfall = new Snowfall(quality.snowfall, this.dot);
      scene.add(this.snowfall.points);
    }
    this.tracks = new SkiTracks();
    scene.add(this.tracks.mesh);
  }

  /** Point-sprite scale: drawing-buffer height in px / 2. */
  setPixelScale(scale: number): void {
    this.spray.setPixelScale(scale);
    this.sparks.setPixelScale(scale);
    this.snowfall?.setPixelScale(scale);
  }

  /** Landing burst from both skis, sized by the vertical impact speed. */
  onLanded(sim: Simulation, impactSpeed: number): void {
    const b = sim.player.body;
    landingBurst(impactSpeed, _burst);
    // A low skirt of snow kicked out sideways and back from each ski, scaled by the impact. It stays below
    // knee height and is left behind by the skier, so the player always sees their own landing.
    // Ski contact points are not refreshed in the air (they still hold the takeoff), so the burst is placed
    // at the body's feet on the snow surface, one per ski across the stance.
    _side.set(1, 0, 0).applyQuaternion(b.orientation);
    for (let i = 0; i < 2; i++) {
      const sign = i === 0 ? -1 : 1;
      _p.copy(b.position).addScaledVector(_side, sign * 0.13);
      _p.y = sim.park.surface.height(_p.x, _p.z);
      _v.copy(_side)
        .multiplyScalar(sign * _burst.throwSpeed)
        .addScaledVector(b.heading, -1.5);
      _v.y = 0;
      this.spray.emit(_p, _v, Math.round(_burst.count * 0.8), {
        spread: _burst.spread,
        upward: _burst.upward,
        sizeScale: _burst.sizeScale,
        life: 0.65,
        alpha: 0.9,
        jitter: 0.5,
      });
      // A few slower puffs right at the skis mark the impact point.
      _v.multiplyScalar(0.35);
      this.spray.emit(_p, _v, Math.round(_burst.count * 0.3), {
        spread: _burst.spread * 0.6,
        upward: _burst.upward * 0.6,
        sizeScale: _burst.sizeScale * 0.8,
        life: 0.5,
        alpha: 0.45,
        jitter: 0.3,
      });
    }
  }

  /**
   * Crash impact: a low skirt of snow at snow level thrown sideways and back around the body, so the
   * tumbling skier stays readable. The sliding body then leaves a thin trailing plume (see update).
   */
  onCrash(sim: Simulation): void {
    const b = sim.player.body;
    crashBurst(b.speed, _burst);
    _side.set(1, 0, 0).applyQuaternion(b.orientation);
    _t.copy(b.velocity).setY(0);
    if (_t.lengthSq() > 1e-6) _t.normalize();
    for (let i = 0; i < 2; i++) {
      const sign = i === 0 ? -1 : 1;
      _p.copy(b.position).addScaledVector(_side, sign * 0.3);
      _p.y = sim.park.surface.height(_p.x, _p.z);
      _v.copy(_side)
        .multiplyScalar(sign * _burst.throwSpeed)
        .addScaledVector(_t, -1.2);
      _v.y = 0;
      this.spray.emit(_p, _v, Math.round(_burst.count / 2), {
        spread: _burst.spread,
        upward: _burst.upward,
        sizeScale: _burst.sizeScale,
        life: 0.6,
        alpha: 0.6,
        jitter: 0.6,
      });
    }
  }

  /** Entry kick when the skis lock onto a rail or box. */
  onRailStart(sim: Simulation): void {
    const grind = sim.player.rails.grind;
    if (!grind) return;
    grind.rail.path.pointAt(grind.s, _p);
    grind.rail.path.tangentAt(grind.s, _t).multiplyScalar(-Math.sign(grind.speed) || -1);
    const speed = Math.abs(grind.speed);
    if (grind.rail.kind === 'rail') this.sparks.emit(_p, _t, speed, 18);
    _v.copy(_t).multiplyScalar(speed * 0.2);
    this.spray.emit(_p, _v, 14, { spread: 1.5, upward: 1.2, sizeScale: 0.6, life: 0.7 });
  }

  /** Clears persistent marks and live particles (after a reset/restart teleport). */
  clear(): void {
    this.tracks.clear();
    this.spray.clear();
    this.sparks.clear();
    this.acc.fill(0);
  }

  update(sim: Simulation, cameraPosition: Vector3, dt: number): void {
    const player = sim.player;
    const b = player.body;
    const grounded = player.fsm.onGround;
    _side.set(1, 0, 0).applyQuaternion(b.orientation);
    const speed = b.speed;

    const crashed = player.state === 'CRASHED';
    if (crashed) {
      // Sliding after a crash: a few slow, low puffs left behind the body at snow level.
      this.acc[1] = 0;
      this.acc[0] += crashTrailRate(speed) * dt;
      const n = Math.min(MAX_PER_FRAME, Math.floor(this.acc[0]));
      if (n > 0) {
        this.acc[0] -= n;
        _p.copy(b.position);
        _p.y = sim.park.surface.height(_p.x, _p.z);
        _v.copy(b.velocity).multiplyScalar(-0.1);
        _v.y = 0;
        this.spray.emit(_p, _v, n, {
          spread: 1,
          upward: 0.5,
          sizeScale: 1.1,
          life: 0.5,
          alpha: 0.5,
          jitter: 0.5,
        });
      }
    } else if (grounded) {
      // Snow thrown by the skis: carving cuts a rooster tail away from the turn, skids/brakes scrape a fan.
      skiSpray(speed, b.edgeAngle, b.skidSpeed, b.brakeAmount, _spray);
      const away = -(Math.sign(b.edgeAngle) || 1);
      for (let i = 0; i < 2; i++) {
        const ski = b.skis[i];
        if (!ski.inContact || _spray.rate <= 0) {
          this.acc[i] = 0;
          continue;
        }
        this.acc[i] += _spray.rate * dt;
        const n = Math.min(MAX_PER_FRAME, Math.floor(this.acc[i]));
        if (n <= 0) continue;
        this.acc[i] -= n;
        _v.copy(b.velocity)
          .multiplyScalar(_spray.carry)
          .addScaledVector(_side, away * _spray.throwSpeed);
        this.spray.emit(ski.point, _v, n, {
          spread: _spray.spread,
          upward: _spray.upward,
          sizeScale: _spray.sizeScale,
          alpha: _spray.alpha,
          life: _spray.life,
        });
      }
    } else {
      this.acc[0] = this.acc[1] = 0;
    }

    // Grinding: sparks off metal, snow flecks off boxes, at the actual contact point on the rail.
    const grind = player.state === 'RAIL_GRINDING' ? player.rails.grind : null;
    if (grind) {
      const gSpeed = Math.abs(grind.speed);
      grindRate(grind.rail.kind, gSpeed, _grind);
      grind.rail.path.pointAt(grind.s, _p);
      grind.rail.path.tangentAt(grind.s, _t).multiplyScalar(-Math.sign(grind.speed) || -1);
      this.acc[2] += _grind.sparks * dt;
      this.acc[3] += _grind.flecks * dt;
      const ns = Math.min(MAX_PER_FRAME, Math.floor(this.acc[2]));
      const nf = Math.min(MAX_PER_FRAME, Math.floor(this.acc[3]));
      this.acc[2] -= ns;
      this.acc[3] -= nf;
      if (ns > 0) this.sparks.emit(_p, _t, gSpeed, ns);
      if (nf > 0) {
        _v.copy(_t).multiplyScalar(gSpeed * 0.15);
        this.spray.emit(_p, _v, nf, { spread: 1.4, upward: 1.0, sizeScale: 0.9, life: 0.7, jitter: 0.15 });
      }
    } else {
      this.acc[2] = this.acc[3] = 0;
    }

    this.spray.update(dt);
    this.sparks.update(dt);
    this.snowfall?.update(cameraPosition, dt);

    // Ski tracks: pencil-thin when carving, wide when skidding or braking.
    const width = Math.min(0.34, 0.1 + b.skidSpeed * 0.04 + b.brakeAmount * 0.12);
    for (let i = 0; i < 2; i++) {
      const ski = b.skis[i];
      this.tracks.add(
        i as 0 | 1,
        ski.point,
        _side,
        ski.normal,
        grounded && ski.inContact && speed > 0.5,
        width,
      );
    }
  }

  dispose(): void {
    this.spray.dispose();
    this.sparks.dispose();
    this.snowfall?.dispose();
    this.tracks.dispose();
    this.dot.dispose();
    this.puff.dispose();
  }
}
