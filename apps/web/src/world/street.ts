import * as THREE from 'three';
import { toon } from '../engine/materials';
import { layout, palette } from '../theme';
import { createBlockText } from './props/blockFont';
import { createSignFace } from './props/signs';
import {
  barricade,
  bench,
  flowerPlanter,
  hedgeRow,
  lampPost,
  mailbox,
  tree,
  type PropContext,
} from './props/props';

const S = layout.sidewalkHeight;
const { road, bounds } = layout;
const FAR = 60; // how far the street runs off into the fog

/** Street lamp positions (ground level), also used for evening lights. */
export const LAMP_POSITIONS = [
  ...[-15, -8, 8, 15].map((x) => ({ x, z: road.maxZ + 0.7 })),
  ...[-11, 0, 11].map((x) => ({ x, z: road.minZ - 0.7 })),
];

/** Ground surfaces stay separate meshes so click-to-move can raycast them. */
function surface(width: number, depth: number, topY: number, x: number, z: number, color: string) {
  const thickness = 0.2;
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, thickness, depth), toon(color));
  mesh.position.set(x, topY - thickness / 2, z);
  mesh.receiveShadow = true;
  mesh.userData.walkable = true;
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();
  return mesh;
}

export function buildStreet(ctx: PropContext, root: THREE.Group): THREE.Mesh[] {
  const { batch, physics } = ctx;
  const nearDepth = layout.bank.frontZ - road.maxZ + 6; // runs under the buildings
  const walkables = [
    surface(FAR * 2, road.maxZ - road.minZ, 0, 0, (road.minZ + road.maxZ) / 2, palette.road),
    surface(FAR * 2, nearDepth, S, 0, road.maxZ + nearDepth / 2, palette.sidewalk),
    surface(FAR * 2, 6, S, 0, road.minZ - 3, palette.sidewalk),
  ];
  for (const mesh of walkables) root.add(mesh);

  const grass = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), toon(palette.grass));
  grass.rotation.x = -Math.PI / 2;
  grass.position.y = -0.02;
  grass.receiveShadow = true;
  root.add(grass);

  // Physics ground: road level everywhere, raised slabs for the sidewalks.
  physics.addBox({ x: 0, y: -0.5, z: 0 }, { x: FAR, y: 0.5, z: FAR });
  physics.addBox(
    { x: 0, y: S / 2, z: road.maxZ + nearDepth / 2 },
    { x: FAR, y: S / 2, z: nearDepth / 2 },
  );
  physics.addBox({ x: 0, y: S / 2, z: road.minZ - 3 }, { x: FAR, y: S / 2, z: 3 });

  // Curbs, paving joints, lane dashes, zebra crossing.
  for (const z of [road.maxZ + 0.12, road.minZ - 0.12]) {
    batch.box([FAR * 2, S + 0.02, 0.26], [0, 0, z], palette.curb, { castShadow: false });
  }
  for (let x = -FAR; x <= FAR; x += 2) {
    batch.box(
      [0.05, 0.01, layout.bank.frontZ - road.maxZ],
      [x, S, (road.maxZ + layout.bank.frontZ) / 2],
      palette.sidewalkJoint,
      {
        castShadow: false,
      },
    );
  }
  const laneZ = (road.minZ + road.maxZ) / 2;
  for (let x = -FAR; x < FAR; x += 3) {
    if (x > 9 && x < 15) continue; // skip through the crosswalk
    batch.box([1.5, 0.01, 0.15], [x + 0.75, 0, laneZ], palette.laneLine, { castShadow: false });
  }
  for (let z = road.minZ + 0.45; z < road.maxZ - 0.2; z += 0.9) {
    batch.box([3, 0.012, 0.45], [12, 0, z], palette.crosswalk, { castShadow: false });
  }

  // Street furniture.
  for (const { x, z } of LAMP_POSITIONS) lampPost(ctx, x, z);
  for (const x of [-12, 12]) tree(ctx, x, road.maxZ + 1.0, 1);
  for (const x of [-5.5, 5.5, 16]) tree(ctx, x, road.minZ - 1.4, 0.9);
  // Benches put their backs to the wall behind them (local +Z is the backrest).
  bench(ctx, -7.6, layout.bank.frontZ - 1.9, 0);
  bench(ctx, 8.2, layout.bank.frontZ - 1.9, 0);
  bench(ctx, -2.5, road.minZ - 2.2, Math.PI);
  mailbox(ctx, -13.8, road.maxZ + 0.8, Math.PI);
  flowerPlanter(ctx, 16, layout.bank.frontZ - 1.0, 2.4, 1.0, 0, 11);
  flowerPlanter(ctx, -16, layout.bank.frontZ - 1.0, 2.4, 1.0, 0, 13);

  // Boundaries that look like part of the street: hedges + fences on the
  // sidewalks, "road closed" barricades across the street, and an invisible
  // wall just behind them so nothing can slip through.
  for (const side of [-1, 1]) {
    const x = side * (bounds.maxX + 0.6);
    hedgeRow(ctx, road.maxZ, layout.bank.frontZ, x, true);
    hedgeRow(ctx, bounds.minZ - 0.6, road.minZ, x, true);
    barricade(ctx, x, road.minZ + 1.6, Math.PI / 2);
    barricade(ctx, x, road.maxZ - 1.6, Math.PI / 2);
    physics.addBox(
      { x: side * (bounds.maxX + 1.4), y: 1.5, z: (bounds.minZ + bounds.maxZ) / 2 },
      { x: 0.4, y: 1.5, z: 12 },
    );
  }
  hedgeRow(ctx, bounds.minX, bounds.maxX, bounds.minZ - 0.6);
  physics.addBox({ x: 0, y: 1.5, z: bounds.minZ - 1.4 }, { x: 20, y: 1.5, z: 0.4 });

  // Welcome plaque by the spawn point.
  const plaqueX = -2.4;
  const plaqueZ = layout.spawn.z + 1.2;
  batch.box([0.12, 1.2, 0.12], [plaqueX - 0.7, S, plaqueZ], palette.metal);
  batch.box([0.12, 1.2, 0.12], [plaqueX + 0.7, S, plaqueZ], palette.metal);
  batch.box([1.75, 1.05, 0.08], [plaqueX, S + 1.0, plaqueZ], palette.signBoard);
  const plaque = createSignFace({
    width: 1.65,
    height: 0.95,
    background: palette.signBoard,
    color: palette.cream,
    lines: [
      'Welcome!',
      'Walk to the front door to enter.',
      'Press E to interact.',
      'WASD / arrows to walk · drag to look',
    ],
  });
  plaque.position.set(plaqueX, S + 1.525, plaqueZ - 0.05);
  root.add(plaque);
  physics.addBox({ x: plaqueX, y: S + 1, z: plaqueZ }, { x: 0.9, y: 1, z: 0.1 });

  return walkables;
}

