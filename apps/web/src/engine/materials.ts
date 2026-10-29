import * as THREE from 'three';

/** 3-band toon shading for the cozy flat look. */
const gradientMap = (() => {
  const texture = new THREE.DataTexture(new Uint8Array([90, 170, 255]), 3, 1, THREE.RedFormat);
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.needsUpdate = true;
  return texture;
})();

const cache = new Map<string, THREE.MeshToonMaterial>();

/** Shared toon material per color (and glow). Sharing keeps materials, and draw calls, down. */
export function toon(
  color: string,
  { emissive }: { emissive?: string } = {},
): THREE.MeshToonMaterial {
  const key = `${color}|${emissive ?? ''}`;
  let material = cache.get(key);
  if (!material) {
    material = new THREE.MeshToonMaterial({ color, gradientMap });
    if (emissive) {
      material.emissive = new THREE.Color(emissive);
      material.emissiveIntensity = 0.9;
    }
    cache.set(key, material);
  }
  return material;
}

export function allMaterials(): Iterable<THREE.Material> {
  return cache.values();
}
