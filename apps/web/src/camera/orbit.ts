/**
 * Pure third-person camera math. Yaw 0 puts the camera south of the player
 * (toward the street) looking north (+Z, toward the bank).
 */
export interface Orbit {
  yaw: number;
  pitch: number;
  distance: number;
}

export const ORBIT_LIMITS = {
  minPitch: 0.08,
  maxPitch: 1.25,
  minDistance: 3,
  maxDistance: 13,
};

export interface OrbitInput {
  /** Horizontal drag/stick in radians before sensitivity. Positive = turn camera right. */
  yaw: number;
  /** Vertical drag/stick in radians before sensitivity. Positive = look further down. */
  pitch: number;
  /** Positive = zoom out. Meters. */
  zoom: number;
}

export function applyOrbitInput(
  orbit: Orbit,
  input: OrbitInput,
  { sensitivity, invertY }: { sensitivity: number; invertY: boolean },
): Orbit {
  const pitchSign = invertY ? -1 : 1;
  return {
    yaw: wrapAngle(orbit.yaw + input.yaw * sensitivity),
    pitch: clamp(
      orbit.pitch + input.pitch * sensitivity * pitchSign,
      ORBIT_LIMITS.minPitch,
      ORBIT_LIMITS.maxPitch,
    ),
    distance: clamp(
      orbit.distance + input.zoom,
      ORBIT_LIMITS.minDistance,
      ORBIT_LIMITS.maxDistance,
    ),
  };
}

/** Camera position relative to the look-at target. */
export function orbitOffset({ yaw, pitch, distance }: Orbit) {
  const flat = Math.cos(pitch) * distance;
  return { x: Math.sin(yaw) * flat, y: Math.sin(pitch) * distance, z: -Math.cos(yaw) * flat };
}

/**
 * Turn a move intent (x = right, z = forward, as seen on screen) into a world
 * direction on the ground, so "up" always walks away from the camera.
 */
export function cameraRelativeMove(intent: { x: number; z: number }, yaw: number) {
  const forward = { x: -Math.sin(yaw), z: Math.cos(yaw) };
  const right = { x: -forward.z, z: forward.x };
  return {
    x: forward.x * intent.z + right.x * intent.x,
    z: forward.z * intent.z + right.z * intent.x,
  };
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

/** Wrap to (-PI, PI]. */
export function wrapAngle(angle: number) {
  const wrapped = ((((angle + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI;
  return wrapped === -Math.PI ? Math.PI : wrapped;
}

/** Rotate `current` toward `target` by at most `maxStep`, the short way round. */
export function turnToward(current: number, target: number, maxStep: number) {
  const diff = wrapAngle(target - current);
  if (Math.abs(diff) <= maxStep) return wrapAngle(target);
  return wrapAngle(current + Math.sign(diff) * maxStep);
}

/** Heading (rotation about Y) for a direction on the ground. 0 faces +Z. */
export function headingOf(dx: number, dz: number) {
  return Math.atan2(dx, dz);
}
