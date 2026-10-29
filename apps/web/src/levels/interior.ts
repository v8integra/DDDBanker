import * as THREE from 'three';
import { StaticBatcher } from '../engine/batcher';
import type { Interactable, Point2 } from '../interaction/interactables';
import { TriggerZone, inZone } from '../interaction/triggers';
import type { Character } from '../player/character';
import { clampToBounds } from '../player/steering';
import { stationSpot } from '../stations/stations';
import { interior, interiorPalette } from '../theme';
import { buildInterior, type BuiltStation } from '../world/interior';
import { addSun, levelBase, type Level } from './level';

export interface InteriorHooks {
  leaveBank(): void;
  talkTo(station: BuiltStation): void;
  readInfoBoard(): void;
  bumpGate(): void;
}

export const INTERIOR_ARRIVAL = { ...interior.arrival, y: 0 };
/** Where you're sent if your session ends while you're in the hall. */
export const LOBBY_RETURN = { x: 0, y: 0, z: interior.gate.z - 4, facing: Math.PI };

/** Level 2: the lobby and the banking hall. */
export async function buildInteriorLevel(
  character: Character,
  camera: THREE.PerspectiveCamera,
  hooks: InteriorHooks,
) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(interiorPalette.ceiling);
  scene.add(new THREE.HemisphereLight('#fff8ec', '#d9c7a8', 1.9));
  // Soft light from high above the gate so desks and staff cast gentle shadows.
  const sun = addSun(scene, '#fff1d6', 1.3, [6, 30, 6], [0, 0, 18], 26);

  const base = await levelBase(character, camera, INTERIOR_ARRIVAL);
  const root = new THREE.Group();
  root.name = 'interior';
  const batch = new StaticBatcher();
  const ctx = { batch, physics: base.physics, y: 0 };
  const built = buildInterior(ctx, root);
  root.add(batch.build());
  scene.add(root);

  const stationInteractables: Interactable[] = built.stations.map((station) => {
    const spot = stationSpot(station.def);
    return {
      id: `station:${station.def.id}`,
      prompt: station.def.staff
        ? `Talk to ${station.def.staff.name} (${station.def.title})`
        : `Check ${station.def.title}`,
      spot,
      radius: station.def.kind === 'round' ? 1.5 : 1.3,
      anchor: station.anchor,
      lookAt: station.npc
        ? { x: station.npc.position.x, z: station.npc.position.z }
        : station.def.position,
      clickTargets: station.clickTargets,
      onInteract: () => hooks.talkTo(station),
    };
  });

  const interactables: Interactable[] = [
    ...stationInteractables,
    {
      id: 'info-board',
      prompt: 'Read the information board',
      spot: built.infoBoard.spot,
      radius: 1.3,
      anchor: built.infoBoard.anchor,
      clickTargets: [built.infoBoard.mesh],
      onInteract: hooks.readInfoBoard,
    },
    {
      id: 'exit-door',
      prompt: 'Leave the bank',
      spot: { x: 0, z: 1.3 },
      radius: 1.2,
      anchor: { x: 0, y: 3.6, z: 0.4 },
      clickTargets: [built.door.group],
      onInteract: hooks.leaveBank,
    },
  ];

  const g = interior.gate;
  const triggers = [
    new TriggerZone(interior.exitZone, hooks.leaveBank),
    // Walking into the locked gate bumps it and explains why.
    new TriggerZone(
      { minX: -g.halfOpening, maxX: g.halfOpening, minZ: g.z - 1.0, maxZ: g.z },
      hooks.bumpGate,
      () => built.gate.isLocked,
    ),
  ];

  const areaOf = (p: Point2) => (p.z < g.z ? interior.lobby : interior.hall);
  const npcs = built.stations.flatMap((s) => (s.npc ? [s.npc] : []));

  const level: Level = {
    id: 'interior',
    scene,
    sun,
    ...base,
    walkables: built.walkables,
    interactables,
    triggers,
    clampTarget: (p) => clampToBounds(p, areaOf(p), 0.6),
    locationAt: (p) => (inZone(interior.lobby, p) ? 'Lobby' : 'Banking Hall'),
    update: (dt, reducedMotion) => {
      built.door.update(dt, reducedMotion);
      built.gate.update(dt, reducedMotion);
      for (const npc of npcs) npc.update(dt, reducedMotion);
    },
  };
  return { level, door: built.door, gate: built.gate, stations: built.stations };
}