/** Shops on either side of the bank and across the street. Scenery only. */
export function buildNeighbors(ctx: PropContext, root: THREE.Group) {
  const { batch, physics } = ctx;
  const front = layout.bank.frontZ;

  const shop = (
    x0: number,
    x1: number,
    h: number,
    color: string,
    facing: 1 | -1,
    frontAt: number,
    label?: string,
  ) => {
    const w = x1 - x0;
    const cx = (x0 + x1) / 2;
    const d = 10;
    const cz = frontAt + (facing === -1 ? d / 2 : -d / 2);
    batch.box([w, h, d], [cx, 0, cz], color);
    batch.box([w + 0.2, 0.45, d + 0.2], [cx, h, cz], palette.roof);
    if (facing === -1) physics.addBox({ x: cx, y: h / 2, z: cz }, { x: w / 2, y: h / 2, z: d / 2 });

    // Shop windows and a striped awning on the street side.
    const zFace = frontAt - facing * 0.06;
    const glowWidth = Math.min(w - 2, 7);
    const shopCenter = facing === -1 ? (cx > 0 ? x0 + 4.5 : x1 - 4.5) : cx;
    batch.box([glowWidth, 2.2, 0.08], [shopCenter, S + 0.6, zFace], palette.window, {
      emissive: palette.window,
      castShadow: false,
    });
    for (let i = 0; i < 6; i++) {
      const stripe =
        i % 2 === 0
          ? palette.awningStripe
          : color === palette.neighborA
            ? '#e0707f'
            : palette.bankTrim;
      batch.box(
        [glowWidth / 6, 0.12, 1.5],
        [shopCenter - glowWidth / 2 + (i + 0.5) * (glowWidth / 6), S + 3.1, zFace - facing * 0.75],
        stripe,
        {
          rotation: [facing * -0.25, 0, 0],
        },
      );
    }
    if (label) {
      const sign = createBlockText(label, { block: 0.09, depth: 0.08, color: palette.cream });
      sign.position.set(shopCenter, S + 3.55, zFace - facing * 0.05);
      if (facing === 1) sign.rotation.y = Math.PI;
      root.add(sign);
    }
  };

  shop(-40, layout.bank.minX, 6, palette.neighborA, -1, front, 'BAKERY');
  shop(layout.bank.maxX, 40, 5, palette.neighborB, -1, front, 'BOOKS');
  shop(-40, -9, 5.5, palette.neighborC, 1, bounds.minZ - 3, 'FLOWERS');
  shop(-7, 9, 7, palette.neighborD, 1, bounds.minZ - 3, 'CAFE');
  shop(11, 40, 6, palette.neighborB, 1, bounds.minZ - 3);
}
