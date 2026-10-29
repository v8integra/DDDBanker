import * as THREE from 'three';
import { BANK } from '@dddbanker/shared';
import { layout, palette } from '../theme';
import { blockTextWidth, createBlockText } from './props/blockFont';
import { flowerPlanter, type PropContext } from './props/props';

const S = layout.sidewalkHeight;
const { minX, maxX, frontZ, depth, height } = layout.bank;

/** A glowing window with a frame, cross mullions and a sill, set into the facade. */
function facadeWindow(ctx: PropContext, x: number, y: number, w: number, h: number) {
  const z = frontZ - 0.06;
  ctx.batch.box([w + 0.24, h + 0.24, 0.12], [x, y - 0.12, z], palette.windowFrame);
  ctx.batch.box([w, h, 0.05], [x, y, z - 0.07], palette.window, {
    emissive: palette.window,
    castShadow: false,
  });
  ctx.batch.box([0.08, h, 0.06], [x, y, z - 0.1], palette.windowFrame, { castShadow: false });
  ctx.batch.box([w, 0.08, 0.06], [x, y + h / 2 - 0.04, z - 0.1], palette.windowFrame, {
    castShadow: false,
  });
  ctx.batch.box([w + 0.4, 0.1, 0.3], [x, y - 0.22, z - 0.1], palette.windowFrame);
}

function outdoorAtm(ctx: PropContext, root: THREE.Group, x: number) {
  const z = frontZ - 0.2;
  ctx.batch.box([1.15, 2.2, 0.4], [x, S, z], palette.atmBody);
  ctx.batch.box([0.75, 0.48, 0.04], [x, S + 1.3, z - 0.21], palette.atmScreen, {
    emissive: palette.atmScreen,
    castShadow: false,
  });
  ctx.batch.box([0.5, 0.32, 0.18], [x, S + 0.85, z - 0.25], palette.metal);
  ctx.batch.box([0.3, 0.05, 0.05], [x + 0.2, S + 1.12, z - 0.22], palette.brass, {
    castShadow: false,
  });
  ctx.batch.box([1.3, 0.14, 0.5], [x, S + 2.2, z - 0.05], palette.bankTrim);
  const label = createBlockText('ATM', { block: 0.07, depth: 0.05, color: palette.brass });
  label.position.set(x, S + 2.36, z - 0.22);
  root.add(label);
  ctx.physics.addBox({ x, y: S + 1.1, z: z + 0.05 }, { x: 0.6, y: 1.1, z: 0.25 });
}

