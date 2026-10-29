import { describe, expect, it } from 'vitest';
import type { SessionInfo } from '@dddbanker/shared';
import { WARNING_LEAD_MS, classifyChange, formatCountdown, sessionTimes } from './sessionTiming';

const signedIn = (id: string, serverTime: string, idleExpiresAt: string): SessionInfo => ({
  authenticated: true,
  user: { id, email: `${id}@bramblewood.test`, name: id },
  csrfToken: 'token',
  idleExpiresAt,
  absoluteExpiresAt: '2026-01-02T00:00:00Z',
  serverTime,
  unreadNotifications: 0,
});
const out: SessionInfo = { authenticated: false };

describe('sessionTimes', () => {
  it("measures on the server's clock, whatever the browser's clock says", () => {
    const times = sessionTimes(signedIn('a', '2001-01-01T00:00:00Z', '2001-01-01T00:15:00Z'))!;
    expect(times.untilExpiry).toBe(15 * 60_000);
    expect(times.untilWarning).toBe(15 * 60_000 - WARNING_LEAD_MS);
  });

  it('warns immediately when less than the lead time is left', () => {
    const times = sessionTimes(signedIn('a', '2001-01-01T00:14:00Z', '2001-01-01T00:15:00Z'))!;
    expect(times.untilWarning).toBe(0);
    expect(times.untilExpiry).toBe(60_000);
  });

  it('is null when signed out', () => {
    expect(sessionTimes(out)).toBeNull();
  });
});

describe('classifyChange', () => {
  const a = signedIn('a', '2001-01-01T00:00:00Z', '2001-01-01T00:15:00Z');
  const b = signedIn('b', '2001-01-01T00:00:00Z', '2001-01-01T00:15:00Z');

  it('spots sign-ins, refreshes, and account switches', () => {
    expect(classifyChange(null, a, false).kind).toBe('signedIn');
    expect(classifyChange(out, a, false).kind).toBe('signedIn');
    expect(classifyChange(a, a, false).kind).toBe('refreshed');
    expect(classifyChange(a, b, false).kind).toBe('signedIn');
  });

  it('tells a deliberate check-out from an expiry', () => {
    expect(classifyChange(a, out, true)).toEqual({ kind: 'signedOut', reason: 'logout' });
    expect(classifyChange(a, out, false)).toEqual({ kind: 'signedOut', reason: 'expired' });
  });

  it('ignores staying signed out', () => {
    expect(classifyChange(null, out, false).kind).toBe('unchanged');
    expect(classifyChange(out, out, false).kind).toBe('unchanged');
  });
});

describe('formatCountdown', () => {
  it('formats minutes and seconds, never negative', () => {
    expect(formatCountdown(120_000)).toBe('2:00');
    expect(formatCountdown(65_400)).toBe('1:06');
    expect(formatCountdown(-5)).toBe('0:00');
  });
});
