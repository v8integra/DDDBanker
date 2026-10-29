/** Click-to-move steering, kept free of Three.js and Rapier so it can be unit tested. */

export interface Point2 {
  x: number;
  z: number;
}

export const ARRIVE_DISTANCE = 0.15;
/** Slow down over the last stretch so the character doesn't overshoot. */
const SLOW_RADIUS = 0.8;

/** Desired horizontal velocity toward `target`, or null once arrived. */
export function steerToward(position: Point2, target: Point2, speed: number): Point2 | null {
  const dx = target.x - position.x;
  const dz = target.z - position.z;
  const distance = Math.hypot(dx, dz);
  if (distance <= ARRIVE_DISTANCE) return null;
  const scaled = distance < SLOW_RADIUS ? speed * Math.max(0.35, distance / SLOW_RADIUS) : speed;
  return { x: (dx / distance) * scaled, z: (dz / distance) * scaled };
}

/**
 * Detects a walk target the character can't reach (a wall in the way):
 * if it makes almost no progress for `patienceSeconds`, give up.
 */
export class StuckDetector {
  private bestDistance = Infinity;
  private stalledFor = 0;

  constructor(private readonly patienceSeconds = 0.6) {}

  reset() {
    this.bestDistance = Infinity;
    this.stalledFor = 0;
  }

  /** Returns true when the walk should be abandoned. */
  update(distanceToTarget: number, dt: number): boolean {
    if (distanceToTarget < this.bestDistance - 0.02) {
      this.bestDistance = distanceToTarget;
      this.stalledFor = 0;
      return false;
    }
    this.stalledFor += dt;
    return this.stalledFor >= this.patienceSeconds;
  }
}

export function clampToBounds(
  point: Point2,
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number },
  margin = 0.4,
): Point2 {
  return {
    x: Math.min(bounds.maxX - margin, Math.max(bounds.minX + margin, point.x)),
    z: Math.min(bounds.maxZ - margin, Math.max(bounds.minZ + margin, point.z)),
  };
}
