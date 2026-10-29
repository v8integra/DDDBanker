import {
  DEFAULT_BINDINGS,
  applyDeadzone,
  isActive,
  isClick,
  keyboardMoveIntent,
  type Action,
  type Bindings,
  type PointerSample,
} from './bindings';

export interface FrameInput {
  /** x = strafe right, z = forward; length 0..1. */
  move: { x: number; z: number };
  run: boolean;
  /** Camera turn in radians this frame (before sensitivity). */
  orbitYaw: number;
  orbitPitch: number;
  /** Meters to zoom out (negative = in). */
  zoom: number;
  /** Screen position of a click-to-move tap, if one happened this frame. */
  click: { x: number; y: number } | null;
  /** Actions pressed this frame (edges, not holds). */
  pressed: Set<Action>;
  /** True if any movement came from keys or a stick (cancels click-to-move). */
  manualMove: boolean;
}

const DRAG_RADIANS_PER_PIXEL = 0.005;
const KEY_TURN_SPEED = 2.2; // rad/s
const KEY_ZOOM_SPEED = 8; // m/s
const STICK_TURN_SPEED = 2.6;
const WHEEL_METERS_PER_PIXEL = 0.01;

/** Elements where keys belong to the element, not the game. */
function isTextEntry(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName))
  );
}
function isActivatable(target: EventTarget | null) {
  return target instanceof HTMLElement && ['BUTTON', 'A', 'SUMMARY'].includes(target.tagName);
}

/**
 * Collects keyboard, mouse/touch, and gamepad input and hands out one
 * snapshot per frame. While `enabled` is false (a menu is open) it ignores
 * everything and forgets held keys.
 */
export class Input {
  enabled = true;
  bindings: Bindings = DEFAULT_BINDINGS;
  /** Called when the pause action is pressed during play. */
  onPause: (() => void) | null = null;

  private readonly held = new Set<string>();
  private readonly edges = new Set<Action>();
  private dragYaw = 0;
  private dragPitch = 0;
  private wheel = 0;
  private click: { x: number; y: number } | null = null;
  private pointerDown: (PointerSample & { id: number; button: number }) | null = null;
  private dragging = false;
  private readonly cleanups: (() => void)[] = [];

  constructor(private readonly surface: HTMLElement) {
    this.listen(window, 'keydown', (e) => this.onKeyDown(e as KeyboardEvent));
    this.listen(window, 'keyup', (e) => this.held.delete((e as KeyboardEvent).code));
    this.listen(window, 'blur', () => this.held.clear());
    this.listen(surface, 'pointerdown', (e) => this.onPointerDown(e as PointerEvent));
    this.listen(surface, 'pointermove', (e) => this.onPointerMove(e as PointerEvent));
    this.listen(surface, 'pointerup', (e) => this.onPointerUp(e as PointerEvent));
    this.listen(surface, 'pointercancel', () => {
      this.pointerDown = null;
      this.dragging = false;
    });
    this.listen(surface, 'contextmenu', (e) => e.preventDefault());
    this.listen(
      surface,
      'wheel',
      (e) => {
        e.preventDefault();
        if (this.enabled) this.wheel += (e as WheelEvent).deltaY * WHEEL_METERS_PER_PIXEL;
      },
      { passive: false },
    );
  }

  dispose() {
    for (const cleanup of this.cleanups) cleanup();
  }

  /** Snapshot input for this frame and reset per-frame accumulators. */
  read(dt: number): FrameInput {
    const pressed = new Set(this.edges);
    this.edges.clear();
    if (!this.enabled) {
      this.held.clear();
      this.resetAccumulators();
      return {
        move: { x: 0, z: 0 },
        run: false,
        orbitYaw: 0,
        orbitPitch: 0,
        zoom: 0,
        click: null,
        pressed,
        manualMove: false,
      };
    }

    let move = keyboardMoveIntent(this.held, this.bindings);
    let run = isActive('run', this.held, this.bindings);
    let orbitYaw = this.dragYaw;
    let orbitPitch = this.dragPitch;
    let zoom = this.wheel;

    const turn =
      Number(isActive('rotateRight', this.held, this.bindings)) -
      Number(isActive('rotateLeft', this.held, this.bindings));
    orbitYaw += turn * KEY_TURN_SPEED * dt;
    const keyZoom =
      Number(isActive('zoomOut', this.held, this.bindings)) -
      Number(isActive('zoomIn', this.held, this.bindings));
    zoom += keyZoom * KEY_ZOOM_SPEED * dt;

    const pad = this.readGamepad();
    if (pad) {
      if (pad.move.x !== 0 || pad.move.z !== 0) move = pad.move;
      run ||= pad.run;
      orbitYaw += pad.look.x * STICK_TURN_SPEED * dt;
      orbitPitch += pad.look.y * STICK_TURN_SPEED * dt;
      for (const action of pad.pressed) pressed.add(action);
    }

    const click = this.click;
    this.resetAccumulators();
    return {
      move,
      run,
      orbitYaw,
      orbitPitch,
      zoom,
      click,
      pressed,
      manualMove: move.x !== 0 || move.z !== 0,
    };
  }

