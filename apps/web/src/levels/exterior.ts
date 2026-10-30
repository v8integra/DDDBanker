import * as THREE from 'three';
import { StaticBatcher } from '../engine/batcher';
import type { Interactable } from '../interaction/interactables';
import { TriggerZone } from '../interaction/triggers';
import type { Character } from '../player/character';
import { clampToBounds } from '../player/steering';
import { layout, palette } from '../theme';
import { buildBank } from '../world/bank';
import { buildNeighbors, buildStreet } from '../world/street';
import { addSun, levelBase, type Level } from './level';

export interface ExteriorHooks {
  enterBank(): void;
  useAtm(): void;
  readPlaque(): void;
}

export const EXTERIOR_SPAWN = { ...layout.spawn, y: layout.sidewalkHeight };
/** Where you stand after walking out of the bank: on the steps, facing the street. */
/** Standing at the outdoor ATM (quick travel). */
export const ATM_SPOT = {
  x: 5.3,
  y: layout.sidewalkHeight,
  z: layout.bank.frontZ - 1.0,
  facing: 0,
};
export const BANK_EXIT_SPAWN = { x: 0, y: layout.sidewalkHeight, z: 1.8, facing: Math.PI };

/** Level 1: the block outside the bank. */
export async function buildExteriorLevel(
  character: Character,
  camera: THREE.PerspectiveCamera,
  hooks: ExteriorHooks,
) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(palette.sky);
  scene.fog = new THREE.Fog(palette.fog, 32, 85);
  scene.add(new THREE.HemisphereLight(palette.hemiSky, palette.hemiGround, 1.4));
  // Sun from the street side, so the bank's facade is lit.
  const sun = addSun(scene, palette.sun, 2.4, [14, 26, -18], [0, 0, 0], 30);

  const base = await levelBase(character, camera, EXTERIOR_SPAWN);
  const root = new THREE.Group();
  root.name = 'exterior';
  const batch = new StaticBatcher();
  const ctx = { batch, physics: base.physics, y: layout.sidewalkHeight };
  const walkables = buildStreet(ctx, root);
  const door = buildBank(ctx, root);
  buildNeighbors(ctx, root);
  root.add(batch.build());
  scene.add(root);

  const S = layout.sidewalkHeight;
  const front = layout.bank.frontZ;
  const interactables: Interactable[] = [
    {
      id: 'front-door',
      prompt: 'Enter the bank',
      spot: { x: 0, z: front - 1.0 },
      radius: 1.7,
      anchor: { x: 0, y: S + 3.8, z: front - 0.2 },
      clickTargets: [door.group],
      onInteract: hooks.enterBank,
    },
    {
      id: 'atm',
      prompt: 'Use the ATM',
      spot: { x: 5.3, z: front - 1.0 },
      radius: 1.1,
      anchor: { x: 5.3, y: S + 2.6, z: front - 0.3 },
      onInteract: hooks.useAtm,
    },
    {
      id: 'plaque',
      prompt: 'Read the sign',
      spot: { x: -2.4, z: layout.spawn.z - 0.1 },
      radius: 1.2,
      anchor: { x: -2.4, y: S + 2.25, z: layout.spawn.z + 1.2 },
      onInteract: hooks.readPlaque,
    },
  ];

  // Walking right up to the doors goes in, no key needed.
  const doorZone = new TriggerZone(
    { minX: -1.3, maxX: 1.3, minZ: front - 0.75, maxZ: front },
    hooks.enterBank,
  );

  const level: Level = {
    id: 'exterior',
    scene,
    sun,
    ...base,
    walkables,
    interactables,
    triggers: [doorZone],
    clampTarget: (p) => clampToBounds(p, layout.bounds),
    locationAt: () => 'Bramblewood Street',
    update: (dt, reducedMotion) => door.update(dt, reducedMotion),
  };
  return { level, door };
}
