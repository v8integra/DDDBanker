import * as THREE from 'three';
import { BANK } from '@dddbanker/shared';
import { toon } from '../engine/materials';
import type { StaticBatcher } from '../engine/batcher';
import type { Physics } from '../engine/physics';
import { Npc } from '../npc/npc';
import { STATIONS, staffSpot, type StationDef } from '../stations/stations';
import { interior, interiorPalette as ip, palette } from '../theme';
import { DoubleDoor } from './door';
import { SecurityGate } from './gate';
import { createBlockText } from './props/blockFont';
import { local, type PropContext } from './props/props';
import { createSignFace } from './props/signs';

const { lobby, hall, ceiling: H, wallThickness: T } = interior;

export interface BuiltStation {
  def: StationDef;
  npc: Npc | null;
  /** Meshes you can click to walk over. */
  clickTargets: THREE.Object3D[];
  /** Where the floating prompt hovers. */
  anchor: THREE.Vector3;
}

export interface BuiltInterior {
  walkables: THREE.Mesh[];
  door: DoubleDoor;
  gate: SecurityGate;
  stations: BuiltStation[];
  infoBoard: { anchor: THREE.Vector3; spot: { x: number; z: number }; mesh: THREE.Object3D };
}

/** A wall segment from (x0,z0) to (x1,z1), axis-aligned, standing on the floor. */
function wall(
  ctx: PropContext,
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  height = H,
  base = 0,
) {
  const alongX = Math.abs(x1 - x0) > Math.abs(z1 - z0);
  const length = alongX ? Math.abs(x1 - x0) : Math.abs(z1 - z0);
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  const size: [number, number, number] = alongX ? [length, height, T] : [T, height, length];
  ctx.batch.box(size, [cx, base, cz], ip.wall);
  ctx.physics.addBox(
    { x: cx, y: base + height / 2, z: cz },
    { x: size[0] / 2, y: height / 2, z: size[2] / 2 },
  );
}

/** Wood paneling and a trim line along the inside face of a wall. */
function wainscot(
  batch: StaticBatcher,
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  inward: { x: number; z: number },
) {
  const alongX = Math.abs(x1 - x0) > Math.abs(z1 - z0);
  const length = alongX ? Math.abs(x1 - x0) : Math.abs(z1 - z0);
  const off = T / 2 + 0.03;
  const cx = (x0 + x1) / 2 + inward.x * off;
  const cz = (z0 + z1) / 2 + inward.z * off;
  const panel: [number, number, number] = alongX ? [length, 1.1, 0.06] : [0.06, 1.1, length];
  const trim: [number, number, number] = alongX ? [length, 0.12, 0.1] : [0.1, 0.12, length];
  batch.box(panel, [cx, 0, cz], ip.wainscot, { castShadow: false });
  batch.box(trim, [cx, 1.1, cz], ip.wallTrim, { castShadow: false });
  batch.box(trim, [cx, H - 0.5, cz], ip.wallTrim, { castShadow: false });
}

function floor(root: THREE.Group, physics: Physics, area: typeof lobby) {
  const w = area.maxX - area.minX;
  const d = area.maxZ - area.minZ;
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, 0.2, d), toon(ip.floor));
  mesh.position.set((area.minX + area.maxX) / 2, -0.1, (area.minZ + area.maxZ) / 2);
  mesh.receiveShadow = true;
  mesh.userData.walkable = true;
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();
  root.add(mesh);
  physics.addBox(
    { x: mesh.position.x, y: -0.5, z: mesh.position.z },
    { x: w / 2, y: 0.5, z: d / 2 },
  );
  return mesh;
}

function rug(batch: StaticBatcher, x: number, z: number, w: number, d: number) {
  batch.box([w, 0.02, d], [x, 0, z], ip.rugBorder, { castShadow: false });
  batch.box([w - 0.3, 0.025, d - 0.3], [x, 0, z], ip.rug, { castShadow: false });
}

function plant(ctx: PropContext, x: number, z: number, scale = 1) {
  const p = local(ctx, x, z, 0);
  p.add(
    new THREE.CylinderGeometry(0.32 * scale, 0.25 * scale, 0.6 * scale, 10),
    [0, 0.3 * scale, 0],
    palette.planter,
  );
  p.add(new THREE.IcosahedronGeometry(0.55 * scale, 0), [0, 1.05 * scale, 0], palette.leaves);
  p.add(
    new THREE.IcosahedronGeometry(0.38 * scale, 0),
    [0.2 * scale, 1.45 * scale, 0.1],
    palette.leavesLight,
    { rotation: [0.5, 0.2, 0] },
  );
  ctx.physics.addCylinder({ x, y: 0, z }, 1, 0.35 * scale);
}

