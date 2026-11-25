import { type Scene, type Texture, Vector3 } from 'three';
import { createSurfaceSample } from '../park/SurfaceField';
import type { Simulation } from '../sim/Simulation';
import {
  alongSurface,
  type BurstParams,
  CHUNK_GRAVITY,
  type ChunkParams,
  crashBurst,
  crashCarry,
  crashChunks,
  crashContact,
  crashTrailRate,
  type GrindParams,
  SKIRT_GRAVITY,
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
const _chunks: ChunkParams = { count: 0, throwSpeed: 0, upward: 0, sizeScale: 0 };
const _up = new Vector3();
const _fwd = new Vector3();
const _contact = new Vector3();
/** Sectors of the crash skirt ring. */
const CRASH_RING = 10;
const _surf = createSurfaceSample();
/** Crash snow spawn height above the surface (m). */
const SKIRT_LIFT = 0.12;
/** Per-frame emission cap per emitter, so a long hitch cannot dump the whole pool at once. */
const MAX_PER_FRAME = 24;

/**
 * Gameplay-coupled visual effects: snow spray from carving/skidding/braking, landing bursts, crash impacts,
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
  /** Impact speed of a landing awaiting its burst (see onLanded), or -1. */
  private pendingLanding = -1;
  private readonly landPos = new Vector3();
  private readonly landSide = new Vector3();
  private readonly landHeading = new Vector3();

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

  /**
   * Landing burst from both skis, sized by the vertical impact speed. The simulation reports a crash landing
   * as `landed` followed by `crash` in the same step, so the burst is held until the next update and dropped
   * if the landing turned into a crash: a crash gets the crash impact at the body's real contact point, not a
   * clean-landing skirt under skis that may still be in the air.
   */
  onLanded(sim: Simulation, impactSpeed: number): void {
    // Captured now: the body keeps moving in later sim steps of the same frame.
    const b = sim.player.body;
    this.pendingLanding = impactSpeed;
    this.landPos.copy(b.position);
    this.landSide.set(1, 0, 0).applyQuaternion(b.orientation);
    this.landHeading.copy(b.heading);
  }

  private emitLanding(sim: Simulation, impactSpeed: number): void {
    landingBurst(impactSpeed, _burst);
    // A low skirt of snow kicked out sideways and back from each ski, scaled by the impact. It stays below
    // knee height and is left behind by the skier, so the player always sees their own landing.
    // Ski contact points are not refreshed in the air (they still hold the takeoff), so the burst is placed
    // at the body's feet on the snow surface, one per ski across the stance.
    for (let i = 0; i < 2; i++) {
      const sign = i === 0 ? -1 : 1;
      _p.copy(this.landPos).addScaledVector(this.landSide, sign * 0.13);
      _p.y = sim.park.surface.height(_p.x, _p.z);
      _v.copy(this.landSide)
        .multiplyScalar(sign * _burst.throwSpeed)
        .addScaledVector(this.landHeading, -1.5);
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
   * Crash impact at the point where the body actually hits the snow (feet, hips or head, whichever is
   * lowest): a low ring-shaped skirt shoved ahead by the body's momentum plus a few small, dense chunks thrown
   * ballistically. The ring starts a little out from the contact and nothing billows upward, so the tumbling
   * skier stays readable. The sliding body then leaves a thin trailing plume (see update).
   */
  onCrash(sim: Simulation): void {
    const b = sim.player.body;
    const surface = sim.park.surface;
    // The landing that caused this crash must not also throw a clean-landing skirt.
    this.pendingLanding = -1;
    this.acc[0] = this.acc[1] = 0;
    const speed = b.speed;
    _up.set(0, 1, 0).applyQuaternion(b.orientation);
    crashContact(b.position, _up, surface, _contact);
    // Horizontal travel direction (heading if the body has nearly stopped) and its horizontal normal.
    _fwd.copy(b.velocity).setY(0);
    if (_fwd.lengthSq() < 0.04) _fwd.copy(b.heading).setY(0);
    if (_fwd.lengthSq() < 1e-6) _fwd.set(0, 0, 1);
    _fwd.normalize();
    _side.set(-_fwd.z, 0, _fwd.x);

    // Throws follow the snow surface at the impact, so on a steep landing the skirt runs down the slope
    // instead of hovering over it.
    surface.sample(_contact.x, _contact.z, _surf);

    crashBurst(speed, _burst);
    const carry = crashCarry(speed);
    const phase = Math.random() * ((2 * Math.PI) / CRASH_RING);
    for (let k = 0; k < CRASH_RING; k++) {
      const a = phase + (k * 2 * Math.PI) / CRASH_RING;
      const c = Math.cos(a);
      _t.copy(_fwd).multiplyScalar(c).addScaledVector(_side, Math.sin(a));
      // Snow ahead of the impact is ploughed harder and in larger amounts than snow behind it.
      const radial = _burst.throwSpeed * (0.75 + 0.25 * c);
      const count = Math.max(1, Math.round((_burst.count / CRASH_RING) * (0.55 + 0.45 * c)));
      _v.copy(_t).multiplyScalar(radial).addScaledVector(_fwd, carry);
      _v.y = 0;
      alongSurface(_v, _surf.normal);
      // Spawned a little above the surface so the sprites' shaded lower half is not swallowed by the snow.
      _p.copy(_contact).addScaledVector(_t, 0.3);
      _p.y = surface.height(_p.x, _p.z) + SKIRT_LIFT;
      this.spray.emit(_p, _v, count, {
        spread: _burst.spread * 0.5,
        upward: _burst.upward,
        sizeScale: _burst.sizeScale,
        life: 1,
        alpha: 1,
        jitter: 0.35,
        gravity: SKIRT_GRAVITY,
        shade: 0.4,
      });
    }

    // Chunks and flecks: small, opaque, full gravity, thrown out of the impact in four quadrants.
    crashChunks(speed, _chunks);
    const perQuad = Math.max(1, Math.round(_chunks.count / 4));
    for (let k = 0; k < 4; k++) {
      const a = phase + Math.PI / 4 + (k * Math.PI) / 2;
      _t.copy(_fwd).multiplyScalar(Math.cos(a)).addScaledVector(_side, Math.sin(a));
      _v.copy(_t)
        .multiplyScalar(_chunks.throwSpeed)
        .addScaledVector(_fwd, carry * 0.8);
      _v.y = 0;
      alongSurface(_v, _surf.normal);
      // Popped out of the snow along its normal, so on a steep landing they still clear the slope.
      _v.addScaledVector(_surf.normal, _chunks.upward * 0.5);
      _p.copy(_contact);
      _p.y += SKIRT_LIFT;
      this.spray.emit(_p, _v, perQuad, {
        spread: _chunks.throwSpeed * 0.7,
        upward: _chunks.upward * 0.5,
        sizeScale: _chunks.sizeScale,
        life: 0.9,
        alpha: 1,
        jitter: 0.3,
        gravity: CHUNK_GRAVITY,
        drag: 0.5,
        growth: 0,
        shade: 0.75,
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
    this.pendingLanding = -1;
  }

  update(sim: Simulation, cameraPosition: Vector3, dt: number): void {
    const player = sim.player;
    const b = player.body;
    const grounded = player.fsm.onGround;
    _side.set(1, 0, 0).applyQuaternion(b.orientation);
    const speed = b.speed;

    if (this.pendingLanding >= 0) {
      this.emitLanding(sim, this.pendingLanding);
      this.pendingLanding = -1;
    }

    const crashed = player.state === 'CRASHED';
    if (crashed) {
      // Sliding after a crash: no ski spray (the skis are not carving); a thin plume of slow, low puffs is
      // ploughed up where the body touches the snow, and nothing while it bounces clear of the surface.
      this.acc[1] = 0;
      _up.set(0, 1, 0).applyQuaternion(b.orientation);
      const clearance = crashContact(b.position, _up, sim.park.surface, _contact);
      const rate = crashTrailRate(speed, clearance);
      if (rate <= 0) this.acc[0] = 0;
      else this.acc[0] += rate * dt;
      const n = Math.min(MAX_PER_FRAME, Math.floor(this.acc[0]));
      if (n > 0) {
        this.acc[0] -= n;
        _v.copy(b.velocity).multiplyScalar(0.15);
        _v.y = 0;
        sim.park.surface.sample(_contact.x, _contact.z, _surf);
        alongSurface(_v, _surf.normal);
        _contact.y += SKIRT_LIFT * 0.5;
        this.spray.emit(_contact, _v, n, {
          spread: 0.9,
          upward: 0.45,
          sizeScale: 0.95,
          life: 0.7,
          alpha: 0.85,
          jitter: 0.25,
          shade: 0.3,
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
