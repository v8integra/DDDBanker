import * as THREE from 'three';
import { BANK } from '@dddbanker/shared';
import { ApiClient } from './api/client';
import { FollowCamera } from './camera/followCamera';
import { DEBUG, DebugOverlay } from './debug/debug';
import { Input } from './engine/input';
import { Physics } from './engine/physics';
import { applyQuality, createRenderer, resizeToDisplay } from './engine/renderer';
import { ClickMarker } from './player/clickMarker';
import { Player } from './player/player';
import { clampToBounds } from './player/steering';
import { buildExteriorScene } from './scenes/exterior';
import { SettingsStore, defaultSettings, type Settings } from './settings/settings';
import { layout } from './theme';
import { DialogStack } from './ui/dialogs';
import { Hud } from './ui/hud';
import { createMenus } from './ui/menus';

function safeLocalStorage(): Storage | null {
  try {
    const storage = window.localStorage;
    storage.getItem('probe');
    return storage;
  } catch {
    return null;
  }
}

function applyDocumentSettings(s: Settings) {
  const root = document.documentElement;
  root.style.setProperty('--text-scale', String(s.textScale));
  root.dataset.readableFont = String(s.readableFont);
  root.dataset.contrast = s.highContrast ? 'high' : 'normal';
  root.dataset.reducedMotion = String(s.reducedMotion);
}

/** Wait briefly for web fonts so canvas-drawn signs use them; never block for long. */
function fontsReady(ms = 1500) {
  return Promise.race([
    document.fonts?.ready ?? Promise.resolve(),
    new Promise((r) => setTimeout(r, ms)),
  ]);
}

async function boot() {
  document.title = BANK.name;
  const loading = document.getElementById('loading')!;
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const uiRoot = document.getElementById('ui')!;

  const media = (q: string) => window.matchMedia(q).matches;
  const store = new SettingsStore(
    safeLocalStorage(),
    defaultSettings({
      prefersReducedMotion: media('(prefers-reduced-motion: reduce)'),
      prefersMoreContrast: media('(prefers-contrast: more)'),
      lowPowerDevice: media('(pointer: coarse)') && Math.min(screen.width, screen.height) < 768,
    }),
  );
  store.subscribe(applyDocumentSettings);

  const [physics] = await Promise.all([Physics.create(), fontsReady()]);
  const renderer = createRenderer(canvas);
  const world = buildExteriorScene(physics);
  const { scene, sun, walkables } = world;

  const player = new Player(physics, store.get().playerColor, world.spawn);
  scene.add(player.character.root);
  const follow = new FollowCamera(physics, player.collider);
  const marker = new ClickMarker();
  scene.add(marker.mesh);

  const input = new Input(canvas);
  const dialogs = new DialogStack();
  const menus = createMenus(store, dialogs, uiRoot);
  const hud = new Hud({ onMenu: menus.openPause, onHelp: menus.openHelp });
  uiRoot.prepend(hud.root);
  hud.setLocation(world.locationName);

  input.onPause = menus.openPause;
  dialogs.onChange = (open) => {
    input.enabled = !open;
    if (!open) canvas.focus({ preventScroll: true });
  };

  store.subscribe((s, prev) => {
    if (s.graphics !== prev.graphics || s === prev) applyQuality(renderer, sun, s.graphics);
    if (s.playerColor !== prev.playerColor) player.character.setColor(s.playerColor);
    if (!s.clickToMove) player.setWalkTarget(null);
  });

  // Check-in status for the HUD. The gate (Phase 3) will use the same call.
  const api = new ApiClient();
  const refreshSession = () =>
    api.getSession().then(
      (session) => hud.setSession(session),
      () => hud.setSession(null),
    );
  void refreshSession();
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) void refreshSession();
  });

  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const handleClick = (click: { x: number; y: number }) => {
    const rect = canvas.getBoundingClientRect();
    ndc.set(
      ((click.x - rect.left) / rect.width) * 2 - 1,
      -((click.y - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(ndc, follow.camera);
    const hit = raycaster.intersectObjects(walkables, false)[0];
    if (!hit) return;
    const target = clampToBounds({ x: hit.point.x, z: hit.point.z }, layout.bounds);
    player.setWalkTarget(target);
    marker.show(new THREE.Vector3(target.x, hit.point.y, target.z));
  };

  const debug = DEBUG ? new DebugOverlay(scene, physics) : null;
  if (DEBUG) Object.assign(window, { __game: { player, follow, physics, store, scene, renderer } });

  let walked = 0;
  let last = performance.now();
  const frame = (now: number) => {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000); // clamp after tab switches and hitches
    last = now;
    const resized = resizeToDisplay(renderer, follow.camera);

    // Menus open: the world holds still and we skip rendering (the last frame stays up).
    if (dialogs.anyOpen) {
      input.read(dt);
      if (resized) renderer.render(scene, follow.camera);
      return;
    }

    const settings = store.get();
    const frameInput = input.read(dt);
    if (frameInput.click && settings.clickToMove) handleClick(frameInput.click);

    const before = player.position.clone();
    player.update(dt, frameInput, follow.yaw);
    physics.step(dt);
    player.afterStep(dt, settings.reducedMotion);
    follow.update(dt, player.position, frameInput, settings);
    marker.update(dt, player.hasWalkTarget, settings.reducedMotion);

    walked += before.distanceTo(player.position);
    if (walked > 4) hud.dismissHint();

    renderer.render(scene, follow.camera);
    debug?.update(
      dt,
      {
        pos: `${player.position.x.toFixed(2)}, ${player.position.y.toFixed(2)}, ${player.position.z.toFixed(2)}`,
        cam: `yaw ${follow.orbit.yaw.toFixed(2)} pitch ${follow.orbit.pitch.toFixed(2)} dist ${follow.orbit.distance.toFixed(1)}`,
      },
      renderer,
    );
  };

  loading.classList.add('loading--done');
  loading.setAttribute('aria-hidden', 'true');
  canvas.focus({ preventScroll: true });
  requestAnimationFrame(frame);
}

boot().catch((err: unknown) => {
  console.error(err);
  const loading = document.getElementById('loading');
  if (loading) {
    loading.textContent =
      'The 3D bank could not start in this browser. Please try another browser, or check that WebGL is enabled.';
  }
});
