import * as THREE from 'three';
import type { StaticBatcher } from '../../engine/batcher';
import type { Physics } from '../../engine/physics';
import { palette } from '../../theme';

/**
 * Low-poly street furniture. Each prop adds merged geometry to the batcher
 * and, where the player could bump into it, a static collider.
 */

export interface PropContext {
  batch: StaticBatcher;
  physics: Physics;
  /** Ground height the prop stands on. */
  y: number;
}

/** Local-space helper: place parts relative to a prop's origin and Y rotation. */
export function local(ctx: PropContext, x: number, z: number, rotY: number) {
  const cos = Math.cos(rotY);
  const sin = Math.sin(rotY);
  const at = (lx: number, ly: number, lz: number): [number, number, number] => [
    x + lx * cos + lz * sin,
    ctx.y + ly,
    z - lx * sin + lz * cos,
  ];
  return {
    at,
    box(
      size: [number, number, number],
      base: [number, number, number],
      color: string,
      castShadow = true,
    ) {
      ctx.batch.box(size, at(...base), color, { rotation: [0, rotY, 0], castShadow });
    },
    add(
      geometry: THREE.BufferGeometry,
      pos: [number, number, number],
      color: string,
      extra: { rotation?: [number, number, number]; emissive?: string; castShadow?: boolean } = {},
    ) {
      const [rx, ry, rz] = extra.rotation ?? [0, 0, 0];
      ctx.batch.add(geometry, color, {
        position: at(...pos),
        rotation: [rx, ry + rotY, rz],
        ...(extra.emissive && { emissive: extra.emissive }),
        castShadow: extra.castShadow ?? true,
      });
    },
  };
}

export function tree(ctx: PropContext, x: number, z: number, scale = 1) {
  const p = local(ctx, x, z, 0);
  // Square planter box with the trunk rising out of it.
  p.box([1.3, 0.45, 1.3], [0, 0, 0], palette.planter);
  p.box([1.1, 0.05, 1.1], [0, 0.45, 0], palette.soil, false);
  p.add(
    new THREE.CylinderGeometry(0.12 * scale, 0.16 * scale, 1.6 * scale, 6),
    [0, 0.45 + 0.8 * scale, 0],
    palette.trunk,
  );
  p.add(new THREE.IcosahedronGeometry(1.05 * scale, 0), [0, 2.55 * scale + 0.3, 0], palette.leaves);
  p.add(
    new THREE.IcosahedronGeometry(0.7 * scale, 0),
    [0.45 * scale, 3.1 * scale + 0.3, 0.2 * scale],
    palette.leavesLight,
    {
      rotation: [0.4, 0.3, 0],
    },
  );
  ctx.physics.addBox({ x, y: ctx.y + 0.4, z }, { x: 0.65, y: 0.4, z: 0.65 });
}

export function lampPost(ctx: PropContext, x: number, z: number) {
  const p = local(ctx, x, z, 0);
  p.add(new THREE.CylinderGeometry(0.22, 0.28, 0.3, 8), [0, 0.15, 0], palette.metal);
  p.add(new THREE.CylinderGeometry(0.07, 0.09, 3.6, 8), [0, 2.1, 0], palette.metal);
  p.add(new THREE.CylinderGeometry(0.3, 0.18, 0.12, 8), [0, 3.95, 0], palette.metal);
  p.add(new THREE.SphereGeometry(0.24, 10, 8), [0, 4.2, 0], palette.lampGlow, {
    emissive: palette.lampGlow,
    castShadow: false,
  });
  p.add(new THREE.ConeGeometry(0.34, 0.25, 8), [0, 4.52, 0], palette.metal);
  ctx.physics.addCylinder({ x, y: ctx.y, z }, 4, 0.22);
}

export function bench(ctx: PropContext, x: number, z: number, rotY = 0) {
  const p = local(ctx, x, z, rotY);
  for (const lx of [-0.75, 0.75]) {
    p.box([0.1, 0.45, 0.5], [lx, 0, 0], palette.metal);
    p.box([0.1, 0.5, 0.08], [lx, 0.45, 0.24], palette.metal);
  }
  for (let i = 0; i < 3; i++) p.box([1.8, 0.06, 0.15], [0, 0.45, -0.17 + i * 0.17], palette.bench);
  for (let i = 0; i < 2; i++) p.box([1.8, 0.14, 0.06], [0, 0.6 + i * 0.2, 0.27], palette.bench);
  const [cx, , cz] = p.at(0, 0, 0.05);
  ctx.physics.addBox({ x: cx, y: ctx.y + 0.45, z: cz }, { x: 0.95, y: 0.45, z: 0.32 }, rotY);
}

