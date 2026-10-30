import { BANK } from '@dddbanker/shared';
import { ApiClient } from './api/client';
import { SessionWatcher } from './auth/sessionWatcher';
import { createRenderer } from './engine/renderer';
import { Game } from './game/game';
import { SettingsStore, defaultSettings, type Settings } from './settings/settings';

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
  root.dataset.statusColors = s.statusColors;
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

  await fontsReady();
  const api = new ApiClient();
  const game = new Game(
    canvas,
    uiRoot,
    createRenderer(canvas),
    store,
    api,
    new SessionWatcher(api),
  );
  await game.start();

  loading.classList.add('loading--done');
  loading.setAttribute('aria-hidden', 'true');
  canvas.focus({ preventScroll: true });
}

boot().catch((err: unknown) => {
  console.error(err);
  const loading = document.getElementById('loading');
  if (loading) {
    loading.textContent =
      'The 3D bank could not start in this browser. Please try another browser, or check that WebGL is enabled.';
  }
});
