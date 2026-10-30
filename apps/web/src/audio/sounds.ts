/**
 * Soft retro sounds, synthesized with Web Audio (no audio files). Every cue
 * goes with something you can also see, so no sound carries information on
 * its own. Cues are data so they're easy to tune and test.
 */

export type Channel = 'menu' | 'world';

export interface Note {
  /** Start, seconds after the cue begins. */
  at: number;
  /** Length, seconds (attack + release included). */
  dur: number;
  freq: number;
  /** Slide to this frequency over the note. */
  to?: number;
  wave: OscillatorType;
  /** 0..1 before volume settings. */
  gain: number;
}

export interface Cue {
  channel: Channel;
  notes: Note[];
}

const n = (
  at: number,
  dur: number,
  freq: number,
  wave: OscillatorType,
  gain: number,
  to?: number,
): Note => ({
  at,
  dur,
  freq,
  wave,
  gain,
  ...(to !== undefined ? { to } : {}),
});

export const CUES = {
  /** Cursor moves between options. */
  move: { channel: 'menu', notes: [n(0, 0.05, 880, 'square', 0.12)] },
  /** An option was picked. */
  confirm: {
    channel: 'menu',
    notes: [n(0, 0.06, 660, 'square', 0.14), n(0.05, 0.08, 990, 'square', 0.14)],
  },
  /** A window closed without a pick (Back, Escape). */
  cancel: { channel: 'menu', notes: [n(0, 0.09, 520, 'square', 0.12, 330)] },
  /** A problem: form errors, refused actions. */
  error: {
    channel: 'menu',
    notes: [n(0, 0.12, 150, 'sawtooth', 0.12), n(0.13, 0.14, 120, 'sawtooth', 0.12)],
  },
  /** Something worked. */
  success: {
    channel: 'menu',
    notes: [
      n(0, 0.09, 523, 'triangle', 0.22),
      n(0.08, 0.09, 659, 'triangle', 0.22),
      n(0.16, 0.2, 784, 'triangle', 0.22),
    ],
  },
  /** A new notice arrived. */
  notify: {
    channel: 'menu',
    notes: [n(0, 0.18, 988, 'sine', 0.2), n(0.12, 0.3, 1319, 'sine', 0.16)],
  },
  /** The security gate opens: a two-tone chime. */
  chime: {
    channel: 'world',
    notes: [n(0, 0.7, 784, 'sine', 0.28), n(0.22, 0.9, 1175, 'sine', 0.24)],
  },
  /** The gate locks, or you bump into it. */
  locked: {
    channel: 'world',
    notes: [n(0, 0.18, 220, 'triangle', 0.26), n(0.16, 0.22, 175, 'triangle', 0.26)],
  },
  /** A door swings. */
  door: {
    channel: 'world',
    notes: [n(0, 0.35, 180, 'triangle', 0.16, 120), n(0.02, 0.12, 900, 'sine', 0.05, 600)],
  },
} satisfies Record<string, Cue>;

export type CueName = keyof typeof CUES;

export interface VolumeSettings {
  muted: boolean;
  masterVolume: number;
  menuVolume: number;
  worldVolume: number;
}

/** Final gain for a channel. Squared so the sliders feel even to the ear. */
export function channelGain(v: VolumeSettings, channel: Channel) {
  if (v.muted) return 0;
  const part = channel === 'menu' ? v.menuVolume : v.worldVolume;
  return (v.masterVolume * part) ** 2;
}

/** Quick repeats of the same cue (holding an arrow key) are skipped. */
const MIN_REPEAT_MS = 35;

export class SoundBoard {
  private ctx: AudioContext | null = null;
  private volume: VolumeSettings = {
    muted: false,
    masterVolume: 0.7,
    menuVolume: 0.8,
    worldVolume: 0.8,
  };
  private readonly lastPlayed = new Map<CueName, number>();

  constructor(private readonly createContext: () => AudioContext | null = defaultContext) {}

  configure(volume: VolumeSettings) {
    this.volume = volume;
  }

  play(name: CueName) {
    const cue: Cue = CUES[name];
    const gain = channelGain(this.volume, cue.channel);
    if (gain <= 0) return;
    const now = performance.now();
    if (now - (this.lastPlayed.get(name) ?? -Infinity) < MIN_REPEAT_MS) return;
    this.lastPlayed.set(name, now);

    // Made on first use, which is always after a click or key press, so
    // browsers allow it to start.
    this.ctx ??= this.createContext();
    const ctx = this.ctx;
    if (!ctx) return;
    if (ctx.state === 'suspended') void ctx.resume();
    const start = ctx.currentTime + 0.01;
    for (const note of cue.notes) playNote(ctx, note, start, gain);
  }
}

function playNote(ctx: AudioContext, note: Note, start: number, gain: number) {
  const t0 = start + note.at;
  const t1 = t0 + note.dur;
  const osc = ctx.createOscillator();
  osc.type = note.wave;
  osc.frequency.setValueAtTime(note.freq, t0);
  if (note.to) osc.frequency.exponentialRampToValueAtTime(note.to, t1);
  const env = ctx.createGain();
  const peak = note.gain * gain;
  // Short attack and an exponential release keep it soft, with no clicks.
  env.gain.setValueAtTime(0.0001, t0);
  env.gain.exponentialRampToValueAtTime(peak, t0 + Math.min(0.012, note.dur / 4));
  env.gain.exponentialRampToValueAtTime(0.0001, t1);
  osc.connect(env).connect(ctx.destination);
  osc.start(t0);
  osc.stop(t1 + 0.02);
}

function defaultContext(): AudioContext | null {
  try {
    return typeof AudioContext === 'undefined' ? null : new AudioContext();
  } catch {
    return null;
  }
}

/** One board for the page; settings call `configure`. */
export const sounds = new SoundBoard();
