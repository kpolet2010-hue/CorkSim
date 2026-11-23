import { findGrab, type GrabButton, type GrabDefinition } from './grabs';

export interface CompletedGrab {
  id: string;
  name: string;
  /** Seconds the grab was secured. */
  duration: number;
}

export interface GrabSystemConfig {
  /** Time for the hand to reach the ski before the grab counts (s). */
  reachTime: number;
  /** Minimum secured duration for the grab to be recognised (s). */
  minDuration: number;
  /** Grab duration that earns the maximum hold bonus (s). */
  maxScoredDuration: number;
}

export const DEFAULT_GRAB_CONFIG: GrabSystemConfig = {
  reachTime: 0.12,
  minDuration: 0.2,
  maxScoredDuration: 1.6,
};

/**
 * Tracks grab initiation, hold duration and release while airborne. Grabs never touch the rotational
 * physics directly; they only report state (pose blend, inertia change) which other systems consume.
 */
export class GrabSystem {
  readonly config: GrabSystemConfig;
  private active: GrabDefinition | null = null;
  private heldTime = 0;
  /** 0..1 blend used by the animation system. */
  blend = 0;
  private lastDefinition: GrabDefinition | null = null;
  readonly completed: CompletedGrab[] = [];

  constructor(config: GrabSystemConfig = DEFAULT_GRAB_CONFIG) {
    this.config = config;
  }

  reset(): void {
    this.active = null;
    this.heldTime = 0;
    this.blend = 0;
    this.completed.length = 0;
    this.lastDefinition = null;
  }

  get current(): GrabDefinition | null {
    return this.active;
  }

  /** The definition used for posing (stays valid while the pose blends out). */
  get poseDefinition(): GrabDefinition | null {
    return this.active ?? this.lastDefinition;
  }

  /** Secured duration of the current grab (excludes reach time). */
  get securedTime(): number {
    return Math.max(0, this.heldTime - this.config.reachTime);
  }

  get isSecured(): boolean {
    return this.active !== null && this.heldTime >= this.config.reachTime;
  }

  /**
   * Advance the grab state. `buttons` is the set of grab buttons currently held.
   * Returns 'started' | 'released' | null to let the caller react (e.g. angular momentum change).
   */
  update(
    buttons: ReadonlySet<GrabButton>,
    dt: number,
    canGrab: boolean,
  ): 'started' | 'released' | 'changed' | null {
    const wanted = canGrab ? findGrab(buttons) : null;
    let event: 'started' | 'released' | 'changed' | null = null;
    if (wanted !== this.active) {
      const hadActive = this.active !== null;
      this.finishActive();
      this.active = wanted;
      this.heldTime = 0;
      if (wanted) this.lastDefinition = wanted;
      event = wanted ? (hadActive ? 'changed' : 'started') : 'released';
    }
    if (this.active) {
      this.heldTime += dt;
      this.blend = Math.min(1, this.blend + dt / this.config.reachTime);
    } else {
      this.blend = Math.max(0, this.blend - dt / 0.15);
    }
    return event;
  }

  /** Ends the current grab (e.g. at landing). */
  releaseAll(): void {
    this.finishActive();
    this.active = null;
    this.heldTime = 0;
  }

  private finishActive(): void {
    if (!this.active) return;
    const secured = this.securedTime;
    if (secured >= this.config.minDuration) {
      const prev = this.completed[this.completed.length - 1];
      if (prev && prev.id === this.active.id) prev.duration += secured;
      else this.completed.push({ id: this.active.id, name: this.active.name, duration: secured });
    }
  }
}

export type { GrabButton };
