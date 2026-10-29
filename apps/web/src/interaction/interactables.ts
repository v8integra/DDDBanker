import type { Object3D } from 'three';

export interface Point2 {
  x: number;
  z: number;
}

/**
 * Anything the player can use with E / Enter / A / a tap: station staff,
 * doors, the info board. Generic on purpose: stations, a future mall's
 * shops, and so on all plug in the same way.
 */
export interface Interactable {
  id: string;
  /** Verb phrase for the prompt: "Talk to the teller", "Enter the bank". */
  prompt: string;
  /** Where the player stands to use it. */
  spot: Point2;
  /** How close (meters) the player must be to `spot`. */
  radius: number;
  /** World point the floating prompt hovers over. */
  anchor: { x: number; y: number; z: number };
  /** Point the player turns to face when interacting (defaults to the anchor). */
  lookAt?: Point2;
  /** Meshes you can click to walk over and use it. */
  clickTargets?: Object3D[];
  /** Hidden from prompts while this returns false. */
  available?: () => boolean;
  onInteract: () => void | Promise<void>;
}

/**
 * The interactable the player is "at": within reach, nearest first, with a
 * nudge toward things in front of them so turning picks between neighbors.
 */
export function pickInteractable(
  items: readonly Interactable[],
  player: Point2,
  heading: number,
): Interactable | null {
  const facing = { x: Math.sin(heading), z: Math.cos(heading) };
  let best: Interactable | null = null;
  let bestScore = Infinity;
  for (const item of items) {
    if (item.available && !item.available()) continue;
    const dx = item.spot.x - player.x;
    const dz = item.spot.z - player.z;
    const distance = Math.hypot(dx, dz);
    if (distance > item.radius) continue;

    const toward = item.lookAt ?? { x: item.anchor.x, z: item.anchor.z };
    const tx = toward.x - player.x;
    const tz = toward.z - player.z;
    const length = Math.hypot(tx, tz) || 1;
    const alignment = (tx * facing.x + tz * facing.z) / length; // -1 behind .. 1 ahead
    const score = distance - alignment * 0.5;
    if (score < bestScore) {
      bestScore = score;
      best = item;
    }
  }
  return best;
}
