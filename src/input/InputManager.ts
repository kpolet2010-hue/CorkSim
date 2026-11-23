import type { KeyBindings } from '../config/settings';
import { ControlInput, GAME_ACTIONS, type GameAction } from './actions';

/**
 * Centralised keyboard input. The only place in the game that registers keyboard listeners.
 *
 * Raw key events are collected between fixed simulation steps; `sample()` converts them into a
 * ControlInput with held, just-pressed and just-released flags for exactly one step, so short taps
 * between frames are never lost. Browser shortcuts for bound keys are suppressed only while the game is
 * active and focus is not in a form control.
 */
export class InputManager {
  private bindings: KeyBindings;
  private codeToActions = new Map<string, GameAction[]>();
  private readonly heldKeys = new Set<string>();
  private readonly pressedSinceSample = new Set<GameAction>();
  private readonly releasedSinceSample = new Set<GameAction>();
  private readonly output = new ControlInput();
  private attached = false;
  /** When false, no input is captured or prevented (menus open). */
  active = false;
  /** Called on actions handled outside the simulation (pause, restart...). */
  onAction: ((action: GameAction) => void) | null = null;

  constructor(bindings: KeyBindings) {
    this.bindings = bindings;
    this.rebuildMap();
  }

  setBindings(bindings: KeyBindings): void {
    this.bindings = bindings;
    this.rebuildMap();
    this.heldKeys.clear();
  }

  private rebuildMap(): void {
    this.codeToActions.clear();
    for (const action of GAME_ACTIONS) {
      for (const code of this.bindings[action] ?? []) {
        const list = this.codeToActions.get(code) ?? [];
        list.push(action);
        this.codeToActions.set(code, list);
      }
    }
  }

  attach(target: Window = window): void {
    if (this.attached) return;
    target.addEventListener('keydown', this.handleKeyDown);
    target.addEventListener('keyup', this.handleKeyUp);
    target.addEventListener('blur', this.handleBlur);
    document.addEventListener('visibilitychange', this.handleBlur);
    this.attached = true;
  }

  detach(target: Window = window): void {
    if (!this.attached) return;
    target.removeEventListener('keydown', this.handleKeyDown);
    target.removeEventListener('keyup', this.handleKeyUp);
    target.removeEventListener('blur', this.handleBlur);
    document.removeEventListener('visibilitychange', this.handleBlur);
    this.attached = false;
    this.clear();
  }

  private isTypingTarget(e: KeyboardEvent): boolean {
    const t = e.target as HTMLElement | null;
    if (!t) return false;
    const tag = t.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable;
  }

  private readonly handleKeyDown = (e: KeyboardEvent): void => {
    if (!this.active || this.isTypingTarget(e)) return;
    const actions = this.codeToActions.get(e.code);
    if (!actions) return;
    // Prevent scrolling (Space/arrows), browser back (Backspace), etc. only for bound keys.
    e.preventDefault();
    if (e.repeat) return;
    this.heldKeys.add(e.code);
    for (const a of actions) {
      this.pressedSinceSample.add(a);
      if (a === 'pause' || a === 'restart' || a === 'reset' || a === 'camera') this.onAction?.(a);
    }
  };

  private readonly handleKeyUp = (e: KeyboardEvent): void => {
    if (!this.heldKeys.has(e.code)) return;
    if (this.active) e.preventDefault();
    this.heldKeys.delete(e.code);
    for (const a of this.codeToActions.get(e.code) ?? []) {
      if (!this.isActionHeld(a)) this.releasedSinceSample.add(a);
    }
  };

  private readonly handleBlur = (): void => {
    // Losing focus would otherwise leave keys "stuck" down.
    for (const code of this.heldKeys) {
      for (const a of this.codeToActions.get(code) ?? []) this.releasedSinceSample.add(a);
    }
    this.heldKeys.clear();
  };

  private isActionHeld(action: GameAction): boolean {
    for (const code of this.bindings[action] ?? []) if (this.heldKeys.has(code)) return true;
    return false;
  }

  isDown(action: GameAction): boolean {
    return this.isActionHeld(action);
  }

  /** Produces the input for one fixed simulation step and consumes pending edges. */
  sample(): ControlInput {
    const o = this.output;
    for (const a of GAME_ACTIONS) {
      const held = this.isActionHeld(a);
      const pressed = this.pressedSinceSample.has(a);
      const released = this.releasedSinceSample.has(a);
      o.pressed[a] = pressed;
      o.released[a] = released;
      // A tap shorter than one step still counts as held for that step.
      o.down[a] = held || (pressed && released);
    }
    this.pressedSinceSample.clear();
    this.releasedSinceSample.clear();
    return o;
  }

  clear(): void {
    this.heldKeys.clear();
    this.pressedSinceSample.clear();
    this.releasedSinceSample.clear();
    this.output.clearAll();
  }
}