function chair(ctx: PropContext, x: number, z: number, rotY: number) {
  const p = local(ctx, x, z, rotY);
  p.box([0.6, 0.45, 0.6], [0, 0, 0], ip.chair);
  p.box([0.6, 0.6, 0.12], [0, 0.45, -0.26], ip.chair);
  for (const lx of [-0.33, 0.33]) p.box([0.08, 0.6, 0.6], [lx, 0, 0], palette.metal);
  ctx.physics.addBox({ x, y: 0.5, z }, { x: 0.32, y: 0.5, z: 0.32 }, rotY);
}

function ceilingLight(batch: StaticBatcher, x: number, z: number) {
  batch.add(new THREE.CylinderGeometry(0.55, 0.55, 0.08, 16), ip.ceilingLight, {
    position: [x, H - 0.04, z],
    emissive: ip.ceilingLight,
    castShadow: false,
  });
}

function hangingSign(root: THREE.Group, batch: StaticBatcher, def: StationDef, height: number) {
  const group = new THREE.Group();
  group.position.set(def.position.x, height, def.position.z);
  group.rotation.y = def.facing;
  const face = createSignFace({
    width: 2.4,
    height: 0.62,
    background: ip.board,
    color: '#fbf6ec',
    lines: [`${def.icon}  ${def.title}`],
  });
  face.rotation.y = 0; // the group's rotation aims it; plane's normal is +Z
  face.position.z = 0.05;
  group.add(face);
  root.add(group);

  // Board and the two rods it hangs from (static, batched in world space).
  const f = { x: Math.sin(def.facing), z: Math.cos(def.facing) };
  const right = { x: f.z, z: -f.x };
  batch.add(new THREE.BoxGeometry(2.55, 0.75, 0.08), ip.wallTrim, {
    position: [def.position.x, height, def.position.z],
    rotation: [0, def.facing, 0],
  });
  for (const s of [-1, 1]) {
    batch.add(new THREE.CylinderGeometry(0.02, 0.02, H - height - 0.35, 6), palette.metal, {
      position: [
        def.position.x + right.x * s,
        (H + height + 0.35) / 2,
        def.position.z + right.z * s,
      ],
      castShadow: false,
    });
  }
  return face;
}

function buildStation(ctx: PropContext, root: THREE.Group, def: StationDef): BuiltStation {
  const { x, z } = def.position;
  const p = local(ctx, x, z, def.facing);
  const clickTargets: THREE.Object3D[] = [];

  if (def.kind === 'desk') {
    p.box([2.6, 1.05, 0.8], [0, 0, 0], ip.desk);
    p.box([2.75, 0.08, 0.95], [0, 1.05, 0], ip.deskTop);
    p.box([0.55, 0.38, 0.05], [0.6, 1.13, -0.15], ip.monitor);
    p.box([0.48, 0.3, 0.02], [0.6, 1.17, -0.18], ip.screen, false);
    p.box([0.5, 0.14, 0.04], [-0.7, 0.75, 0.42], palette.brass, false);
    const [cx, , cz] = p.at(0, 0, 0);
    ctx.physics.addBox({ x: cx, y: 0.55, z: cz }, { x: 1.38, y: 0.55, z: 0.48 }, def.facing);
  } else if (def.kind === 'round') {
    // A ring of counter with a gap at the back so the staff can get in.
    const radius = 1.25;
    for (let i = 0; i < 10; i++) {
      const a = (i / 12) * Math.PI * 2 - (Math.PI * 2 * 4.5) / 12; // skip the 2 back segments
      const lx = Math.sin(a) * radius;
      const lz = Math.cos(a) * radius;
      p.add(new THREE.BoxGeometry(0.72, 1.05, 0.35), [lx, 0.525, lz], ip.desk, {
        rotation: [0, a, 0],
      });
      p.add(new THREE.BoxGeometry(0.78, 0.08, 0.48), [lx, 1.09, lz], ip.deskTop, {
        rotation: [0, a, 0],
      });
    }
    ctx.physics.addCylinder({ x, y: 0, z }, 1.1, radius + 0.2);
  } else {
    p.box([0.7, 1.15, 0.45], [0, 0, 0], ip.monitor);
    p.add(new THREE.BoxGeometry(0.6, 0.45, 0.06), [0, 1.35, 0.12], ip.screen, {
      rotation: [-0.35, 0, 0],
      emissive: ip.screen,
      castShadow: false,
    });
    ctx.physics.addBox({ x, y: 0.7, z }, { x: 0.38, y: 0.7, z: 0.28 }, def.facing);
  }

  let npc: Npc | null = null;
  if (def.staff) {
    const s = staffSpot(def);
    npc = new Npc(def.staff, { x: s.x, y: 0, z: s.z }, def.facing);
    root.add(npc.character.root);
    clickTargets.push(npc.character.root);
  }
  const signHeight = def.kind === 'kiosk' ? 2.4 : 3.3;
  clickTargets.push(hangingSign(root, ctx.batch, def, signHeight));

  const head = def.staff ? staffSpot(def) : def.position;
  return {
    def,
    npc,
    clickTargets,
    anchor: new THREE.Vector3(head.x, def.staff ? 2.25 : 1.95, head.z),
  };
}

