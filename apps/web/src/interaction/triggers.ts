import type { Point2 } from './interactables';

/** Axis-aligned area on the ground. */
export interface Zone {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export function inZone(zone: Zone, p: Point2) {
  return p.x >= zone.minX && p.x <= zone.maxX && p.z >= zone.minZ && p.z <= zone.maxZ;
}

/**
 * Fires `onEnter` when the player steps into the zone: once per entry,
 * not every frame they stand in it. Used for doors and the gate.
 */
export class TriggerZone {
  private inside = false;

  constructor(
    readonly zone: Zone,
    private readonly onEnter: () => void,
    private readonly enabled: () => boolean = () => true,
  ) {}

  update(p: Point2) {
    const now = inZone(this.zone, p);
    if (now && !this.inside && this.enabled()) this.onEnter();
    this.inside = now;
  }

  /** Treat the player as already inside, e.g. right after spawning in it. */
  markInside(p: Point2) {
    this.inside = inZone(this.zone, p);
  }
}
