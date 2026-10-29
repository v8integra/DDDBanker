import * as THREE from 'three';
import { FollowCamera } from '../camera/followCamera';
import { Physics } from '../engine/physics';
import type { Interactable, Point2 } from '../interaction/interactables';
import type { TriggerZone } from '../interaction/triggers';
import type { Character } from '../player/character';
import { Player } from '../player/player';

export type LevelId = 'exterior' | 'interior';

export interface Spawn {
  x: number;
  y: number;
  z: number;
  facing: number;
}

/**
 * One playable scene with its own physics world. The game swaps levels when
 * you go through a door; the Character moves along with you.
 */
export interface Level {
  id: LevelId;
  scene: THREE.Scene;
  sun: THREE.DirectionalLight;
  physics: Physics;
  player: Player;
  follow: FollowCamera;
  walkables: THREE.Mesh[];
  interactables: Interactable[];
  triggers: TriggerZone[];
  /** Keep a click-to-move target somewhere reachable. */
  clampTarget(point: Point2): Point2;
  locationAt(point: Point2): string;
  /** Doors, gate, staff: things that animate on their own. */
  update(dt: number, reducedMotion: boolean): void;
}

/** Common setup: physics world, a player capsule in it, and a follow camera. */
export async function levelBase(
  character: Character,
  camera: THREE.PerspectiveCamera,
  spawn: Spawn,
) {
  const physics = await Physics.create();
  const player = new Player(physics, character, spawn);
  const follow = new FollowCamera(physics, player.collider, camera);
  return { physics, player, follow };
}

export function addSun(
  scene: THREE.Scene,
  color: string,
  intensity: number,
  position: [number, number, number],
  target: [number, number, number],
  extent: number,
) {
  const sun = new THREE.DirectionalLight(color, intensity);
  sun.position.set(...position);
  sun.target.position.set(...target);
  const cam = sun.shadow.camera;
  cam.left = -extent;
  cam.right = extent;
  cam.top = extent;
  cam.bottom = -extent;
  cam.near = 1;
  cam.far = 90;
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.03;
  scene.add(sun, sun.target);
  return sun;
}