function vaultDoor(batch: StaticBatcher) {
  const z = hall.maxZ - T / 2 - 0.12;
  const at = (x: number, y: number): [number, number, number] => [x, y, z];
  batch.add(new THREE.CylinderGeometry(2.3, 2.3, 0.2, 40), ip.vaultDark, {
    position: at(0, 3),
    rotation: [Math.PI / 2, 0, 0],
  });
  batch.add(new THREE.CylinderGeometry(2.0, 2.0, 0.3, 40), ip.vault, {
    position: [0, 3, z - 0.08],
    rotation: [Math.PI / 2, 0, 0],
  });
  batch.add(new THREE.CylinderGeometry(0.35, 0.35, 0.3, 20), palette.brass, {
    position: [0, 3, z - 0.3],
    rotation: [Math.PI / 2, 0, 0],
  });
  for (let i = 0; i < 3; i++) {
    batch.add(new THREE.BoxGeometry(1.6, 0.1, 0.1), palette.brass, {
      position: [0, 3, z - 0.4],
      rotation: [0, 0, (i * Math.PI) / 3],
    });
  }
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    batch.add(new THREE.CylinderGeometry(0.09, 0.09, 0.2, 10), ip.vaultDark, {
      position: [Math.cos(a) * 1.75, 3 + Math.sin(a) * 1.75, z - 0.25],
      rotation: [Math.PI / 2, 0, 0],
      castShadow: false,
    });
  }
}

