import { Vector3 } from 'three';
import { DEFAULT_GAMEPLAY_CONFIG, cloneGameplayConfig, type GameplayConfig } from '../config/physicsConfig';
import { DEFAULT_SCORING_CONFIG, type ScoringConfig } from '../config/scoringConfig';
import { EventBus } from '../core/EventBus';
import type { ControlInput } from '../input/actions';
import { Park } from '../park/Park';
import type { ParkConfig } from '../park/types';
import { PhysicsWorld } from '../physics/PhysicsWorld';
import { PlayerController } from '../player/PlayerController';
import { ScoringSystem } from '../scoring/ScoringSystem';
import type { SimEvents } from './events';

export interface SimulationOptions {
  gameplay?: GameplayConfig;
  scoring?: ScoringConfig;
}

/**
 * Headless game simulation: park, physics, player, scoring and events. Contains no rendering, DOM or
 * audio code, so it runs identically in the browser and in unit/integration tests. Always advanced with a
 * fixed timestep.
 */
export class Simulation {
  readonly events = new EventBus<SimEvents>();
  readonly scoring: ScoringSystem;
  readonly player: PlayerController;
  readonly cfg: GameplayConfig;
  /** Seconds since the run started. */
  runTime = 0;
  stepCount = 0;
  finished = false;
  private disposed = false;

  private constructor(
    readonly park: Park,
    readonly physics: PhysicsWorld,
    options: SimulationOptions,
  ) {
    this.cfg = options.gameplay ?? cloneGameplayConfig(DEFAULT_GAMEPLAY_CONFIG);
    this.scoring = new ScoringSystem(options.scoring ?? DEFAULT_SCORING_CONFIG);
    this.player = new PlayerController(park, physics, this.scoring, this.events, this.cfg);
    this.player.reset();
  }

  static async create(
    config: ParkConfig,
    options: SimulationOptions = {},
    onProgress?: (p: number, label: string) => void,
  ): Promise<Simulation> {
    onProgress?.(0.05, 'Shaping the mountain');
    const park = new Park(config);
    onProgress?.(0.35, 'Initialising physics');
    const physics = await PhysicsWorld.create(park);
    onProgress?.(0.55, 'Placing the skier');
    return new Simulation(park, physics, options);
  }

  get dt(): number {
    return this.cfg.fixedTimestep;
  }

  step(input: ControlInput): void {
    if (this.disposed) return;
    this.player.step(input, this.dt);
    this.runTime += this.dt;
    this.stepCount++;
    if (
      !this.finished &&
      this.player.body.position.z >= this.park.config.finishZ &&
      this.player.fsm.onGround
    ) {
      this.finished = true;
      const bonus = this.scoring.endCombo();
      if (bonus > 0) this.events.emit('comboEnded', { bonus, points: 0, multiplier: 1, tricks: 0 });
      this.events.emit('runFinished', { score: this.scoring.getRunScore(), time: this.runTime });
    }
  }

  /** Restart the run from the top: score, timer and player state are reset. */
  restartRun(): void {
    this.scoring.reset();
    this.player.reset();
    this.runTime = 0;
    this.stepCount = 0;
    this.finished = false;
    this.events.emit('reset', { restart: true });
  }

  /** Puts the skier back on their feet at the current location (keeps the score). */
  resetPlayerInPlace(): void {
    this.scoring.breakCombo();
    this.player.recover();
    this.events.emit('reset', { restart: false });
  }

  /** Debug/test helper: place the skier at a point with a velocity. */
  teleport(x: number, z: number, speed: number, headingDeg = 0): void {
    this.player.reset(new Vector3(x, 0, z), headingDeg);
    const b = this.player.body;
    b.velocity.copy(b.heading).multiplyScalar(speed);
    b.velocity.addScaledVector(b.groundNormal, -b.velocity.dot(b.groundNormal));
    b.velocity.setLength(speed);
    this.player.fsm.force('RIDING');
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.events.clear();
    this.physics.dispose();
  }
}
