import RAPIER from '@dimforge/rapier3d-compat';
import { player as playerTheme } from '../theme';

export type Rapier = typeof RAPIER;

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Rapier world plus helpers for the static colliders the world builders need. */
export class Physics {
  readonly world: RAPIER.World;

  private constructor(readonly rapier: Rapier) {
    // Gravity is applied by the character controller itself; nothing else is dynamic yet.
    this.world = new rapier.World({ x: 0, y: playerTheme.gravity, z: 0 });
  }

  static async create(): Promise<Physics> {
    await RAPIER.init();
    return new Physics(RAPIER);
  }

  /** Axis-aligned (or Y-rotated) static box. `center` is the box's middle. */
  addBox(center: Vec3, half: Vec3, rotationY = 0) {
    const desc = this.rapier.ColliderDesc.cuboid(half.x, half.y, half.z).setTranslation(
      center.x,
      center.y,
      center.z,
    );
    if (rotationY !== 0) {
      desc.setRotation({ x: 0, y: Math.sin(rotationY / 2), z: 0, w: Math.cos(rotationY / 2) });
    }
    return this.world.createCollider(desc);
  }

  /** Upright static cylinder standing on `base`. */
  addCylinder(base: Vec3, height: number, radius: number) {
    const desc = this.rapier.ColliderDesc.cylinder(height / 2, radius).setTranslation(
      base.x,
      base.y + height / 2,
      base.z,
    );
    return this.world.createCollider(desc);
  }

  step(dt: number) {
    this.world.timestep = dt;
    this.world.step();
  }
}
