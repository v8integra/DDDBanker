import { describe, expect, it, vi } from 'vitest';
import { CUES, SoundBoard, channelGain, type VolumeSettings } from './sounds';

const loud: VolumeSettings = { muted: false, masterVolume: 1, menuVolume: 1, worldVolume: 1 };

function fakeContext() {
  const param = () => ({ setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() });
  const oscillators: { start: ReturnType<typeof vi.fn> }[] = [];
  const ctx = {
    state: 'running',
    currentTime: 0,
    destination: {},
    resume: vi.fn(),
    createOscillator: () => {
      const osc = {
        type: '',
        frequency: param(),
        connect: (x: unknown) => x,
        start: vi.fn(),
        stop: vi.fn(),
      };
      oscillators.push(osc);
      return osc;
    },
    createGain: () => ({ gain: param(), connect: (x: unknown) => x }),
  };
  return { ctx: ctx as unknown as AudioContext, oscillators };
}

describe('cues', () => {
  it('are short and quiet', () => {
    for (const [name, cue] of Object.entries(CUES)) {
      const end = Math.max(...cue.notes.map((n) => n.at + n.dur));
      expect(end, name).toBeLessThanOrEqual(1.2);
      for (const note of cue.notes) {
        expect(note.gain, name).toBeLessThanOrEqual(0.3);
        expect(note.freq, name).toBeGreaterThan(20);
      }
    }
  });
});

describe('channelGain', () => {
  it('multiplies master and channel, squared, and mutes', () => {
    expect(channelGain({ ...loud, masterVolume: 0.5 }, 'menu')).toBeCloseTo(0.25);
    expect(channelGain({ ...loud, worldVolume: 0 }, 'world')).toBe(0);
    expect(channelGain({ ...loud, muted: true }, 'menu')).toBe(0);
  });
});

describe('SoundBoard', () => {
  it('does not create audio until something is heard', () => {
    const create = vi.fn(() => fakeContext().ctx);
    const board = new SoundBoard(create);
    board.configure({ ...loud, muted: true });
    board.play('confirm');
    expect(create).not.toHaveBeenCalled();
    board.configure(loud);
    board.play('confirm');
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('plays every note of a cue and skips instant repeats', () => {
    const fake = fakeContext();
    const board = new SoundBoard(() => fake.ctx);
    board.configure(loud);
    board.play('success');
    board.play('success');
    expect(fake.oscillators).toHaveLength(CUES.success.notes.length);
  });

  it('copes with no Web Audio at all', () => {
    const board = new SoundBoard(() => null);
    board.configure(loud);
    expect(() => board.play('chime')).not.toThrow();
  });
});
