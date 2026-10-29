import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { FrameInput } from '../engine/input';
import type { Physics } from '../engine/physics';
import type { Settings } from '../settings/settings';
import { camera as tuning } from '../theme';
import { applyOrbitInput, orbitOffset, type Orbit } from './orbit';

/** Fixed-camera mode: a steady view from behind, a little higher up. */
const FIXED_ORBIT: Orbit = { yaw: 0, pitch: 0.55, distance: 9 };
const MIN_DISTANCE_WHEN_BLOCKED = 0.8;
const WALL_MARGIN = 0.3;

/**
 * Third-person camera that orbits the player and pulls in when scenery is
 * between them, so it never ends up inside a wall.
 */
export class FollowCamera {
  readonly camera: THREE.PerspectiveCamera;
  orbit: Orbit = { yaw: 0, pitch: tuning.defaultPitch, distance: tuning.defaultDistance };
  private readonly lookAt = new THREE.Vector3();
  private currentDistance = tuning.defaultDistance;
  private readonly ray: RAPIER.Ray;
  private initialized = false;

  constructor(
    private readonly physics: Physics,
    private readonly ignore: RAPIER.Collider,
  ) {
    this.camera = new THREE.PerspectiveCamera(tuning.fov, 1, 0.1, 200);
    this.ray = new physics.rapier.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 });
  }

  /** Yaw used to turn keyboard/stick input into world directions. */
  get yaw() {
    return this.orbit.yaw;
  }

  update(dt: number, target: THREE.Vector3, input: FrameInput, settings: Settings) {
    // Fixed camera still allows zoom, but yaw and pitch stay put.
    const base = settings.fixedCamera
      ? { ...FIXED_ORBIT, distance: this.orbit.distance }
      : this.orbit;
    const turn = settings.fixedCamera
      ? { yaw: 0, pitch: 0 }
      : { yaw: input.orbitYaw, pitch: input.orbitPitch };
    this.orbit = applyOrbitInput(
      base,
      { ...turn, zoom: input.zoom },
      {
        sensitivity: settings.cameraSensitivity,
        invertY: settings.invertY,
      },
    );

    const goal = new THREE.Vector3(target.x, target.y + tuning.targetHeight, target.z);
    if (!this.initialized) {
      this.lookAt.copy(goal);
      this.initialized = true;
    } else {
      // Gentle follow: smooth enough to hide physics jitter, snappy enough to avoid sway.
      this.lookAt.lerp(goal, 1 - Math.exp(-dt * (settings.reducedMotion ? 30 : 12)));
    }

    const offset = orbitOffset(this.orbit);
    const direction = new THREE.Vector3(offset.x, offset.y, offset.z).normalize();
    const allowed = this.clearDistance(direction, this.orbit.distance);

    // Pull in immediately when blocked; ease back out once clear.
    this.currentDistance =
      allowed < this.currentDistance
        ? allowed
        : this.currentDistance + (allowed - this.currentDistance) * (1 - Math.exp(-dt * 4));

    this.camera.position.copy(this.lookAt).addScaledVector(direction, this.currentDistance);
    this.camera.lookAt(this.lookAt);
  }

  private clearDistance(direction: THREE.Vector3, wanted: number) {
    this.ray.origin = { x: this.lookAt.x, y: this.lookAt.y, z: this.lookAt.z };
    this.ray.dir = { x: direction.x, y: direction.y, z: direction.z };
    const hit = this.physics.world.castRay(
      this.ray,
      wanted + WALL_MARGIN,
      true,
      undefined,
      undefined,
      this.ignore,
    );
    if (!hit) return wanted;
    return Math.max(MIN_DISTANCE_WHEN_BLOCKED, Math.min(wanted, hit.timeOfImpact - WALL_MARGIN));
  }
}