  private resetAccumulators() {
    this.dragYaw = 0;
    this.dragPitch = 0;
    this.wheel = 0;
    this.click = null;
  }

  private listen(
    target: EventTarget,
    type: string,
    handler: (e: Event) => void,
    options?: AddEventListenerOptions,
  ) {
    target.addEventListener(type, handler, options);
    this.cleanups.push(() => target.removeEventListener(type, handler, options));
  }

  private onKeyDown(e: KeyboardEvent) {
    if (!this.enabled || isTextEntry(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
    // While a menu is open, Escape is handled by the <dialog> itself.
    if (this.bindings.pause.includes(e.code)) {
      e.preventDefault();
      if (!e.repeat) this.onPause?.();
      return;
    }
    // Enter/Space on a focused button should press the button, not the game.
    if (isActivatable(e.target) && (e.code === 'Enter' || e.code === 'Space')) return;

    const action = (Object.keys(this.bindings) as Action[]).find((a) =>
      this.bindings[a].includes(e.code),
    );
    if (!action) return;
    e.preventDefault(); // stop arrow keys scrolling the page
    if (!e.repeat) this.edges.add(action);
    this.held.add(e.code);
  }

  private onPointerDown(e: PointerEvent) {
    if (!this.enabled || this.pointerDown) return;
    this.surface.focus({ preventScroll: true });
    this.surface.setPointerCapture(e.pointerId);
    this.pointerDown = {
      x: e.clientX,
      y: e.clientY,
      time: e.timeStamp,
      id: e.pointerId,
      button: e.button,
    };
    this.dragging = false;
  }

  private onPointerMove(e: PointerEvent) {
    const down = this.pointerDown;
    if (!down || down.id !== e.pointerId || !this.enabled) return;
    if (!this.dragging && !isClick(down, { x: e.clientX, y: e.clientY, time: down.time }))
      this.dragging = true;
    if (this.dragging) {
      this.dragYaw += e.movementX * DRAG_RADIANS_PER_PIXEL;
      this.dragPitch += e.movementY * DRAG_RADIANS_PER_PIXEL;
    }
  }

  private onPointerUp(e: PointerEvent) {
    const down = this.pointerDown;
    if (!down || down.id !== e.pointerId) return;
    this.pointerDown = null;
    const wasDrag = this.dragging;
    this.dragging = false;
    if (!this.enabled || wasDrag || down.button !== 0) return;
    if (isClick(down, { x: e.clientX, y: e.clientY, time: e.timeStamp })) {
      this.click = { x: e.clientX, y: e.clientY };
    }
  }

  private padButtons = new Set<number>();

  private readGamepad() {
    const pad = navigator.getGamepads?.().find((p) => p?.connected);
    if (!pad) return null;
    const left = applyDeadzone(pad.axes[0] ?? 0, pad.axes[1] ?? 0);
    const right = applyDeadzone(pad.axes[2] ?? 0, pad.axes[3] ?? 0);

    // Standard mapping: A = interact, Start = pause, left stick click / LB = run.
    const pressed = new Set<Action>();
    const edge = (index: number, action: Action) => {
      const down = pad.buttons[index]?.pressed ?? false;
      if (down && !this.padButtons.has(index)) pressed.add(action);
      if (down) this.padButtons.add(index);
      else this.padButtons.delete(index);
    };
    edge(0, 'interact');
    edge(9, 'pause');
    if (pressed.has('pause')) {
      pressed.delete('pause');
      this.onPause?.();
    }

    return {
      move: { x: left.x, z: -left.y },
      run: (pad.buttons[10]?.pressed ?? false) || (pad.buttons[4]?.pressed ?? false),
      look: right,
      pressed,
    };
  }
}
