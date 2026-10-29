import * as THREE from 'three';
import { StaticBatcher } from '../engine/batcher';
import type { Physics } from '../engine/physics';
import { layout, palette } from '../theme';
import { buildBank } from '../world/bank';
import { buildNeighbors, buildStreet } from '../world/street';

export interface ExteriorScene {
  scene: THREE.Scene;
  sun: THREE.DirectionalLight;
  /** Surfaces click-to-move may target. */
  walkables: THREE.Mesh[];
  spawn: { x: number; y: number; z: number; facing: number };
  locationName: string;
}

/** Scene 1: the block outside the bank. */
export function buildExteriorScene(physics: Physics): ExteriorScene {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(palette.sky);
  scene.fog = new THREE.Fog(palette.fog, 32, 85);

  scene.add(new THREE.HemisphereLight(palette.hemiSky, palette.hemiGround, 1.4));
  // Sun from the street side, so the bank's facade is lit.
  const sun = new THREE.DirectionalLight(palette.sun, 2.4);
  sun.position.set(14, 26, -18);
  sun.target.position.set(0, 0, 0);
  const shadowCam = sun.shadow.camera;
  shadowCam.left = -30;
  shadowCam.right = 30;
  shadowCam.top = 30;
  shadowCam.bottom = -30;
  shadowCam.near = 1;
  shadowCam.far = 80;
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.03;
  scene.add(sun, sun.target);

  const root = new THREE.Group();
  root.name = 'exterior';
  const batch = new StaticBatcher();
  const ctx = { batch, physics, y: layout.sidewalkHeight };

  const walkables = buildStreet(ctx, root);
  buildBank(ctx, root);
  buildNeighbors(ctx, root);
  root.add(batch.build());
  scene.add(root);

  return {
    scene,
    sun,
    walkables,
    spawn: { ...layout.spawn, y: layout.sidewalkHeight },
    locationName: 'Bramblewood Street',
  };
}
