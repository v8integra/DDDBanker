import * as THREE from 'three';
import type { ApiClient } from '../api/client';
import type { SessionWatcher } from '../auth/sessionWatcher';
import { FollowCamera } from '../camera/followCamera';
import { DEBUG, DebugOverlay } from '../debug/debug';
import { Input } from '../engine/input';
import { applyQuality, resizeToDisplay } from '../engine/renderer';
import { pickInteractable, type Interactable } from '../interaction/interactables';
import { BANK_EXIT_SPAWN, buildExteriorLevel } from '../levels/exterior';
import { INTERIOR_ARRIVAL, LOBBY_RETURN, buildInteriorLevel } from '../levels/interior';
import type { Level, Spawn } from '../levels/level';
import { Character } from '../player/character';
import { ClickMarker } from '../player/clickMarker';
import type { SettingsStore } from '../settings/settings';
import { useAtm } from '../stations/banking/atm';
import { notificationsWindow } from '../stations/banking/help';
import type { BankContext } from '../stations/banking/kit';
import { infoBoardLines, runStation } from '../stations/handlers';
import { interior } from '../theme';
import { DialogStack } from '../ui/dialogs';
import { installMenuKeys } from '../ui/windows/menuKeys';
import { Windows, type DialogueOptions } from '../ui/windows/windows';
import { Fade } from '../ui/fade';
import { Hud } from '../ui/hud';
import { createMenus } from '../ui/menus';
import { InteractPrompt } from '../ui/prompt';
import { TimeoutWarning } from '../ui/timeoutWarning';
import type { BuiltStation } from '../world/interior';
import type { DoubleDoor } from '../world/door';

type ExteriorParts = Awaited<ReturnType<typeof buildExteriorLevel>>;
type InteriorParts = Awaited<ReturnType<typeof buildInteriorLevel>>;

const DOOR_SWING_MS = 450;
const FADE_MS = 350;
const NPC_TURN_TIMEOUT_MS = 450;

/**
 * Owns the running game: both levels, the frame loop, doors and fades,
 * interactions, and keeping the gate in step with the session.
 */
