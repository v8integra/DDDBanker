import { describe, expect, it } from 'vitest';
import {
  ORBIT_LIMITS,
  applyOrbitInput,
  cameraRelativeMove,
  headingOf,
  orbitOffset,
  turnToward,
  wrapAngle,
} from './orbit';

const opts = { sensitivity: 1, invertY: false };

describe('orbitOffset', () => {
  it('puts the camera behind (south of) the player at yaw 0', () => {
    const o = orbitOffset({ yaw: 0, pitch: 0, distance: 5 });
    expect(o.x).toBeCloseTo(0);
    expect(o.y).toBeCloseTo(0);
    expect(o.z).toBeCloseTo(-5);
  });

  it('keeps the requested distance at any angle', () => {
    const o = orbitOffset({ yaw: 1.1, pitch: 0.6, distance: 7 });
    expect(Math.hypot(o.x, o.y, o.z)).toBeCloseTo(7);
    expect(o.y).toBeGreaterThan(0);
  });
});

describe('cameraRelativeMove', () => {
  it('walks away from the camera when pushing forward', () => {
    const yaw = 0.8;
    const move = cameraRelativeMove({ x: 0, z: 1 }, yaw);
    const cam = orbitOffset({ yaw, pitch: 0, distance: 1 });
    // Forward is the opposite of the camera's horizontal offset.
    expect(move.x).toBeCloseTo(-cam.x);
    expect(move.z).toBeCloseTo(-cam.z);
  });

  it('strafes to screen-right: -X when looking toward +Z', () => {
    const right = cameraRelativeMove({ x: 1, z: 0 }, 0);
    expect(right.x).toBeCloseTo(-1);
    expect(right.z).toBeCloseTo(0);
  });
});

describe('applyOrbitInput', () => {
  const base = { yaw: 0, pitch: 0.5, distance: 7 };

  it('clamps pitch and distance', () => {
    const extreme = applyOrbitInput(base, { yaw: 0, pitch: 10, zoom: 100 }, opts);
    expect(extreme.pitch).toBe(ORBIT_LIMITS.maxPitch);
    expect(extreme.distance).toBe(ORBIT_LIMITS.maxDistance);
    const other = applyOrbitInput(base, { yaw: 0, pitch: -10, zoom: -100 }, opts);
    expect(other.pitch).toBe(ORBIT_LIMITS.minPitch);
    expect(other.distance).toBe(ORBIT_LIMITS.minDistance);
  });

  it('applies sensitivity and invert-Y', () => {
    expect(
      applyOrbitInput(base, { yaw: 0.1, pitch: 0, zoom: 0 }, { sensitivity: 2, invertY: false })
        .yaw,
    ).toBeCloseTo(0.2);
    expect(
      applyOrbitInput(base, { yaw: 0, pitch: 0.1, zoom: 0 }, { sensitivity: 1, invertY: true })
        .pitch,
    ).toBeCloseTo(0.4);
  });

  it('keeps yaw wrapped', () => {
    expect(applyOrbitInput(base, { yaw: 7, pitch: 0, zoom: 0 }, opts).yaw).toBeCloseTo(
      wrapAngle(7),
    );
  });
});

describe('angles', () => {
  it('wraps into (-PI, PI]', () => {
    expect(wrapAngle(Math.PI * 3)).toBeCloseTo(Math.PI);
    expect(wrapAngle(-Math.PI)).toBeCloseTo(Math.PI);
    expect(wrapAngle(0.5)).toBeCloseTo(0.5);
  });

  it('turns the short way round', () => {
    // From just left of "behind" to just right of it: go through PI, not through 0.
    const next = turnToward(3, -3, 0.1);
    expect(next).toBeCloseTo(3.1);
    expect(turnToward(0, 0.05, 0.1)).toBeCloseTo(0.05);
  });

  it('heading 0 faces +Z', () => {
    expect(headingOf(0, 1)).toBeCloseTo(0);
    expect(headingOf(1, 0)).toBeCloseTo(Math.PI / 2);
  });
});