export function mailbox(ctx: PropContext, x: number, z: number, rotY = 0) {
  const p = local(ctx, x, z, rotY);
  p.box([0.12, 0.6, 0.12], [0, 0, 0], palette.metal);
  p.box([0.55, 0.55, 0.45], [0, 0.6, 0], palette.mailbox);
  p.add(
    new THREE.CylinderGeometry(0.225, 0.225, 0.55, 10, 1, false, 0, Math.PI),
    [0, 1.15, 0],
    palette.mailbox,
    {
      rotation: [0, 0, Math.PI / 2],
    },
  );
  p.box([0.3, 0.04, 0.02], [0, 0.95, -0.235], palette.metal, false);
  ctx.physics.addBox({ x, y: ctx.y + 0.65, z }, { x: 0.3, y: 0.65, z: 0.25 }, rotY);
}

/** Rectangular planter full of flowers. Width runs along X before rotation. */
export function flowerPlanter(
  ctx: PropContext,
  x: number,
  z: number,
  width: number,
  depth: number,
  rotY = 0,
  seed = 1,
) {
  const p = local(ctx, x, z, rotY);
  p.box([width, 0.55, depth], [0, 0, 0], palette.planter);
  p.box([width - 0.15, 0.05, depth - 0.15], [0, 0.55, 0], palette.soil, false);
  const flower = new THREE.IcosahedronGeometry(0.13, 0);
  const leaf = new THREE.ConeGeometry(0.1, 0.25, 4);
  let n = seed * 9301;
  const rand = () => (n = (n * 9301 + 49297) % 233280) / 233280;
  const count = Math.round(width * depth * 7);
  for (let i = 0; i < count; i++) {
    const fx = (rand() - 0.5) * (width - 0.35);
    const fz = (rand() - 0.5) * (depth - 0.35);
    const color = palette.flowers[Math.floor(rand() * palette.flowers.length)]!;
    p.add(leaf, [fx, 0.68, fz], palette.leaves, { castShadow: false });
    p.add(flower, [fx, 0.85 + rand() * 0.1, fz], color, { castShadow: false });
  }
  const [cx, , cz] = p.at(0, 0, 0);
  ctx.physics.addBox(
    { x: cx, y: ctx.y + 0.4, z: cz },
    { x: width / 2, y: 0.4, z: depth / 2 },
    rotY,
  );
}

/** Straight hedge with a white picket fence in front, from x0 to x1 (or along Z if `alongZ`). */
export function hedgeRow(ctx: PropContext, from: number, to: number, at: number, alongZ = false) {
  const length = Math.abs(to - from);
  const mid = (from + to) / 2;
  const [x, z] = alongZ ? [at, mid] : [mid, at];
  const rotY = alongZ ? Math.PI / 2 : 0;
  const p = local(ctx, x, z, rotY);
  p.box([length, 1.1, 0.8], [0, 0, 0.35], palette.hedge);
  for (let i = 0; i <= Math.floor(length / 0.5); i++) {
    p.box([0.09, 0.75, 0.05], [-length / 2 + i * 0.5, 0, -0.2], palette.fence);
  }
  p.box([length, 0.07, 0.04], [0, 0.25, -0.24], palette.fence);
  p.box([length, 0.07, 0.04], [0, 0.55, -0.24], palette.fence);
  ctx.physics.addBox(
    { x, y: ctx.y + 1, z },
    alongZ ? { x: 0.6, y: 1, z: length / 2 } : { x: length / 2, y: 1, z: 0.6 },
  );
}

/** "Road closed" sawhorse barricade with a cone either side. */
export function barricade(ctx: PropContext, x: number, z: number, rotY = 0) {
  const p = local(ctx, x, z, rotY);
  for (const lx of [-1.1, 1.1]) {
    p.box([0.08, 0.95, 0.08], [lx, 0, -0.15], palette.metal);
    p.box([0.08, 0.95, 0.08], [lx, 0, 0.15], palette.metal);
  }
  for (const y of [0.55, 0.8]) {
    p.box([2.5, 0.16, 0.05], [0, y, 0], palette.barricade);
    for (let i = 0; i < 5; i++) {
      p.box([0.22, 0.165, 0.055], [-1.0 + i * 0.5, y, 0], palette.barricadeStripe, false);
    }
  }
  for (const lx of [-1.7, 1.7]) {
    p.add(new THREE.ConeGeometry(0.2, 0.6, 8), [lx, 0.3, 0], palette.cone);
    p.box([0.44, 0.05, 0.44], [lx, 0, 0], palette.cone);
  }
}
