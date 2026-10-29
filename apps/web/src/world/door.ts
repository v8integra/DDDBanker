import * as THREE from 'three';
import { toon } from '../engine/materials';
import { palette } from '../theme';

const OPEN_ANGLE = Math.PI * 0.45;
const SWING_SPEED = 5; // per second, eased

/**
 * Animated double door. The group's origin is the bottom-center of the
 * doorway; panels hang from hinges at either side. `swing` picks which way
 * they open: +1 toward +Z, -1 toward -Z.
 */
export class DoubleDoor {
  readonly group = new THREE.Group();
  private readonly hinges: THREE.Group[] = [];
  private openness = 0;
  private target = 0;

  constructor(
    width: number,
    height: number,
    private readonly swing: 1 | -1,
  ) {
    const panelWidth = width / 2 - 0.03;
    for (const side of [-1, 1]) {
      const hinge = new THREE.Group();
      hinge.position.x = (side * width) / 2;
      const towardCenter = -side;

      const slab = new THREE.Mesh(
        new THREE.BoxGeometry(panelWidth, height, 0.1),
        toon(palette.door),
      );
      slab.position.set((towardCenter * panelWidth) / 2, height / 2, 0);
      const glass = new THREE.Mesh(
        new THREE.BoxGeometry(panelWidth - 0.45, height * 0.55, 0.12),
        toon(palette.doorGlass, { emissive: palette.doorGlass }),
      );
      glass.position.set((towardCenter * panelWidth) / 2, height * 0.62, 0);
      const handle = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.5, 0.2), toon(palette.brass));
      handle.position.set(towardCenter * (panelWidth - 0.15), height * 0.42, 0);

      for (const mesh of [slab, glass, handle]) mesh.castShadow = true;
      hinge.add(slab, glass, handle);
      this.hinges.push(hinge);
      this.group.add(hinge);
    }
  }

  get isOpen() {
    return this.openness > 0.95;
  }

  open() {
    this.target = 1;
  }

  close() {
    this.target = 0;
  }

  update(dt: number, reducedMotion: boolean) {
    this.openness = reducedMotion
      ? this.target
      : this.openness + (this.target - this.openness) * (1 - Math.exp(-dt * SWING_SPEED));
    const angle = this.openness * OPEN_ANGLE * this.swing;
    // Left panel (hinge at -X, extends +X) turns by -angle to swing toward +Z; right mirrors it.
    this.hinges[0]!.rotation.y = -angle;
    this.hinges[1]!.rotation.y = angle;
  }
}
