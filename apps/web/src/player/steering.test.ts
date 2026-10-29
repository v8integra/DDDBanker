import { describe, expect, it } from 'vitest';
import { ARRIVE_DISTANCE, StuckDetector, clampToBounds, steerToward } from './steering';

describe('steerToward', () => {
  it('heads straight at the target at full speed when far', () => {
    const v = steerToward({ x: 0, z: 0 }, { x: 0, z: 10 }, 4)!;
    expect(v.x).toBeCloseTo(0);
    expect(v.z).toBeCloseTo(4);
  });

  it('slows near the target and stops on arrival', () => {
    const near = steerToward({ x: 0, z: 0 }, { x: 0.4, z: 0 }, 4)!;
    expect(Math.hypot(near.x, near.z)).toBeLessThan(4);
    expect(steerToward({ x: 0, z: 0 }, { x: ARRIVE_DISTANCE / 2, z: 0 }, 4)).toBeNull();
  });
});

describe('StuckDetector', () => {
  it('gives up when blocked, not while making progress', () => {
    const stuck = new StuckDetector(0.5);
    let d = 5;
    for (let i = 0; i < 30; i++) expect(stuck.update((d -= 0.1), 1 / 30)).toBe(false);
    for (let i = 0; i < 14; i++) expect(stuck.update(d, 1 / 30)).toBe(false); // ~0.47s stalled
    expect(stuck.update(d, 0.1)).toBe(true);
  });
});

describe('clampToBounds', () => {
  it('keeps targets inside the walkable area', () => {
    const bounds = { minX: -18, maxX: 18, minZ: -13, maxZ: 4 };
    expect(clampToBounds({ x: 50, z: -50 }, bounds)).toEqual({ x: 17.6, z: -12.6 });
    expect(clampToBounds({ x: 1, z: 2 }, bounds)).toEqual({ x: 1, z: 2 });
  });
});
