import { describe, expect, it, vi } from 'vitest';
import { SettingsStore, defaultSettings, parseSettings } from './settings';

const env = { prefersReducedMotion: false, prefersMoreContrast: false, lowPowerDevice: false };
const defaults = defaultSettings(env);

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    data,
  };
}

describe('defaultSettings', () => {
  it('follows OS accessibility preferences and device class', () => {
    const d = defaultSettings({
      prefersReducedMotion: true,
      prefersMoreContrast: true,
      lowPowerDevice: true,
    });
    expect(d.reducedMotion).toBe(true);
    expect(d.highContrast).toBe(true);
    expect(d.graphics).toBe('low');
    expect(defaults.graphics).toBe('medium');
  });
});

describe('parseSettings', () => {
  it('keeps valid fields and replaces only the broken ones', () => {
    const parsed = parseSettings(
      {
        invertY: true,
        cameraSensitivity: 99,
        textScale: 1.25,
        graphics: 'ultra',
        playerColor: 'red',
      },
      defaults,
    );
    expect(parsed.invertY).toBe(true);
    expect(parsed.textScale).toBe(1.25);
    expect(parsed.cameraSensitivity).toBe(defaults.cameraSensitivity);
    expect(parsed.graphics).toBe(defaults.graphics);
    expect(parsed.playerColor).toBe(defaults.playerColor);
  });

  it('rejects text scales that are not offered', () => {
    expect(parseSettings({ textScale: 3 }, defaults).textScale).toBe(1);
  });

  it('validates status colors and key bindings', () => {
    expect(defaults.statusColors).toBe('standard');
    expect(defaults.keyBindings).toEqual({});
    const ok = parseSettings(
      { statusColors: 'colorblind', keyBindings: { forward: ['KeyI'] } },
      defaults,
    );
    expect(ok.statusColors).toBe('colorblind');
    expect(ok.keyBindings).toEqual({ forward: ['KeyI'] });
    const bad = parseSettings({ statusColors: 'pink', keyBindings: 'wasd' }, defaults);
    expect(bad.statusColors).toBe('standard');
    expect(bad.keyBindings).toEqual({});
  });

  it('handles junk', () => {
    expect(parseSettings(null, defaults)).toEqual(defaults);
    expect(parseSettings('nope', defaults)).toEqual(defaults);
  });
});

describe('SettingsStore', () => {
  it('loads, updates, persists, and notifies', () => {
    const storage = memoryStorage({ 'bramblewood.settings.v1': JSON.stringify({ invertY: true }) });
    const store = new SettingsStore(storage, defaults);
    expect(store.get().invertY).toBe(true);

    const listener = vi.fn();
    store.subscribe(listener);
    expect(listener).toHaveBeenCalledTimes(1); // immediate call

    store.update({ fixedCamera: true });
    expect(listener).toHaveBeenCalledTimes(2);
    expect(JSON.parse(storage.data.get('bramblewood.settings.v1')!)).toMatchObject({
      invertY: true,
      fixedCamera: true,
    });

    store.reset();
    expect(store.get()).toEqual(defaults);
  });

  it('survives corrupt or unavailable storage', () => {
    expect(
      new SettingsStore(memoryStorage({ 'bramblewood.settings.v1': '{not json' }), defaults).get(),
    ).toEqual(defaults);
    expect(new SettingsStore(null, defaults).get()).toEqual(defaults);

    const throwing = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    const store = new SettingsStore(throwing, defaults);
    expect(() => store.update({ invertY: true })).not.toThrow();
    expect(store.get().invertY).toBe(true);
  });
});
