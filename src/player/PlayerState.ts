export const PLAYER_STATES = [
  'IDLE',
  'RIDING',
  'CARVING',
  'BRAKING',
  'JUMP_CHARGING',
  'AIRBORNE',
  'RAIL_GRINDING',
  'LANDING',
  'CRASHED',
] as const;

export type PlayerState = (typeof PLAYER_STATES)[number];

export const GROUND_STATES: ReadonlySet<PlayerState> = new Set<PlayerState>([
  'IDLE',
  'RIDING',
  'CARVING',
  'BRAKING',
  'JUMP_CHARGING',
  'LANDING',
]);

const GROUND_FREE: PlayerState[] = ['IDLE', 'RIDING', 'CARVING', 'BRAKING'];

/** Legal state transitions. Anything not listed is rejected (except forced resets). */
export const STATE_TRANSITIONS: Readonly<Record<PlayerState, readonly PlayerState[]>> = {
  IDLE: ['RIDING', 'CARVING', 'BRAKING', 'JUMP_CHARGING', 'AIRBORNE', 'RAIL_GRINDING', 'CRASHED'],
  RIDING: ['IDLE', 'CARVING', 'BRAKING', 'JUMP_CHARGING', 'AIRBORNE', 'RAIL_GRINDING', 'CRASHED'],
  CARVING: ['IDLE', 'RIDING', 'BRAKING', 'JUMP_CHARGING', 'AIRBORNE', 'RAIL_GRINDING', 'CRASHED'],
  BRAKING: ['IDLE', 'RIDING', 'CARVING', 'JUMP_CHARGING', 'AIRBORNE', 'RAIL_GRINDING', 'CRASHED'],
  JUMP_CHARGING: [...GROUND_FREE, 'AIRBORNE', 'RAIL_GRINDING', 'CRASHED'],
  AIRBORNE: ['LANDING', 'RAIL_GRINDING', 'CRASHED'],
  RAIL_GRINDING: ['AIRBORNE', 'CRASHED'],
  LANDING: [...GROUND_FREE, 'JUMP_CHARGING', 'AIRBORNE', 'RAIL_GRINDING', 'CRASHED'],
  CRASHED: ['IDLE'],
};

export function canTransition(from: PlayerState, to: PlayerState): boolean {
  return STATE_TRANSITIONS[from].includes(to);
}

/** Finite state machine guarding the player's high-level state. */
export class PlayerStateMachine {
  private current: PlayerState = 'IDLE';
  private previous: PlayerState = 'IDLE';
  /** Seconds spent in the current state. */
  timeInState = 0;
  /** Number of rejected transitions (diagnostics/tests). */
  rejected = 0;
  onChange: ((from: PlayerState, to: PlayerState) => void) | null = null;

  get state(): PlayerState {
    return this.current;
  }

  get previousState(): PlayerState {
    return this.previous;
  }

  is(...states: PlayerState[]): boolean {
    return states.includes(this.current);
  }

  get onGround(): boolean {
    return GROUND_STATES.has(this.current);
  }

  /** Attempts a transition; returns false (and changes nothing) if it is not allowed. */
  transition(to: PlayerState): boolean {
    if (to === this.current) return true;
    if (!canTransition(this.current, to)) {
      this.rejected++;
      return false;
    }
    this.apply(to);
    return true;
  }

  /** Forced transition used only by explicit resets. */
  force(to: PlayerState): void {
    if (to !== this.current) this.apply(to);
    this.timeInState = 0;
  }

  update(dt: number): void {
    this.timeInState += dt;
  }

  private apply(to: PlayerState): void {
    const from = this.current;
    this.previous = from;
    this.current = to;
    this.timeInState = 0;
    this.onChange?.(from, to);
  }
}
