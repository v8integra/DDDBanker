import { BANK } from '@dddbanker/shared';
import { ACTIONS, canBind, rebind, resolveBindings, type Action } from '../engine/bindings';
import {
  GRAPHICS_QUALITIES,
  STATUS_PALETTES,
  TEXT_SCALES,
  type Settings,
  type SettingsStore,
} from '../settings/settings';
import { playerColors } from '../theme';
import { h, retroDialog, type DialogStack } from './dialogs';

const KEY_NAMES: Record<string, string> = {
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  ShiftLeft: 'Shift',
  ShiftRight: 'Shift',
  Equal: '+',
  Minus: '−',
  NumpadAdd: 'Num +',
  NumpadSubtract: 'Num −',
  Escape: 'Esc',
};
const keyName = (code: string) => KEY_NAMES[code] ?? code.replace(/^Key/, '');

export const ACTION_LABELS: Record<Action, string> = {
  forward: 'Walk forward',
  back: 'Walk back',
  left: 'Walk left',
  right: 'Walk right',
  run: 'Run (hold)',
  rotateLeft: 'Turn camera left',
  rotateRight: 'Turn camera right',
  zoomIn: 'Zoom in',
  zoomOut: 'Zoom out',
  interact: 'Talk / interact',
  travel: 'Quick travel',
  pause: 'Pause menu',
};

const CONTROL_ROWS: [Action | string[], string][] = [
  ['forward', ACTION_LABELS.forward],
  ['back', ACTION_LABELS.back],
  ['left', ACTION_LABELS.left],
  ['right', ACTION_LABELS.right],
  ['run', ACTION_LABELS.run],
  [['Click or tap the ground'], 'Walk to a spot'],
  [['Drag with mouse or finger'], 'Look around'],
  ['rotateLeft', ACTION_LABELS.rotateLeft],
  ['rotateRight', ACTION_LABELS.rotateRight],
  ['zoomIn', ACTION_LABELS.zoomIn],
  ['zoomOut', ACTION_LABELS.zoomOut],
  [['Mouse wheel'], 'Zoom'],
  ['interact', ACTION_LABELS.interact],
  ['travel', ACTION_LABELS.travel],
  ['pause', ACTION_LABELS.pause],
];

const closeOwnDialog = (e: Event) => (e.target as HTMLElement).closest('dialog')?.close();
const keysOf = (codes: readonly string[]) => [...new Set(codes.map(keyName))];

/** The Controls window. It always shows the keys currently in use. */
export function createHelpDialog(store: SettingsStore) {
  const body = h('tbody', {});
  store.subscribe((s) => {
    const bindings = resolveBindings(s.keyBindings);
    body.replaceChildren(
      ...CONTROL_ROWS.map(([keys, label]) => {
        const cells = Array.isArray(keys)
          ? keys.map((text) => h('span', {}, text))
          : keysOf(bindings[keys]).map((k) => h('kbd', {}, k));
        return h('tr', {}, h('th', { scope: 'row' }, label), h('td', {}, ...cells));
      }),
    );
  });
  return retroDialog(
    'help-dialog',
    'Controls',
    h('table', { class: 'controls-table' }, body),
    h(
      'p',
      { class: 'retro-note' },
      'A gamepad works too: left stick walks, right stick looks, A interacts, Start pauses. Change keys in Settings.',
    ),
  );
}

/**
 * The "Controls" part of Settings: each action shows its keys and a Change
 * button that listens for the next key. Escape cancels; two actions never
 * share a key; Escape always opens the menu.
 */