/** Scene 2: the lobby and the banking hall, with every station from the config. */
export function buildInterior(ctx: PropContext, root: THREE.Group): BuiltInterior {
  const { batch, physics } = ctx;
  const walkables = [floor(root, physics, lobby), floor(root, physics, hall)];

  // Floor tile lines, rugs.
  for (let x = lobby.minX + 1; x < lobby.maxX; x += 1)
    batch.box([0.03, 0.005, lobby.maxZ], [x, 0, lobby.maxZ / 2], ip.floorTile, {
      castShadow: false,
    });
  for (let z = 1; z < lobby.maxZ; z += 1)
    batch.box([lobby.maxX * 2, 0.005, 0.03], [0, 0, z], ip.floorTile, { castShadow: false });
  rug(batch, 0, 6, 2.8, 10.4);
  rug(batch, 0, 24, 9, 18);

  // Walls. Lobby: west, east, and south (with the entrance).
  const door = interior.door;
  wall(ctx, lobby.minX, lobby.minZ, lobby.minX, lobby.maxZ);
  wall(ctx, lobby.maxX, lobby.minZ, lobby.maxX, lobby.maxZ);
  wall(ctx, lobby.minX, 0, -door.width / 2 - 0.1, 0);
  wall(ctx, door.width / 2 + 0.1, 0, lobby.maxX, 0);
  wall(
    ctx,
    -door.width / 2 - 0.1,
    0,
    door.width / 2 + 0.1,
    0,
    H - door.height - 0.2,
    door.height + 0.2,
  );
  // Gate wall across the whole building, with the arched opening in the middle.
  const g = interior.gate;
  wall(ctx, hall.minX, g.z, -g.halfOpening, g.z);
  wall(ctx, g.halfOpening, g.z, hall.maxX, g.z);
  wall(ctx, -g.halfOpening, g.z, g.halfOpening, g.z, H - g.archHeight, g.archHeight);
  // Hall: west, east, north.
  wall(ctx, hall.minX, hall.minZ, hall.minX, hall.maxZ);
  wall(ctx, hall.maxX, hall.minZ, hall.maxX, hall.maxZ);
  wall(ctx, hall.minX, hall.maxZ, hall.maxX, hall.maxZ);

  wainscot(batch, lobby.minX, 0, lobby.minX, lobby.maxZ, { x: 1, z: 0 });
  wainscot(batch, lobby.maxX, 0, lobby.maxX, lobby.maxZ, { x: -1, z: 0 });
  wainscot(batch, lobby.minX, g.z, -g.halfOpening, g.z, { x: 0, z: -1 });
  wainscot(batch, g.halfOpening, g.z, lobby.maxX, g.z, { x: 0, z: -1 });
  wainscot(batch, hall.minX, hall.minZ, hall.minX, hall.maxZ, { x: 1, z: 0 });
  wainscot(batch, hall.maxX, hall.minZ, hall.maxX, hall.maxZ, { x: -1, z: 0 });
  wainscot(batch, hall.minX, hall.maxZ, hall.maxX, hall.maxZ, { x: 0, z: -1 });

  // Ceilings (solid, so the camera can't rise through them) and lights.
  for (const area of [lobby, hall]) {
    const w = area.maxX - area.minX;
    const d = area.maxZ - area.minZ;
    const cx = (area.minX + area.maxX) / 2;
    const cz = (area.minZ + area.maxZ) / 2;
    batch.box([w, 0.3, d], [cx, H, cz], ip.ceiling, { castShadow: false });
    physics.addBox({ x: cx, y: H + 0.15, z: cz }, { x: w / 2, y: 0.15, z: d / 2 });
  }
  for (const z of [3, 9]) for (const x of [-5, 0, 5]) ceilingLight(batch, x, z);
  for (const z of [16, 22, 28, 33]) for (const x of [-9, -3, 3, 9]) ceilingLight(batch, x, z);

  // Entrance door (swings into the lobby) with daylight behind it.
  batch.box([door.width, door.height, 0.05], [0, 0, -T / 2 - 0.05], palette.sky, {
    emissive: palette.sky,
    castShadow: false,
  });
  const entrance = new DoubleDoor(door.width, door.height, 1);
  entrance.group.position.set(0, 0, T / 2 + 0.06);
  root.add(entrance.group);
  // The doors are shut whenever you're inside, so they block like the wall
  // (and keep the camera from looking out through the doorway).
  physics.addBox(
    { x: 0, y: door.height / 2, z: 0 },
    { x: door.width / 2 + 0.1, y: door.height / 2, z: T / 2 },
  );

  // Lobby: waiting area, plants, info board, bank name over the gate.
  for (const z of [2.2, 3.1, 4.0]) {
    chair(ctx, lobby.minX + 0.9, z, Math.PI / 2);
    chair(ctx, lobby.maxX - 0.9, z, -Math.PI / 2);
  }
  plant(ctx, lobby.minX + 0.8, 0.9, 1.1);
  plant(ctx, lobby.maxX - 0.8, 0.9, 1.1);
  plant(ctx, lobby.minX + 0.8, lobby.maxZ - 0.9);
  plant(ctx, lobby.maxX - 0.8, lobby.maxZ - 0.9);
  plant(ctx, -2.6, g.z - 0.8, 0.8);
  plant(ctx, 2.6, g.z - 0.8, 0.8);

  const boardX = -5.6;
  const boardZ = g.z - T / 2 - 0.05;
  batch.box([2.4, 1.6, 0.08], [boardX, 1.3, boardZ], ip.wallTrim);
  const board = createSignFace({
    width: 2.25,
    height: 1.45,
    background: ip.board,
    color: '#fbf6ec',
    lines: ['Information', 'Open 24/7 (it is a demo!)', BANK.disclaimer, 'Press E here for more'],
  });
  board.position.set(boardX, 2.1, boardZ - 0.05);
  root.add(board);

  const nameSign = createBlockText(BANK.name, {
    block: 0.075,
    depth: 0.06,
    color: palette.letters,
  });
  nameSign.position.set(0, g.archHeight + 1.05, g.z - T / 2 - 0.04);
  root.add(nameSign);

  // Hall: columns, a vault door on the back wall, plants.
  for (const z of [17, 24, 31]) {
    for (const x of [-7, 7]) {
      batch.add(new THREE.CylinderGeometry(0.42, 0.48, H, 14), ip.column, {
        position: [x, H / 2, z],
      });
      batch.box([1.1, 0.25, 1.1], [x, 0, z], ip.column);
      physics.addCylinder({ x, y: 0, z }, H, 0.5);
    }
  }
  vaultDoor(batch);
  plant(ctx, hall.minX + 0.9, g.z + 1.0);
  plant(ctx, hall.maxX - 0.9, g.z + 1.0);
  plant(ctx, -3.2, hall.maxZ - 1.0, 0.9);
  plant(ctx, 3.2, hall.maxZ - 1.0, 0.9);

  const stations = STATIONS.map((def) => buildStation(ctx, root, def));
  const gate = new SecurityGate(physics);
  root.add(gate.group);

  return {
    walkables,
    door: entrance,
    gate,
    stations,
    infoBoard: {
      anchor: new THREE.Vector3(boardX, 2.6, boardZ),
      spot: { x: boardX, z: boardZ - 1.3 },
      mesh: board,
    },
  };
}
