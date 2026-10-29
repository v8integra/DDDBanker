import { describe, expect, it } from 'vitest';
import { inZone } from '../interaction/triggers';
import { interior } from '../theme';
import { STATIONS, stationSpot, staffSpot } from './stations';

const margin = 0.6;
const inside = (area: typeof interior.lobby, p: { x: number; z: number }) =>
  inZone(
    {
      minX: area.minX + margin,
      maxX: area.maxX - margin,
      minZ: area.minZ + margin,
      maxZ: area.maxZ - margin,
    },
    p,
  );

describe('station layout', () => {
  it('has unique ids', () => {
    const ids = STATIONS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('includes every station from the plan', () => {
    const ids = new Set(STATIONS.map((s) => s.id));
    for (const id of [
      'checkin',
      'newAccounts',
      'teller',
      'transfers',
      'cards',
      'autoLoans',
      'homeLoans',
      'personalLoans',
      'insurance',
      'savings',
      'security',
      'help',
      'exit',
      'notifications',
    ] as const) {
      expect(ids.has(id), id).toBe(true);
    }
  });

  it('keeps desks, staff, and standing spots inside their room', () => {
    for (const s of STATIONS) {
      const area = s.area === 'lobby' ? interior.lobby : interior.hall;
      expect(inside(area, s.position), `${s.id} desk`).toBe(true);
      expect(inside(area, stationSpot(s)), `${s.id} spot`).toBe(true);
      if (s.staff) expect(inside(area, staffSpot(s)), `${s.id} staff`).toBe(true);
    }
  });

  it('spaces stations so their prompts never overlap', () => {
    for (const a of STATIONS) {
      for (const b of STATIONS) {
        if (a === b) continue;
        const sa = stationSpot(a);
        const sb = stationSpot(b);
        expect(Math.hypot(sa.x - sb.x, sa.z - sb.z), `${a.id} vs ${b.id}`).toBeGreaterThan(2.7);
      }
    }
  });

  it('leaves the walk from the front door to the gate clear', () => {
    for (const s of STATIONS.filter((s) => s.area === 'lobby')) {
      expect(Math.abs(s.position.x), s.id).toBeGreaterThan(interior.gate.halfOpening + 2);
    }
  });

  it('has staff facing their customers', () => {
    for (const s of STATIONS) {
      const spot = stationSpot(s);
      const behind = staffSpot(s);
      const toCustomer = { x: spot.x - behind.x, z: spot.z - behind.z };
      const facing = { x: Math.sin(s.facing), z: Math.cos(s.facing) };
      expect(toCustomer.x * facing.x + toCustomer.z * facing.z, s.id).toBeGreaterThan(0);
    }
  });
});