function controlsFieldset(store: SettingsStore, syncers: ((s: Settings) => void)[]) {
  const status = h('p', { class: 'setting__hint', role: 'status', 'aria-live': 'polite' });
  let stopListening: (() => void) | null = null;

  const rows = ACTIONS.map((action) => {
    const keys = h('span', { class: 'keybind__keys' });
    const button = h(
      'button',
      {
        type: 'button',
        class: 'keybind__change',
        'aria-label': `Change key for ${ACTION_LABELS[action]}`,
      },
      'Change',
    );
    const listen = () => {
      stopListening?.();
      button.textContent = 'Press a key…';
      status.textContent = `Press the new key for ${ACTION_LABELS[action]}, or Escape to cancel.`;
      const onKey = (e: KeyboardEvent) => {
        // Capture phase on window: the key never reaches the game or the menus.
        e.preventDefault();
        e.stopPropagation();
        if (e.code === 'Escape') {
          stop();
          status.textContent = 'Cancelled.';
          return;
        }
        if (!canBind(e.code)) {
          status.textContent = `${keyName(e.code)} can't be used. Try another key, or Escape to cancel.`;
          return;
        }
        stop();
        store.update({
          keyBindings: rebind(resolveBindings(store.get().keyBindings), action, e.code),
        });
        status.textContent = `${ACTION_LABELS[action]} is now ${keyName(e.code)}.`;
        button.focus();
      };
      const stop = () => {
        window.removeEventListener('keydown', onKey, true);
        button.textContent = 'Change';
        stopListening = null;
      };
      window.addEventListener('keydown', onKey, true);
      stopListening = stop;
    };
    button.addEventListener('click', listen);
    syncers.push((s) => {
      keys.replaceChildren(
        ...keysOf(resolveBindings(s.keyBindings)[action]).map((k) => h('kbd', {}, k)),
      );
    });
    return h(
      'div',
      { class: 'keybind' },
      h('span', { class: 'keybind__label' }, ACTION_LABELS[action]),
      keys,
      button,
    );
  });

  return h(
    'fieldset',
    {},
    h('legend', {}, 'Controls'),
    ...rows,
    status,
    h(
      'button',
      {
        type: 'button',
        class: 'retro-option retro-option--quiet',
        onclick: () => store.update({ keyBindings: {} }),
      },
      'Reset keys',
    ),
  );
}

export function createPauseDialog(actions: {
  onSettings: () => void;
  onHelp: () => void;
  /** Dev only (?debug): the bank time machine. */
  onTimeMachine?: () => void;
  onTravel?: () => void;
}) {
  const menu = h(
    'div',
    { class: 'retro-menu', role: 'group', 'aria-label': 'Pause menu' },
    h(
      'button',
      { type: 'button', class: 'retro-option', autofocus: true, onclick: closeOwnDialog },
      'Resume',
    ),
    h('button', { type: 'button', class: 'retro-option', onclick: actions.onSettings }, 'Settings'),
    actions.onTravel
      ? h(
          'button',
          { type: 'button', class: 'retro-option', onclick: actions.onTravel },
          'Quick travel',
        )
      : null,
    h('button', { type: 'button', class: 'retro-option', onclick: actions.onHelp }, 'Controls'),
    h('a', { class: 'retro-option', href: '/classic.html' }, 'Switch to classic view (no 3D)'),
    actions.onTimeMachine
      ? h(
          'button',
          { type: 'button', class: 'retro-option', onclick: actions.onTimeMachine },
          'Time machine (dev)',
        )
      : null,
  );
  return retroDialog(
    'pause-dialog',
    'Paused',
    menu,
    h('p', { class: 'retro-note' }, BANK.disclaimer),
  );
}

/**
 * Settings window. Every control applies immediately (and is saved per
 * browser), and every control re-reads the store on change, so Reset just works.
 */
