import { z } from 'zod';
import { playerColors } from '../theme';

export const GRAPHICS_QUALITIES = ['low', 'medium', 'high'] as const;
export const TEXT_SCALES = [1, 1.125, 1.25, 1.5] as const;
export const LIGHTINGS = ['day', 'evening'] as const;

const volume = z.number().min(0).max(1);

// Each field falls back on its own, so one bad stored value doesn't wipe the rest.
const settingsSchema = (d: Settings) =>
  z.object({
    cameraSensitivity: z.number().min(0.25).max(3).catch(d.cameraSensitivity),
    invertY: z.boolean().catch(d.invertY),
    fixedCamera: z.boolean().catch(d.fixedCamera),
    clickToMove: z.boolean().catch(d.clickToMove),
    reducedMotion: z.boolean().catch(d.reducedMotion),
    textScale: z
      .number()
      .refine((v) => (TEXT_SCALES as readonly number[]).includes(v))
      .catch(d.textScale),
    readableFont: z.boolean().catch(d.readableFont),
    highContrast: z.boolean().catch(d.highContrast),
    graphics: z.enum(GRAPHICS_QUALITIES).catch(d.graphics),
    playerColor: z
      .string()
      .regex(/^#[0-9a-f]{6}$/i)
      .catch(d.playerColor),
    statusColors: z.enum(STATUS_PALETTES).catch(d.statusColors),
    /** Key overrides per action (see engine/bindings resolveBindings). */
    keyBindings: z.record(z.string(), z.array(z.string()).max(3)).catch(d.keyBindings),
    muted: z.boolean().catch(d.muted),
    masterVolume: volume.catch(d.masterVolume),
    menuVolume: volume.catch(d.menuVolume),
    worldVolume: volume.catch(d.worldVolume),
    lighting: z.enum(LIGHTINGS).catch(d.lighting),
  });

/** Status colors: standard red/green, or a colorblind-safe orange/blue. Icons and words always accompany them. */
export const STATUS_PALETTES = ['standard', 'colorblind'] as const;

export interface Settings {
  cameraSensitivity: number;
  invertY: boolean;
  fixedCamera: boolean;
  clickToMove: boolean;
  reducedMotion: boolean;
  textScale: (typeof TEXT_SCALES)[number];
  readableFont: boolean;
  highContrast: boolean;
  graphics: (typeof GRAPHICS_QUALITIES)[number];
  playerColor: string;
  statusColors: (typeof STATUS_PALETTES)[number];
  keyBindings: Record<string, string[]>;
  muted: boolean;
  /** 0..1 each; the sound board multiplies master by the channel. */
  masterVolume: number;
  menuVolume: number;
  worldVolume: number;
  lighting: (typeof LIGHTINGS)[number];
}

export interface Environment {
  prefersReducedMotion: boolean;
  prefersMoreContrast: boolean;
  /** Phones and small screens start on low graphics. */
  lowPowerDevice: boolean;
}

export function defaultSettings(env: Environment): Settings {
  return {
    cameraSensitivity: 1,
    invertY: false,
    fixedCamera: false,
    clickToMove: true,
    reducedMotion: env.prefersReducedMotion,
    textScale: 1,
    readableFont: false,
    highContrast: env.prefersMoreContrast,
    graphics: env.lowPowerDevice ? 'low' : 'medium',
    playerColor: playerColors[0]!,
    statusColors: 'standard',
    keyBindings: {},
    muted: false,
    masterVolume: 0.6,
    menuVolume: 0.8,
    worldVolume: 0.8,
    lighting: 'day',
  };
}

export function parseSettings(raw: unknown, defaults: Settings): Settings {
  const source = typeof raw === 'object' && raw !== null ? raw : {};
  return settingsSchema(defaults).parse({ ...defaults, ...source }) as Settings;
}

type KeyValueStorage = Pick<Storage, 'getItem' | 'setItem'>;
const STORAGE_KEY = 'bramblewood.settings.v1';

/** Settings with change notifications, saved per browser. Storage may be missing or throw. */
export class SettingsStore {
  private current: Settings;
  private readonly listeners = new Set<(s: Settings, prev: Settings) => void>();

  constructor(
    private readonly storage: KeyValueStorage | null,
    private readonly defaults: Settings,
  ) {
    let stored: unknown;
    try {
      const text = storage?.getItem(STORAGE_KEY);
      stored = text ? JSON.parse(text) : null;
    } catch {
      stored = null;
    }
    this.current = parseSettings(stored, defaults);
  }

  get(): Settings {
    return this.current;
  }

  update(patch: Partial<Settings>) {
    const prev = this.current;
    this.current = parseSettings({ ...prev, ...patch }, this.defaults);
    try {
      this.storage?.setItem(STORAGE_KEY, JSON.stringify(this.current));
    } catch {
      // Private mode or blocked storage: settings still apply for this visit.
    }
    for (const listener of this.listeners) listener(this.current, prev);
  }

  reset() {
    this.update(this.defaults);
  }

  /** Calls `listener` now and on every change. Returns an unsubscribe function. */
  subscribe(listener: (s: Settings, prev: Settings) => void): () => void {
    this.listeners.add(listener);
    listener(this.current, this.current);
    return () => this.listeners.delete(listener);
  }
}
