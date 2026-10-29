/** Game actions and their default keys (KeyboardEvent.code). Phase 7 makes these remappable. */
export const DEFAULT_BINDINGS = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  run: ['ShiftLeft', 'ShiftRight'],
  rotateLeft: ['KeyZ'],
  rotateRight: ['KeyC'],
  zoomIn: ['Equal', 'NumpadAdd'],
  zoomOut: ['Minus', 'NumpadSubtract'],
  interact: ['KeyE', 'Enter'],
  pause: ['Escape', 'KeyP'],
} as const satisfies Record<string, readonly string[]>;

export type Action = keyof typeof DEFAULT_BINDINGS;
export type Bindings = Record<Action, readonly string[]>;

export function isActive(action: Action, pressed: ReadonlySet<string>, bindings: Bindings) {
  return bindings[action].some((code) => pressed.has(code));
}

/** Move intent from held keys: x = strafe right, z = forward. Length is 0 or 1. */
export function keyboardMoveIntent(pressed: ReadonlySet<string>, bindings: Bindings) {
  const x =
    Number(isActive('right', pressed, bindings)) - Number(isActive('left', pressed, bindings));
  const z =
    Number(isActive('forward', pressed, bindings)) - Number(isActive('back', pressed, bindings));
  const length = Math.hypot(x, z);
  return length === 0 ? { x: 0, z: 0 } : { x: x / length, z: z / length };
}

/** Gamepad sticks drift; ignore small deflections and rescale the rest to 0..1. */
export function applyDeadzone(x: number, y: number, deadzone = 0.18) {
  const length = Math.hypot(x, y);
  if (length < deadzone) return { x: 0, y: 0 };
  const scaled = Math.min(1, (length - deadzone) / (1 - deadzone));
  return { x: (x / length) * scaled, y: (y / length) * scaled };
}

export interface PointerSample {
  x: number;
  y: number;
  time: number;
}

/** A press-and-release that barely moved counts as a click (click-to-move), not a camera drag. */
export function isClick(down: PointerSample, up: PointerSample, maxDistance = 6, maxMs = 500) {
  return Math.hypot(up.x - down.x, up.y - down.y) <= maxDistance && up.time - down.time <= maxMs;
}
