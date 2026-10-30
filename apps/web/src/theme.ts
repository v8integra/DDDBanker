/**
 * Every color and size in the 3D world. Tweak the look here, not in scene code.
 * Units are meters. +Z points from the street toward the bank's front door.
 */
export const palette = {
  sky: '#bfe3f2',
  fog: '#d9eef5',
  hemiSky: '#e8f6ff',
  hemiGround: '#a7c48a',
  sun: '#fff4dc',

  grass: '#8cc56b',
  sidewalk: '#e9ddc7',
  sidewalkJoint: '#d8c9b0',
  curb: '#c9bda8',
  road: '#5d6270',
  laneLine: '#f4e27a',
  crosswalk: '#f5f1e8',

  bankWall: '#f3e6cf',
  bankTrim: '#2f6f4f',
  bankBase: '#c7b08a',
  roof: '#7a5444',
  column: '#fbf6ec',
  awning: '#2f6f4f',
  awningStripe: '#f5f1e8',
  door: '#6b4a35',
  doorGlass: '#ffe3a3',
  brass: '#e8b04a',
  window: '#ffd98a',
  windowFrame: '#fbf6ec',
  letters: '#e8b04a',

  neighborA: '#f2b8b0',
  neighborB: '#a9c8e8',
  neighborC: '#c8b8e8',
  neighborD: '#f2d59b',

  trunk: '#8a5a3c',
  leaves: '#5ea35a',
  leavesLight: '#7fbf63',
  planter: '#b9866a',
  soil: '#6b4a35',
  flowers: ['#f2789a', '#ffd166', '#f7f2ff', '#ff9f6b'],
  hedge: '#4f9a52',
  fence: '#fbf6ec',
  metal: '#3d4452',
  lampGlow: '#fff1c1',
  bench: '#b97a4f',
  mailbox: '#3b6fb6',
  barricade: '#f5f1e8',
  barricadeStripe: '#e05d4f',
  cone: '#ff8a3d',
  atmBody: '#3d4452',
  atmScreen: '#7fe0c8',
  signBoard: '#2f6f4f',
  cream: '#fbf3e0',

  clickMarker: '#ffd166',
};

/** Inside the bank. Its own coordinates: the entrance door is at z = 0, the hall is north (+Z). */
export const interiorPalette = {
  floor: '#efe3cc',
  floorTile: '#e3d3b6',
  rug: '#2f6f4f',
  rugBorder: '#e8b04a',
  wall: '#f6ecd9',
  wallTrim: '#2f6f4f',
  wainscot: '#c7a77d',
  ceiling: '#fbf6ec',
  ceilingLight: '#fff6dc',
  desk: '#8a5a3c',
  deskTop: '#f6ecd9',
  monitor: '#3d4452',
  screen: '#7fe0c8',
  column: '#fbf6ec',
  chair: '#2f6f4f',
  vault: '#b8bcc6',
  vaultDark: '#7d8290',
  gatePost: '#3d4452',
  gateGlass: '#bfe3f2',
  gateLocked: '#e05d4f',
  gateOpen: '#4caf6a',
  /** Okabe–Ito orange and sky blue: tell apart for most kinds of color blindness. */
  gateLockedSafe: '#e69f00',
  gateOpenSafe: '#56b4e9',
  board: '#2f6f4f',
};

export const interior = {
  lobby: { minX: -10, maxX: 10, minZ: 0, maxZ: 12 },
  hall: { minX: -15, maxX: 15, minZ: 12, maxZ: 36 },
  ceiling: 6,
  wallThickness: 0.4,
  gate: { z: 12, halfOpening: 1.8, archHeight: 3.6 },
  door: { width: 2.6, height: 3.2 },
  /** Where you appear walking in, and the zone that takes you back outside. */
  arrival: { x: 0, z: 4.2, facing: 0 },
  exitZone: { minX: -1.3, maxX: 1.3, minZ: 0, maxZ: 0.8 },
};

export const playerColors = ['#ff8a5b', '#5bb8ff', '#8be07a', '#c69bff', '#ffd25b', '#ff7fb8'];

export const layout = {
  /** Walkable bounds; fences and planters sit just outside these. */
  bounds: { minX: -18, maxX: 18, minZ: -13, maxZ: 4 },
  sidewalkHeight: 0.15,
  road: { minZ: -10, maxZ: -4 },
  bank: { minX: -10, maxX: 10, frontZ: 4, depth: 12, height: 9 },
  door: { x: 0, width: 2.6, height: 3.2 },
  spawn: { x: 0, z: -1.5, facing: 0 },
};

export const player = {
  radius: 0.35,
  /** Half the length of the capsule's straight middle section. */
  halfHeight: 0.45,
  walkSpeed: 4,
  runSpeed: 6.5,
  turnSpeed: 12,
  gravity: -20,
};

export const camera = {
  fov: 50,
  /** Look-at point above the player's feet. */
  targetHeight: 1.2,
  defaultDistance: 7,
  defaultPitch: 0.42,
};
