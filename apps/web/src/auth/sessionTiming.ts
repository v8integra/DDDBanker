import type { SessionInfo } from '@dddbanker/shared';

/** Warn this long before the idle timeout (WCAG 2.2.1: let people extend time limits). */
export const WARNING_LEAD_MS = 2 * 60_000;

export interface SessionTimes {
  /** Milliseconds until the session ends from inactivity, measured on the server's clock. */
  untilExpiry: number;
  /** Milliseconds until the "still there?" warning should show (0 = show now). */
  untilWarning: number;
}

/**
 * Work out timers from the server's own clock so a wrong local clock can't
 * make the warning come early, late, or never.
 */
export function sessionTimes(session: SessionInfo): SessionTimes | null {
  if (!session.authenticated) return null;
  const serverNow = Date.parse(session.serverTime);
  const untilExpiry = Math.max(0, Date.parse(session.idleExpiresAt) - serverNow);
  return { untilExpiry, untilWarning: Math.max(0, untilExpiry - WARNING_LEAD_MS) };
}

/** "1:05" style countdown text. */
export function formatCountdown(ms: number) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export type SessionChange =
  | { kind: 'signedIn'; session: Extract<SessionInfo, { authenticated: true }> }
  | { kind: 'refreshed'; session: Extract<SessionInfo, { authenticated: true }> }
  | { kind: 'signedOut'; reason: 'logout' | 'expired' }
  | { kind: 'unchanged' };

/**
 * Classify a new session snapshot against the previous one. A session that
 * disappears without the player checking out is treated as expired.
 */
export function classifyChange(
  prev: SessionInfo | null,
  next: SessionInfo,
  checkedOutOnPurpose: boolean,
): SessionChange {
  const wasIn = prev?.authenticated === true;
  if (next.authenticated) {
    return wasIn && prev.user.id === next.user.id
      ? { kind: 'refreshed', session: next }
      : { kind: 'signedIn', session: next };
  }
  if (wasIn) return { kind: 'signedOut', reason: checkedOutOnPurpose ? 'logout' : 'expired' };
  return { kind: 'unchanged' };
}
