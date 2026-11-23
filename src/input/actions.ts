export const GAME_ACTIONS = [
  'left',
  'right',
  'forward',
  'back',
  'jump',
  'grab1',
  'grab2',
  'grab3',
  'grab4',
  'tweakLeft',
  'tweakRight',
  'pause',
  'restart',
  'reset',
  'camera',
] as const;

export type GameAction = (typeof GAME_ACTIONS)[number];

type ActionFlags = Record<GameAction, boolean>;

function emptyFlags(): ActionFlags {
  const o = {} as ActionFlags;
  for (const a of GAME_ACTIONS) o[a] = false;
  return o;
}

/**
 * Snapshot of player input for one fixed simulation step. The simulation only ever sees this structure,
 * which keeps it independent of the DOM and lets tests script inputs deterministically.
 */
export class ControlInput {
  readonly down: ActionFlags = emptyFlags();
  readonly pressed: ActionFlags = emptyFlags();
  readonly released: ActionFlags = emptyFlags();

  clearEdges(): void {
    for (const a of GAME_ACTIONS) {
      this.pressed[a] = false;
      this.released[a] = false;
    }
  }

  clearAll(): void {
    for (const a of GAME_ACTIONS) {
      this.down[a] = false;
      this.pressed[a] = false;
      this.released[a] = false;
    }
  }

  /** Scripted input helper: sets the held state and derives edges from the previous held state. */
  set(action: GameAction, isDown: boolean): void {
    if (isDown && !this.down[action]) this.pressed[action] = true;
    if (!isDown && this.down[action]) this.released[action] = true;
    this.down[action] = isDown;
  }

  axis(negative: GameAction, positive: GameAction): number {
    return (this.down[positive] ? 1 : 0) - (this.down[negative] ? 1 : 0);
  }
}
