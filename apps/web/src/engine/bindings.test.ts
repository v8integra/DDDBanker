import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BINDINGS,
  applyDeadzone,
  canBind,
  isClick,
  keyboardMoveIntent,
  rebind,
  resolveBindings,
} from './bindings';

const intent = (...codes: string[]) => keyboardMoveIntent(new Set(codes), DEFAULT_BINDINGS);

describe('keyboardMoveIntent', () => {
  it('maps WASD and arrows the same way', () => {
    expect(intent('KeyW')).toEqual({ x: 0, z: 1 });
    expect(intent('ArrowUp')).toEqual({ x: 0, z: 1 });
    expect(intent('KeyA')).toEqual({ x: -1, z: 0 });
    expect(intent('ArrowRight')).toEqual({ x: 1, z: 0 });
  });

  it('normalizes diagonals so they are not faster', () => {
    const d = intent('KeyW', 'KeyD');
    expect(Math.hypot(d.x, d.z)).toBeCloseTo(1);
  });

  it('cancels opposite keys', () => {
    expect(intent('KeyW', 'KeyS')).toEqual({ x: 0, z: 0 });
    expect(intent()).toEqual({ x: 0, z: 0 });
  });
});

describe('applyDeadzone', () => {
  it('ignores drift and rescales the rest', () => {
    expect(applyDeadzone(0.1, 0.05)).toEqual({ x: 0, y: 0 });
    expect(applyDeadzone(1, 0).x).toBeCloseTo(1);
    const half = applyDeadzone(0.59, 0);
    expect(half.x).toBeGreaterThan(0.45);
    expect(half.x).toBeLessThan(0.55);
  });
});

describe('isClick', () => {
  const down = { x: 100, y: 100, time: 0 };
  it('treats a short, still press as a click', () => {
    expect(isClick(down, { x: 103, y: 102, time: 150 })).toBe(true);
  });
  it('treats movement or a long hold as a drag', () => {
    expect(isClick(down, { x: 120, y: 100, time: 150 })).toBe(false);
    expect(isClick(down, { x: 100, y: 100, time: 900 })).toBe(false);
  });
});

describe('canBind', () => {
  it('refuses system keys and the reserved Escape', () => {
    expect(canBind('KeyQ')).toBe(true);
    expect(canBind('Tab')).toBe(false);
    expect(canBind('Escape')).toBe(false);
    expect(canBind('')).toBe(false);
  });
});

describe('resolveBindings', () => {
  it('falls back to defaults for junk and unknown actions', () => {
    expect(resolveBindings({})).toEqual(DEFAULT_BINDINGS);
    const r = resolveBindings({ fly: ['KeyF'], forward: 'KeyI' as never, back: [] });
    expect(r).toEqual(DEFAULT_BINDINGS);
  });

  it('applies overrides, drops bad codes, and keeps two keys at most', () => {
    const r = resolveBindings({ forward: ['KeyI', 'Tab', 'KeyK', 'KeyL'] });
    expect(r.forward).toEqual(['KeyI', 'KeyK']);
  });

  it('always keeps Escape on pause', () => {
    expect(resolveBindings({ pause: ['KeyQ'] }).pause).toEqual(['Escape', 'KeyQ']);
    expect(resolveBindings({ pause: ['Escape'] }).pause).toEqual(['Escape']);
  });
});

describe('rebind', () => {
  it('makes the new key primary and keeps the second key', () => {
    const next = rebind(DEFAULT_BINDINGS, 'forward', 'KeyI');
    expect(next.forward).toEqual(['KeyI', 'ArrowUp']);
    const again = rebind(resolveBindings(next), 'forward', 'KeyO');
    expect(again.forward).toEqual(['KeyO', 'ArrowUp']);
    const single = rebind(DEFAULT_BINDINGS, 'travel', 'KeyG');
    expect(single.travel).toEqual(['KeyG']);
  });

  it('takes the key away from any other action so keys are never shared', () => {
    const next = rebind(DEFAULT_BINDINGS, 'travel', 'KeyE');
    expect(next.travel[0]).toBe('KeyE');
    expect(next.interact).toEqual(['Enter']);
    expect(resolveBindings(next).pause).toEqual(['Escape', 'KeyP']);
  });
});