export class Game {
  private readonly camera = FollowCamera.createCamera();
  private readonly character: Character;
  private readonly input: Input;
  private readonly dialogs = new DialogStack();
  private readonly hud: Hud;
  private readonly prompt: InteractPrompt;
  private readonly fade: Fade;
  private readonly ui: Windows;
  /** What station flows get: session, API, windows. */
  private readonly bank: BankContext;
  private readonly marker = new ClickMarker();
  private readonly raycaster = new THREE.Raycaster();
  private readonly ndc = new THREE.Vector2();
  private readonly projected = new THREE.Vector3();
  private exterior!: ExteriorParts;
  private interiorReady!: Promise<InteriorParts>;
  private interiorParts: InteriorParts | null = null;
  private active!: Level;
  /** Mid door-transition or turning to talk: the world runs, but the player can't act. */
  private busy = false;
  private walked = 0;
  private debug: DebugOverlay | null = null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly uiRoot: HTMLElement,
    private readonly renderer: THREE.WebGLRenderer,
    private readonly store: SettingsStore,
    private readonly api: ApiClient,
    private readonly watcher: SessionWatcher,
  ) {
    this.character = new Character({ color: store.get().playerColor });
    this.input = new Input(canvas);
    const menus = createMenus(store, this.dialogs, uiRoot);
    this.hud = new Hud({
      onMenu: menus.openPause,
      onHelp: menus.openHelp,
      onBell: () => void notificationsWindow(this.bank),
    });
    uiRoot.prepend(this.hud.root);
    this.prompt = new InteractPrompt(
      (m) => this.hud.announce(m),
      () => this.interact(this.prompt.target),
    );
    uiRoot.append(this.prompt.el);
    this.fade = new Fade(uiRoot);
    this.ui = new Windows(this.dialogs, uiRoot, () => this.store.get().reducedMotion);
    this.bank = { watcher, api, ui: this.ui, openControls: menus.openHelp };
    installMenuKeys();
    new TimeoutWarning(watcher, this.dialogs, uiRoot);

    this.input.onPause = menus.openPause;
    this.dialogs.onChange = (open) => {
      this.syncInput();
      if (!open) canvas.focus({ preventScroll: true });
    };
  }

  async start() {
    this.exterior = await buildExteriorLevel(this.character, this.camera, {
      enterBank: () => void this.enterBank(),
      useAtm: () => void useAtm(this.bank),
      readPlaque: () =>
        void this.say({
          speaker: 'Welcome sign',
          lines: [
            'Welcome to the Bank of Bramblewood!',
            'Walk to the front door to enter. Press E to interact.',
            'W A S D or arrows to walk, drag to look around.',
          ],
        }),
    });
    this.activate(this.exterior.level, null);

    // Build the bank's interior in the background so the doors open instantly.
    this.interiorReady = new Promise<InteriorParts>((resolve) => setTimeout(resolve, 0)).then(() =>
      buildInteriorLevel(this.character, this.camera, {
        leaveBank: () => void this.leaveBank(),
        talkTo: (station) => void this.talkTo(station),
        readInfoBoard: () =>
          void this.say({ speaker: 'Information board', lines: infoBoardLines() }),
        bumpGate: () => this.bumpGate(),
      }),
    );
    this.interiorReady.then((parts) => {
      this.interiorParts = parts;
      parts.gate.setLocked(!this.watcher.signedIn);
      applyQuality(this.renderer, parts.level.sun, this.store.get().graphics);
    });

    this.store.subscribe((s, prev) => {
      if (s.graphics !== prev.graphics || s === prev) {
        applyQuality(this.renderer, this.exterior.level.sun, s.graphics);
        if (this.interiorParts)
          applyQuality(this.renderer, this.interiorParts.level.sun, s.graphics);
      }
      if (s.playerColor !== prev.playerColor) this.character.setColor(s.playerColor);
      if (!s.clickToMove) this.active.player.setWalkTarget(null);
    });

    this.watcher.subscribe((change, session) => {
      this.hud.setSession(session);
      const gate = this.interiorParts?.gate;
      if (change.kind === 'signedIn') {
        gate?.setLocked(false);
        this.hud.toast(`Checked in as ${change.session.user.name}. The security gate is open.`);
      } else if (change.kind === 'signedOut') {
        gate?.setLocked(true);
        void this.onSignedOut(change.reason);
      }
    });
    this.hud.setSession(this.watcher.session);
    this.watcher.start();

    if (DEBUG) {
      this.debug = new DebugOverlay(
        () => this.active.scene,
        () => this.active.physics,
      );
      const debugApi = {
        game: this,
        store: this.store,
        /** Sign in from the console while the check-in window is still being built. */
        login: async (email: string, password: string) =>
          this.watcher.apply(await this.api.login({ email, password })),
        logout: () => this.watcher.checkOut(),
      };
      // Live views of whichever level is active.
      Object.defineProperties(debugApi, {
        level: { get: () => this.active.id },
        player: { get: () => this.active.player },
        follow: { get: () => this.active.follow },
      });
      Object.assign(window, { __game: debugApi });
    }

    let last = performance.now();
    const frame = (now: number) => {
      requestAnimationFrame(frame);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      this.frame(dt);
    };
    requestAnimationFrame(frame);
  }

  private frame(dt: number) {
    const resized = resizeToDisplay(this.renderer, this.camera);
    if (this.dialogs.anyOpen) {
      // A window is open: the world holds still and the last frame stays up.
      this.input.read(dt);
      this.prompt.update(null, this.camera, this.canvas, this.projected);
      if (resized) this.renderer.render(this.active.scene, this.camera);
      return;
    }

    const settings = this.store.get();
    const level = this.active;
    const input = this.input.read(dt);

    if (input.click && settings.clickToMove && !this.busy) this.handleClick(input.click);
    if (input.pressed.has('interact') && !this.busy) this.interact(this.prompt.target);

    const before = level.player.position.clone();
    level.player.update(dt, input, level.follow.yaw);
    level.physics.step(dt);
    level.player.afterStep(dt, settings.reducedMotion);
    level.follow.update(dt, level.player.position, input, settings);
    level.update(dt, settings.reducedMotion);
    this.marker.update(dt, level.player.hasWalkTarget, settings.reducedMotion);

    const p = { x: level.player.position.x, z: level.player.position.z };
    if (!this.busy) for (const trigger of level.triggers) trigger.update(p);
    this.hud.setLocation(level.locationAt(p));

    const target = this.busy ? null : pickInteractable(level.interactables, p, level.player.facing);
    this.prompt.update(target, this.camera, this.canvas, this.projected);

    this.walked += before.distanceTo(level.player.position);
    if (this.walked > 4) this.hud.dismissHint();

    this.renderer.render(level.scene, this.camera);
    this.debug?.update(
      dt,
      {
        level: level.id,
        pos: `${p.x.toFixed(2)}, ${level.player.position.y.toFixed(2)}, ${p.z.toFixed(2)}`,
        cam: `yaw ${level.follow.orbit.yaw.toFixed(2)} pitch ${level.follow.orbit.pitch.toFixed(2)} dist ${level.follow.orbit.distance.toFixed(1)}`,
        session: this.watcher.signedIn ? 'checked in' : 'not checked in',
      },
      this.renderer,
    );
  }

  /** Place the camera and draw one frame even while the loop is paused. */
  private renderNow() {
    const level = this.active;
    const still = {
      move: { x: 0, z: 0 },
      run: false,
      orbitYaw: 0,
      orbitPitch: 0,
      zoom: 0,
      click: null,
      pressed: new Set<never>(),
      manualMove: false,
    };
    level.follow.update(1, level.player.position, still, this.store.get());
    this.hud.setLocation(
      level.locationAt({ x: level.player.position.x, z: level.player.position.z }),
    );
    this.renderer.render(level.scene, this.camera);
  }

  private syncInput() {
    this.input.enabled = !this.dialogs.anyOpen && !this.busy;
  }

  private setBusy(busy: boolean) {
    this.busy = busy;
    this.syncInput();
  }

  /** Make `level` the one being played, with the player at `spawn` (or where they are). */
  private activate(level: Level, spawn: Spawn | null, cameraYaw = spawn?.facing ?? 0) {
    this.active = level;
    level.scene.add(this.character.root, this.marker.mesh);
    if (spawn) level.player.teleport(spawn.x, spawn.y, spawn.z, spawn.facing);
    level.follow.reset(cameraYaw);
    const p = { x: level.player.position.x, z: level.player.position.z };
    for (const trigger of level.triggers) trigger.markInside(p);
    this.hud.setLocation(level.locationAt(p));
  }

  private async throughDoor(
    from: DoubleDoor,
    to: DoubleDoor,
    level: Level,
    spawn: Spawn,
    cameraYaw: number,
  ) {
    if (this.busy) return;
    const reduced = this.store.get().reducedMotion;
    this.setBusy(true);
    this.active.player.setWalkTarget(null);
    from.open();
    await wait(reduced ? 0 : DOOR_SWING_MS);
    await this.fade.to(1, FADE_MS, reduced);
    from.close();
    this.activate(level, spawn, cameraYaw);
    to.open();
    await this.fade.to(0, FADE_MS, reduced);
    to.close();
    this.setBusy(false);
  }

  private async enterBank() {
    const inside = await this.interiorReady;
    await this.throughDoor(this.exterior.door, inside.door, inside.level, INTERIOR_ARRIVAL, 0);
  }

  private async leaveBank() {
    const inside = await this.interiorReady;
    await this.throughDoor(
      inside.door,
      this.exterior.door,
      this.exterior.level,
      BANK_EXIT_SPAWN,
      Math.PI,
    );
  }

  private bumpGate() {
    this.interiorParts?.gate.bump();
    this.hud.toast('The gate is locked. Please check in at the front desk first.');
  }

  /** Session ended: anyone in the banking hall is walked back to the lobby. */
  private async onSignedOut(reason: 'logout' | 'expired') {
    const parts = this.interiorParts;
    const inHall =
      parts && this.active === parts.level && parts.level.player.position.z > interior.gate.z - 0.4;
    if (inHall) {
      this.dialogs.closeAll();
      await this.fade.to(1, FADE_MS, this.store.get().reducedMotion);
      parts.level.player.teleport(
        LOBBY_RETURN.x,
        LOBBY_RETURN.y,
        LOBBY_RETURN.z,
        LOBBY_RETURN.facing,
      );
      parts.level.follow.reset(LOBBY_RETURN.facing);
      for (const trigger of parts.level.triggers)
        trigger.markInside({ x: LOBBY_RETURN.x, z: LOBBY_RETURN.z });
      this.renderNow(); // a dialogue may be open, which pauses the normal frame loop
      await this.fade.to(0, FADE_MS, this.store.get().reducedMotion);
    }
    if (reason === 'expired') {
      this.dialogs.closeAll();
      await this.say({
        speaker: 'Security gate',
        lines: [
          'Your session has expired, so you have been checked out for your security.',
          'Please check in again at the front desk to get back to the banking hall.',
        ],
      });
    } else {
      this.hud.toast('You are checked out. The security gate is locked again.');
    }
  }

  private interact(target: Interactable | null) {
    if (!target || this.busy || this.dialogs.anyOpen) return;
    const p = this.active.player.position;
    const inReach = Math.hypot(target.spot.x - p.x, target.spot.z - p.z) <= target.radius;
    if (!inReach) return;
    void target.onInteract();
  }

  private async talkTo(station: BuiltStation) {
    if (this.busy) return;
    this.setBusy(true);
    const player = this.active.player;
    player.setWalkTarget(null);
    const npc = station.npc;
    if (npc) {
      player.faceToward(npc.position.x, npc.position.z);
      npc.faceToward(player.position.x, player.position.z);
      const started = performance.now();
      while (!npc.settled && performance.now() - started < NPC_TURN_TIMEOUT_MS) await nextFrame();
    } else {
      player.faceToward(station.def.position.x, station.def.position.z);
    }
    this.setBusy(false);
    try {
      await runStation(station.def, this.bank);
    } finally {
      npc?.resetFacing();
    }
  }

  private say<T extends string = 'ok'>(options: DialogueOptions<T>) {
    return this.ui.dialogue<T>(options);
  }

  private handleClick(click: { x: number; y: number }) {
    const level = this.active;
    const rect = this.canvas.getBoundingClientRect();
    this.ndc.set(
      ((click.x - rect.left) / rect.width) * 2 - 1,
      -((click.y - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.ndc, this.camera);

    // Clicking a person, sign, or door walks you over and uses it.
    const clickable = level.interactables.filter(
      (i) => i.clickTargets && (!i.available || i.available()),
    );
    const hits = this.raycaster.intersectObjects(
      clickable.flatMap((i) => i.clickTargets ?? []),
      true,
    );
    const ground = this.raycaster.intersectObjects(level.walkables, false)[0];
    const hit = hits[0];
    if (hit && (!ground || hit.distance <= ground.distance)) {
      const target = clickable.find((i) => i.clickTargets?.some((t) => isAncestor(t, hit.object)));
      if (target) {
        const p = level.player.position;
        if (Math.hypot(target.spot.x - p.x, target.spot.z - p.z) <= target.radius) {
          this.interact(target);
        } else {
          level.player.setWalkTarget(target.spot, () => this.interact(target));
          this.marker.show(new THREE.Vector3(target.spot.x, p.y, target.spot.z));
        }
        return;
      }
    }

    if (!ground) return;
    const point = level.clampTarget({ x: ground.point.x, z: ground.point.z });
    level.player.setWalkTarget(point);
    this.marker.show(new THREE.Vector3(point.x, ground.point.y, point.z));
  }
}

function isAncestor(ancestor: THREE.Object3D, node: THREE.Object3D | null): boolean {
  for (let n = node; n; n = n.parent) if (n === ancestor) return true;
  return false;
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
