import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_BINDINGS, sanitizeSettings } from '../config/settings';
import { InputManager } from './InputManager';

class FakeTarget extends EventTarget {}

function key(type: 'keydown' | 'keyup', code: string, repeat = false): KeyboardEvent {
  const e = new Event(type, { cancelable: true }) as unknown as KeyboardEvent;
  Object.defineProperty(e, 'code', { value: code });
  Object.defineProperty(e, 'repeat', { value: repeat });
  Object.defineProperty(e, 'target', { value: null });
  return e;
}

describe('InputManager', () => {
  let target: FakeTarget;
  let input: InputManager;
  beforeEach(() => {
    (globalThis as { document?: unknown }).document = new EventTarget();
    target = new FakeTarget();
    input = new InputManager(structuredClone(DEFAULT_BINDINGS));
    input.attach(target as unknown as Window);
    input.active = true;
  });
  afterEach(() => input.detach(target as unknown as Window));

  it('tracks held, just-pressed and just-released per sample', () => {
    target.dispatchEvent(key('keydown', 'KeyA'));
    let s = input.sample();
    expect(s.down.left && s.pressed.left).toBe(true);
    s = input.sample();
    expect(s.down.left).toBe(true);
    expect(s.pressed.left).toBe(false);
    target.dispatchEvent(key('keyup', 'KeyA'));
    s = input.sample();
    expect(s.down.left).toBe(false);
    expect(s.released.left).toBe(true);
  });

  it('never loses a tap shorter than one step', () => {
    target.dispatchEvent(key('keydown', 'Space'));
    target.dispatchEvent(key('keyup', 'Space'));
    const s = input.sample();
    expect(s.pressed.jump && s.released.jump && s.down.jump).toBe(true);
  });

  it('prevents default only for bound keys while active', () => {
    const bound = key('keydown', 'Space');
    target.dispatchEvent(bound);
    expect(bound.defaultPrevented).toBe(true);
    const unbound = key('keydown', 'KeyZ');
    target.dispatchEvent(unbound);
    expect(unbound.defaultPrevented).toBe(false);
    input.active = false;
    const inactive = key('keydown', 'KeyW');
    target.dispatchEvent(inactive);
    expect(inactive.defaultPrevented).toBe(false);
  });

  it('supports rebinding', () => {
    const b = structuredClone(DEFAULT_BINDINGS);
    b.jump = ['KeyJ'];
    input.setBindings(b);
    target.dispatchEvent(key('keydown', 'KeyJ'));
    expect(input.sample().pressed.jump).toBe(true);
    target.dispatchEvent(key('keydown', 'Space'));
    expect(input.sample().pressed.jump).toBe(false);
  });

  it('ignores key repeat and does not register listeners twice', () => {
    input.attach(target as unknown as Window);
    target.dispatchEvent(key('keydown', 'KeyQ'));
    target.dispatchEvent(key('keydown', 'KeyQ', true));
    const s = input.sample();
    expect(s.pressed.grab1).toBe(true);
    target.dispatchEvent(key('keyup', 'KeyQ'));
    expect(input.sample().released.grab1).toBe(true);
  });

  it('sanitises stored settings', () => {
    const s = sanitizeSettings({
      resolutionScale: 9,
      camera: { fov: 'x' },
      bindings: { jump: ['KeyK'] },
      graphics: 'ultra',
    });
    expect(s.resolutionScale).toBe(1);
    expect(s.camera.fov).toBe(62);
    expect(s.bindings.jump).toEqual(['KeyK']);
    expect(s.graphics).toBe('high');
  });
});
