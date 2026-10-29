import { describe, expect, it, vi } from 'vitest';
import { pickInteractable, type Interactable } from './interactables';
import { TriggerZone, inZone } from './triggers';

const item = (
  id: string,
  x: number,
  z: number,
  extra: Partial<Interactable> = {},
): Interactable => ({
  id,
  prompt: id,
  spot: { x, z },
  radius: 1.3,
  anchor: { x, y: 2, z: z + 1 },
  onInteract: () => {},
  ...extra,
});

describe('pickInteractable', () => {
  it('returns nothing out of reach', () => {
    expect(pickInteractable([item('a', 5, 5)], { x: 0, z: 0 }, 0)).toBeNull();
  });

  it('picks the nearest in reach', () => {
    const picked = pickInteractable(
      [item('far', 1.1, 0), item('near', 0.3, 0)],
      { x: 0, z: 0 },
      Math.PI / 2,
    );
    expect(picked?.id).toBe('near');
  });

  it('prefers what the player is facing when two are about equally close', () => {
    // One to the north, one to the south, both 0.8m away.
    const north = item('north', 0, 0.8, { anchor: { x: 0, y: 2, z: 2 } });
    const south = item('south', 0, -0.8, { anchor: { x: 0, y: 2, z: -2 } });
    expect(pickInteractable([north, south], { x: 0, z: 0 }, 0)?.id).toBe('north');
    expect(pickInteractable([north, south], { x: 0, z: 0 }, Math.PI)?.id).toBe('south');
  });

  it('skips unavailable ones', () => {
    const off = item('off', 0, 0, { available: () => false });
    expect(pickInteractable([off], { x: 0, z: 0 }, 0)).toBeNull();
  });
});

describe('TriggerZone', () => {
  const zone = { minX: -1, maxX: 1, minZ: 0, maxZ: 1 };

  it('fires once per entry', () => {
    const onEnter = vi.fn();
    const trigger = new TriggerZone(zone, onEnter);
    trigger.update({ x: 0, z: -1 });
    trigger.update({ x: 0, z: 0.5 });
    trigger.update({ x: 0, z: 0.6 });
    expect(onEnter).toHaveBeenCalledTimes(1);
    trigger.update({ x: 0, z: 3 });
    trigger.update({ x: 0, z: 0.5 });
    expect(onEnter).toHaveBeenCalledTimes(2);
  });

  it('does not fire for someone who spawned inside it', () => {
    const onEnter = vi.fn();
    const trigger = new TriggerZone(zone, onEnter);
    trigger.markInside({ x: 0, z: 0.5 });
    trigger.update({ x: 0, z: 0.5 });
    expect(onEnter).not.toHaveBeenCalled();
  });

  it('respects its enabled check', () => {
    const onEnter = vi.fn();
    let locked = false;
    const trigger = new TriggerZone(zone, onEnter, () => locked);
    trigger.update({ x: 0, z: 0.5 });
    expect(onEnter).not.toHaveBeenCalled();
    trigger.update({ x: 0, z: 5 });
    locked = true;
    trigger.update({ x: 0, z: 0.5 });
    expect(onEnter).toHaveBeenCalledTimes(1);
  });

  it('inZone includes edges', () => {
    expect(inZone(zone, { x: 1, z: 1 })).toBe(true);
    expect(inZone(zone, { x: 1.01, z: 1 })).toBe(false);
  });
});