export function createSettingsDialog(store: SettingsStore) {
  const syncers: ((s: Settings) => void)[] = [];
  const update = (patch: Partial<Settings>) => store.update(patch);

  const checkbox = (key: keyof Settings, label: string, hint?: string) => {
    const id = `setting-${key}`;
    const input = h('input', {
      type: 'checkbox',
      id,
      ...(hint ? { 'aria-describedby': `${id}-hint` } : {}),
      onchange: (e) => update({ [key]: (e.target as HTMLInputElement).checked }),
    });
    syncers.push((s) => (input.checked = Boolean(s[key])));
    return h(
      'div',
      { class: 'setting' },
      input,
      h('label', { for: id }, label),
      hint ? h('p', { class: 'setting__hint', id: `${id}-hint` }, hint) : null,
    );
  };

  const select = <T extends string | number>(
    key: keyof Settings,
    label: string,
    options: readonly T[],
    format: (v: T) => string,
  ) => {
    const id = `setting-${key}`;
    const el = h(
      'select',
      {
        id,
        onchange: (e) => {
          const raw = (e.target as HTMLSelectElement).value;
          update({ [key]: typeof options[0] === 'number' ? Number(raw) : raw });
        },
      },
      ...options.map((o) => h('option', { value: String(o) }, format(o))),
    );
    syncers.push((s) => (el.value = String(s[key])));
    return h('div', { class: 'setting setting--stacked' }, h('label', { for: id }, label), el);
  };

  const sensitivityId = 'setting-cameraSensitivity';
  const sensitivityOutput = h('output', { for: sensitivityId });
  const sensitivity = h('input', {
    type: 'range',
    id: sensitivityId,
    min: '0.25',
    max: '3',
    step: '0.25',
    oninput: (e) => update({ cameraSensitivity: Number((e.target as HTMLInputElement).value) }),
  });
  syncers.push((s) => {
    sensitivity.value = String(s.cameraSensitivity);
    sensitivityOutput.textContent = `${s.cameraSensitivity.toFixed(2)}×`;
  });

  const swatches = playerColors.map((color, i) =>
    h('button', {
      type: 'button',
      class: 'swatch',
      style: `--swatch:${color}`,
      'aria-label': `Character color ${i + 1}`,
      onclick: () => update({ playerColor: color }),
    }),
  );
  syncers.push((s) =>
    swatches.forEach((b, i) =>
      b.setAttribute('aria-pressed', String(playerColors[i] === s.playerColor)),
    ),
  );

  const dialog = retroDialog(
    'settings-dialog',
    'Settings',
    h(
      'fieldset',
      {},
      h('legend', {}, 'Camera'),
      h(
        'div',
        { class: 'setting setting--stacked' },
        h('label', { for: sensitivityId }, 'Look sensitivity'),
        h('div', { class: 'setting__range' }, sensitivity, sensitivityOutput),
      ),
      checkbox('invertY', 'Invert vertical look'),
      checkbox(
        'fixedCamera',
        'Fixed camera',
        'Keeps the camera steady behind you. Zoom still works.',
      ),
    ),
    h(
      'fieldset',
      {},
      h('legend', {}, 'Movement'),
      checkbox('clickToMove', 'Click or tap the ground to walk there'),
    ),
    h(
      'fieldset',
      {},
      h('legend', {}, 'Comfort and reading'),
      checkbox('reducedMotion', 'Reduce motion', 'Turns off bobbing, swaying, and pulsing.'),
      select('textScale', 'Text size', TEXT_SCALES, (v) => `${Math.round(v * 100)}%`),
      checkbox('readableFont', 'Use a plain, readable font everywhere'),
      checkbox('highContrast', 'High contrast menus'),
      select('statusColors', 'Status colors', STATUS_PALETTES, (v) =>
        v === 'standard' ? 'Standard (red and green)' : 'Colorblind-safe (orange and blue)',
      ),
    ),
    controlsFieldset(store, syncers),
    h(
      'fieldset',
      {},
      h('legend', {}, 'Display'),
      select(
        'graphics',
        'Graphics quality',
        GRAPHICS_QUALITIES,
        (v) => v[0]!.toUpperCase() + v.slice(1),
      ),
      h(
        'div',
        { class: 'setting setting--stacked' },
        h('span', { class: 'setting__label', id: 'swatch-label' }, 'Character color'),
        h(
          'div',
          { class: 'swatches', role: 'group', 'aria-labelledby': 'swatch-label' },
          ...swatches,
        ),
      ),
    ),
    h(
      'div',
      { class: 'retro-actions' },
      h(
        'button',
        { type: 'button', class: 'retro-option retro-option--quiet', onclick: () => store.reset() },
        'Reset to defaults',
      ),
      h('button', { type: 'button', class: 'retro-option', onclick: closeOwnDialog }, 'Done'),
    ),
  );

  store.subscribe((s) => syncers.forEach((sync) => sync(s)));
  return dialog;
}

/** Build the pause, settings, and help windows and wire them into a DialogStack. */
export function createMenus(
  store: SettingsStore,
  dialogs: DialogStack,
  mount: HTMLElement,
  extras: { onTimeMachine?: () => void; onTravel?: () => void } = {},
) {
  const settings = createSettingsDialog(store);
  const help = createHelpDialog(store);
  const pause = createPauseDialog({
    onSettings: () => dialogs.open(settings),
    onHelp: () => dialogs.open(help),
    ...extras,
  });
  mount.append(pause, settings, help);

  return {
    openPause: () => dialogs.open(pause),
    openHelp: () => dialogs.open(help),
    openSettings: () => dialogs.open(settings),
  };
}
