import * as THREE from 'three';
import { palette } from '../theme';

/** A flat ring on the ground showing where click-to-move is heading. */
export class ClickMarker {
  readonly mesh: THREE.Mesh;
  private time = 0;

  constructor() {
    const material = new THREE.MeshBasicMaterial({
      color: palette.clickMarker,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(new THREE.RingGeometry(0.22, 0.34, 24), material);
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.renderOrder = 1;
    this.mesh.visible = false;
  }

  show(point: THREE.Vector3) {
    this.mesh.position.set(point.x, point.y + 0.02, point.z);
    this.mesh.visible = true;
    this.time = 0;
  }

  update(dt: number, active: boolean, reducedMotion: boolean) {
    if (!active) {
      this.mesh.visible = false;
      return;
    }
    this.time += dt;
    const pulse = reducedMotion ? 1 : 1 + Math.sin(this.time * 6) * 0.12;
    this.mesh.scale.setScalar(pulse);
  }
}
