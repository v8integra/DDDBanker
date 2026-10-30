/** Game actions and their default keys (KeyboardEvent.code). Remappable in Settings. */
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
  travel: ['KeyT'],
  pause: ['Escape', 'KeyP'],
} as const satisfies Record<string, readonly string[]>;

export type Action = keyof typeof DEFAULT_BINDINGS;
export type Bindings = Record<Action, readonly string[]>;
export const ACTIONS = Object.keys(DEFAULT_BINDINGS) as Action[];

/** Keys that always keep their job, so no one can lock themselves out of the menu. */
const RESERVED: Partial<Record<string, Action>> = { Escape: 'pause' };
/** Keys a person can't usefully bind (system, browser, and assistive-tech keys). */
const UNBINDABLE = new Set([
  'Tab',
  'MetaLeft',
  'MetaRight',
  'AltLeft',
  'AltRight',
  'ControlLeft',
  'ControlRight',
  'CapsLock',
  'ContextMenu',
  'F5',
  'F11',
  'F12',
  'Insert',
]);

export function canBind(code: string) {
  return code !== '' && !UNBINDABLE.has(code) && !(code in RESERVED);
}

/**
 * Bindings with someone's overrides applied. Unknown actions and bad codes
 * are ignored, and reserved keys (Escape) stay on their action.
 */
export function resolveBindings(overrides: Partial<Record<string, readonly string[]>>): Bindings {
  const result = { ...DEFAULT_BINDINGS } as Record<Action, readonly string[]>;
  for (const action of ACTIONS) {
    const codes = overrides[action];
    if (!Array.isArray(codes)) continue;
    const valid = codes.filter((c): c is string => typeof c === 'string' && canBind(c)).slice(0, 2);
    const reserved = DEFAULT_BINDINGS[action].filter((c) => RESERVED[c] === action);
    if (valid.length || reserved.length) result[action] = [...reserved, ...valid];
  }
  return result;
}

/**
 * Make `code` the main key for `action`, keeping its second key. If another
 * action already used `code`, it loses that key, so two actions never share one.
 * Returns the overrides to store (only what differs is meaningful, but storing
 * every action keeps it simple and explicit).
 */
export function rebind(current: Bindings, action: Action, code: string): Record<Action, string[]> {
  const next = {} as Record<Action, string[]>;
  for (const a of ACTIONS) {
    next[a] = current[a].filter((c) => c !== code && !(c in RESERVED));
  }
  const secondary = next[action].slice(1, 2);
  next[action] = [code, ...secondary.filter((c) => c !== code)];
  return next;
}

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
