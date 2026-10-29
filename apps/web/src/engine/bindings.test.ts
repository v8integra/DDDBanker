import { describe, expect, it } from 'vitest';
import { DEFAULT_BINDINGS, applyDeadzone, isClick, keyboardMoveIntent } from './bindings';

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
