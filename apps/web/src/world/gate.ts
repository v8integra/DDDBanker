import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { toon } from '../engine/materials';
import type { Physics } from '../engine/physics';
import { interior, interiorPalette as ip } from '../theme';
import { createSignFace } from './props/signs';

const ARM_LENGTH = 1.45;
const OPEN_ANGLE = Math.PI * 0.48;
const SHAKE_SECONDS = 0.45;

/**
 * The security gate between the lobby and the banking hall. Purely a picture
 * of the session state: the API rejects unauthenticated calls regardless.
 * Status uses color, an icon, and words, so it never relies on color alone.
 */
export class SecurityGate {
  readonly group = new THREE.Group();
  private readonly arms: THREE.Group[] = [];
  private readonly lights: THREE.Mesh[] = [];
  private readonly lockedSign: THREE.Mesh;
  private readonly openSign: THREE.Mesh;
  private readonly barrier: RAPIER.Collider;
  private locked = true;
  private openness = 0;
  private shake = 0;

  constructor(physics: Physics) {
    const z = interior.gate.z;
    const half = interior.gate.halfOpening;
    this.group.position.set(0, 0, z);

    for (const side of [-1, 1]) {
      const postX = side * (half - 0.15);
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.3, 1.3, 0.55), toon(ip.gatePost));
      post.position.set(postX, 0.65, 0);
      const light = new THREE.Mesh(
        new THREE.BoxGeometry(0.32, 0.14, 0.57),
        toon(ip.gateLocked, { emissive: ip.gateLocked }),
      );
      light.position.set(postX, 1.37, 0);
      this.lights.push(light);

      // Arm hinged at the post, reaching toward the middle; swings into the hall (+Z).
      const hinge = new THREE.Group();
      hinge.position.set(side * (half - 0.3), 0, 0);
      const glass = new THREE.Mesh(
        new THREE.BoxGeometry(ARM_LENGTH, 0.95, 0.05),
        new THREE.MeshToonMaterial({ color: ip.gateGlass, transparent: true, opacity: 0.55 }),
      );
      glass.position.set((-side * ARM_LENGTH) / 2, 0.75, 0);
      const rail = new THREE.Mesh(new THREE.BoxGeometry(ARM_LENGTH, 0.06, 0.08), toon(ip.gatePost));
      rail.position.set((-side * ARM_LENGTH) / 2, 1.25, 0);
      hinge.add(glass, rail);
      this.arms.push(hinge);

      for (const m of [post, light, rail]) m.castShadow = true;
      this.group.add(post, light, hinge);
    }

    // Status sign over the arch, facing the lobby. Two faces, one visible at a time.
    const sign = (lines: string[], background: string) => {
      const face = createSignFace({ width: 3.2, height: 0.7, background, color: '#fbf6ec', lines });
      face.position.set(0, interior.gate.archHeight + 0.5, -0.27);
      this.group.add(face);
      return face;
    };
    this.lockedSign = sign(['⛔  Please check in first'], '#a8372c');
    this.openSign = sign(['✓  Welcome, come on in'], '#2e7d46');

    this.barrier = physics.addBox({ x: 0, y: 1, z }, { x: half, y: 1, z: 0.15 });
    this.apply();
  }

  get isLocked() {
    return this.locked;
  }

  setLocked(locked: boolean) {
    this.locked = locked;
    this.barrier.setEnabled(locked);
    this.apply();
  }

  /** Bump feedback when someone walks into the locked gate. */
  bump() {
    this.shake = SHAKE_SECONDS;
  }

  update(dt: number, reducedMotion: boolean) {
    const target = this.locked ? 0 : 1;
    this.openness = reducedMotion
      ? target
      : this.openness + (target - this.openness) * (1 - Math.exp(-dt * 5));
    let wobble = 0;
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt);
      wobble = reducedMotion ? 0 : Math.sin(this.shake * 60) * 0.06 * (this.shake / SHAKE_SECONDS);
    }
    this.arms[0]!.rotation.y = -this.openness * OPEN_ANGLE + wobble;
    this.arms[1]!.rotation.y = this.openness * OPEN_ANGLE - wobble;
  }

  private apply() {
    const color = this.locked ? ip.gateLocked : ip.gateOpen;
    for (const light of this.lights) light.material = toon(color, { emissive: color });
    this.lockedSign.visible = this.locked;
    this.openSign.visible = !this.locked;
  }
}
