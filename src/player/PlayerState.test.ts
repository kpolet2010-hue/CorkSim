import { describe, expect, it } from 'vitest';
import { PLAYER_STATES, PlayerStateMachine, STATE_TRANSITIONS, canTransition } from './PlayerState';

describe('PlayerStateMachine', () => {
  it('allows legal transitions', () => {
    const fsm = new PlayerStateMachine();
    expect(fsm.transition('RIDING')).toBe(true);
    expect(fsm.transition('JUMP_CHARGING')).toBe(true);
    expect(fsm.transition('AIRBORNE')).toBe(true);
    expect(fsm.transition('LANDING')).toBe(true);
    expect(fsm.transition('CARVING')).toBe(true);
  });

  it('rejects incompatible transitions', () => {
    const fsm = new PlayerStateMachine();
    fsm.transition('AIRBORNE');
    expect(fsm.transition('CARVING')).toBe(false);
    expect(fsm.transition('BRAKING')).toBe(false);
    expect(fsm.transition('JUMP_CHARGING')).toBe(false);
    expect(fsm.state).toBe('AIRBORNE');
    expect(fsm.rejected).toBe(3);
  });

  it('only recovers from a crash via IDLE', () => {
    expect(STATE_TRANSITIONS.CRASHED).toEqual(['IDLE']);
    expect(canTransition('CRASHED', 'AIRBORNE')).toBe(false);
  });

  it('reports state changes and timing', () => {
    const fsm = new PlayerStateMachine();
    const changes: string[] = [];
    fsm.onChange = (a, b) => changes.push(`${a}>${b}`);
    fsm.transition('RIDING');
    fsm.update(0.5);
    expect(fsm.timeInState).toBeCloseTo(0.5);
    fsm.force('IDLE');
    expect(changes).toEqual(['IDLE>RIDING', 'RIDING>IDLE']);
  });

  it('every state has a defined transition list', () => {
    for (const s of PLAYER_STATES) expect(Array.isArray(STATE_TRANSITIONS[s])).toBe(true);
  });
});
