import { type Scene, type Texture, Vector3 } from 'three';
import type { Simulation } from '../sim/Simulation';
import type { QualityProfile } from './quality';
import { SkiTracks } from './SkiTracks';
import { SnowSpray, Snowfall } from './SnowParticles';
import { createSoftDotTexture } from './textures';

const _v = new Vector3();
const _side = new Vector3();

/**
 * Gameplay-coupled visual effects: snow spray from carving/skidding/landings/crashes, falling snow and ski
 * tracks. Everything is driven from the simulation state (read only) so effects never contradict physics.
 * Owned by graphics.
 */
export class Effects {
  private readonly dot: Texture;
  private readonly spray: SnowSpray;
  private readonly snowfall: Snowfall | null = null;
  private readonly tracks: SkiTracks;

  constructor(scene: Scene, quality: QualityProfile) {
    this.dot = createSoftDotTexture();
    this.spray = new SnowSpray(quality.spray, this.dot);
    scene.add(this.spray.points);
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
    this.snowfall?.setPixelScale(scale);
  }

  onLanded(sim: Simulation, impactSpeed: number): void {
    const b = sim.player.body;
    for (let i = 0; i < 2; i++)
      this.spray.emit(
        b.skis[i].point,
        _v.copy(b.velocity).multiplyScalar(0.3),
        20 + Math.round(impactSpeed * 4),
        3,
        2.5,
        1.4,
      );
  }

  onCrash(sim: Simulation): void {
    const b = sim.player.body;
    this.spray.emit(b.position, _v.copy(b.velocity).multiplyScalar(0.4), 120, 4, 3, 1.8);
  }

  onRailStart(_sim: Simulation): void {}

  /** Clears persistent marks (after a reset/restart teleport). */
  clear(): void {
    this.tracks.clear();
  }

  update(sim: Simulation, cameraPosition: Vector3, dt: number): void {
    const player = sim.player;
    const b = player.body;
    const grounded = player.fsm.onGround;
    // Snow spray from skidding/carving skis.
    if (grounded) {
      const carveSpray = Math.abs(b.edgeAngle) * b.speed * 0.25;
      const skid = b.skidSpeed * 1.2 + b.brakeAmount * b.speed * 0.6;
      const intensity = carveSpray + skid;
      if (intensity > 1.2) {
        const count = Math.min(6, Math.floor(intensity * dt * 22) + (Math.random() < 0.5 ? 1 : 0));
        _side.set(1, 0, 0).applyQuaternion(b.orientation);
        for (let i = 0; i < 2; i++) {
          const ski = b.skis[i];
          if (!ski.inContact) continue;
          const side = Math.sign(b.edgeAngle) || 1;
          _v.copy(b.velocity)
            .multiplyScalar(0.35)
            .addScaledVector(_side, -side * Math.min(4, intensity * 0.4));
          this.spray.emit(ski.point, _v, count, 1.6, 1.5);
        }
      }
    }
    this.spray.update(dt);
    this.snowfall?.update(cameraPosition, dt);
    // Ski tracks.
    _side.set(1, 0, 0).applyQuaternion(b.orientation);
    for (let i = 0; i < 2; i++) {
      const ski = b.skis[i];
      this.tracks.add(i as 0 | 1, ski.point, _side, grounded && ski.inContact && b.speed > 0.5);
    }
  }

  dispose(): void {
    this.spray.dispose();
    this.snowfall?.dispose();
    this.tracks.dispose();
    this.dot.dispose();
  }
}
