import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { toon } from './materials';

interface Part {
  geometry: THREE.BufferGeometry;
  matrix: THREE.Matrix4;
}

const tmpPosition = new THREE.Vector3();
const tmpQuaternion = new THREE.Quaternion();
const tmpScale = new THREE.Vector3();
const tmpEuler = new THREE.Euler();

export interface PartOptions {
  position?: [number, number, number];
  rotation?: [number, number, number];
  scale?: [number, number, number];
  emissive?: string;
  castShadow?: boolean;
}

/**
 * Collects static scenery parts and merges them into one mesh per material,
 * so a whole street of props costs a couple dozen draw calls instead of hundreds.
 */
export class StaticBatcher {
  private readonly groups = new Map<
    string,
    { color: string; emissive?: string; cast: Part[]; noCast: Part[] }
  >();

  add(geometry: THREE.BufferGeometry, color: string, options: PartOptions = {}) {
    const {
      position = [0, 0, 0],
      rotation = [0, 0, 0],
      scale = [1, 1, 1],
      emissive,
      castShadow = true,
    } = options;
    tmpPosition.set(...position);
    tmpQuaternion.setFromEuler(tmpEuler.set(...rotation));
    tmpScale.set(...scale);
    const matrix = new THREE.Matrix4().compose(tmpPosition, tmpQuaternion, tmpScale);

    const key = `${color}|${emissive ?? ''}`;
    let group = this.groups.get(key);
    if (!group) {
      group = { color, ...(emissive && { emissive }), cast: [], noCast: [] };
      this.groups.set(key, group);
    }
    (castShadow ? group.cast : group.noCast).push({ geometry, matrix });
  }

  /** Box sitting on `base` (its bottom face at base[1]). */
  box(
    size: [number, number, number],
    base: [number, number, number],
    color: string,
    options: Omit<PartOptions, 'position'> = {},
  ) {
    this.add(new THREE.BoxGeometry(...size), color, {
      ...options,
      position: [base[0], base[1] + size[1] / 2, base[2]],
    });
  }

  build(): THREE.Group {
    const root = new THREE.Group();
    root.name = 'static-scenery';
    for (const group of this.groups.values()) {
      for (const [parts, cast] of [
        [group.cast, true],
        [group.noCast, false],
      ] as const) {
        if (parts.length === 0) continue;
        const geometries = parts.map(({ geometry, matrix }) => {
          // Merging requires matching attributes; strip to position + normal.
          const g = (geometry.index ? geometry.toNonIndexed() : geometry.clone()).applyMatrix4(
            matrix,
          );
          for (const name of Object.keys(g.attributes)) {
            if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
          }
          return g;
        });
        const merged = mergeGeometries(geometries, false);
        for (const g of geometries) g.dispose();
        if (!merged) continue;
        const mesh = new THREE.Mesh(
          merged,
          toon(group.color, group.emissive ? { emissive: group.emissive } : {}),
        );
        mesh.castShadow = cast;
        mesh.receiveShadow = true;
        mesh.matrixAutoUpdate = false;
        root.add(mesh);
      }
    }
    for (const group of this.groups.values()) {
      for (const part of [...group.cast, ...group.noCast]) part.geometry.dispose();
    }
    return root;
  }
}