/** The Bank of Bramblewood: facade, portico, signage, and its colliders. */
export function buildBank(ctx: PropContext, root: THREE.Group) {
  const { batch, physics } = ctx;
  const width = maxX - minX;
  const cx = (minX + maxX) / 2;

  // Body, base course, floor band, cornice, roof.
  batch.box([width, height, depth], [cx, 0, frontZ + depth / 2], palette.bankWall);
  batch.box([width + 0.2, 0.9, 0.3], [cx, S, frontZ - 0.1], palette.bankBase);
  batch.box([width + 0.2, 0.25, 0.3], [cx, 4.75, frontZ - 0.1], palette.bankTrim);
  batch.box([width + 0.6, 0.5, 0.7], [cx, height - 0.4, frontZ - 0.05], palette.bankBase);
  batch.box([width + 0.2, 0.6, depth + 0.2], [cx, height, frontZ + depth / 2], palette.roof);
  physics.addBox(
    { x: cx, y: height / 2, z: frontZ + depth / 2 },
    { x: width / 2, y: height / 2, z: depth / 2 },
  );

  // Entrance steps.
  batch.box([7.2, 0.15, 1.3], [0, S, frontZ - 0.65], palette.bankBase);
  batch.box([6.2, 0.15, 0.7], [0, S + 0.15, frontZ - 0.35], palette.bankBase);
  physics.addBox({ x: 0, y: S + 0.075, z: frontZ - 0.65 }, { x: 3.6, y: 0.075, z: 0.65 });
  physics.addBox({ x: 0, y: S + 0.225, z: frontZ - 0.35 }, { x: 3.1, y: 0.075, z: 0.35 });

  // Double doors in a dark frame, with a glowing transom.
  const { width: doorW, height: doorH } = layout.door;
  const doorBase = S + 0.3;
  const doorZ = frontZ - 0.05;
  batch.box([doorW + 0.6, doorH + 0.9, 0.12], [0, doorBase, doorZ], palette.bankTrim);
  for (const side of [-1, 1]) {
    const x = (side * doorW) / 4;
    batch.box([doorW / 2 - 0.06, doorH, 0.1], [x, doorBase, doorZ - 0.08], palette.door);
    batch.box(
      [doorW / 2 - 0.5, doorH * 0.55, 0.04],
      [x, doorBase + doorH * 0.35, doorZ - 0.14],
      palette.doorGlass,
      {
        emissive: palette.doorGlass,
        castShadow: false,
      },
    );
    batch.box(
      [0.06, 0.5, 0.08],
      [x - side * (doorW / 4 - 0.2), doorBase + 1.3, doorZ - 0.18],
      palette.brass,
      { castShadow: false },
    );
  }
  batch.box([doorW, 0.6, 0.05], [0, doorBase + doorH + 0.12, doorZ - 0.1], palette.doorGlass, {
    emissive: palette.doorGlass,
    castShadow: false,
  });

  // Portico: two columns holding a canopy.
  const columnBase = S + 0.15;
  const columnHeight = 4.3;
  for (const x of [-3.05, 3.05]) {
    const z = frontZ - 1.0;
    batch.add(new THREE.CylinderGeometry(0.28, 0.32, columnHeight, 12), palette.column, {
      position: [x, columnBase + columnHeight / 2, z],
    });
    batch.box([0.8, 0.2, 0.8], [x, columnBase, z], palette.column);
    batch.box([0.8, 0.2, 0.8], [x, columnBase + columnHeight - 0.2, z], palette.column);
    physics.addCylinder({ x, y: columnBase, z }, columnHeight, 0.35);
  }
  batch.box([7.6, 0.35, 1.7], [0, columnBase + columnHeight, frontZ - 0.85], palette.column);
  batch.box(
    [7.7, 0.18, 0.08],
    [0, columnBase + columnHeight + 0.08, frontZ - 1.72],
    palette.bankTrim,
    { castShadow: false },
  );

  // The bank's name in big brass block letters on a green signboard, high
  // enough above the canopy to read from the street.
  const nameBlock = 0.12;
  const nameWidth = blockTextWidth(BANK.name, nameBlock);
  const nameY = 5.35;
  batch.box(
    [nameWidth + 0.7, 7 * nameBlock + 0.4, 0.1],
    [0, nameY - 0.2, frontZ - 0.06],
    palette.bankTrim,
  );
  const name = createBlockText(BANK.name, {
    block: nameBlock,
    depth: 0.12,
    color: palette.letters,
  });
  name.position.set(0, nameY, frontZ - 0.17);
  root.add(name);

  // Windows: two per side downstairs (the ATM takes one slot), a row upstairs.
  for (const x of [-7.6, -5.2, 8]) facadeWindow(ctx, x, S + 1.0, 1.6, 2.1);
  for (const x of [-8.4, -5.6, -2.8, 0, 2.8, 5.6, 8.4]) facadeWindow(ctx, x, 6.35, 1.3, 1.5);
  outdoorAtm(ctx, root, 5.3);

  // Planters flanking the steps.
  flowerPlanter(ctx, -4.6, frontZ - 0.6, 1.6, 0.8, 0, 3);
  flowerPlanter(ctx, 4.15, frontZ - 0.6, 0.8, 0.8, 0, 7); // the ATM sits just to its right

  // Blade sign: "BANK" stacked vertically on a board sticking out from the wall.
  const bladeX = -9.2;
  batch.box([0.08, 0.08, 1.6], [bladeX, 7.65, frontZ - 0.8], palette.metal);
  batch.box([0.2, 3.3, 1.2], [bladeX, 4.2, frontZ - 0.95], palette.signBoard);
  for (const [faceX, rotY] of [
    [bladeX + 0.12, -Math.PI / 2],
    [bladeX - 0.12, Math.PI / 2],
  ] as const) {
    [...'BANK'].forEach((letter, i) => {
      const mesh = createBlockText(letter, { block: 0.1, depth: 0.04, color: palette.letters });
      mesh.rotation.y = rotY;
      mesh.position.set(faceX, 6.65 - i * 0.78 - 0.35, frontZ - 0.95);
      root.add(mesh);
    });
  }
}
