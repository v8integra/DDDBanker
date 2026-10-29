import type { SessionInfo } from '@dddbanker/shared';
import type { ApiClient } from '../api/client';
import { classifyChange, sessionTimes, type SessionChange } from './sessionTiming';

const POLL_MS = 30_000;

/**
 * Keeps the client's idea of "am I checked in?" in step with the server.
 * The gate, HUD, and timeout warning all listen here. Polling uses
 * GET /auth/session, which does not extend the idle timeout.
 */
export class SessionWatcher {
  private current: SessionInfo | null = null;
  private readonly listeners = new Set<(change: SessionChange, session: SessionInfo) => void>();
  private pollTimer: ReturnType<typeof setInterval> | undefined;
  private expiryTimer: ReturnType<typeof setTimeout> | undefined;
  private checkingOut = false;

  constructor(private readonly api: ApiClient) {}

  get session() {
    return this.current;
  }

  get signedIn() {
    return this.current?.authenticated === true;
  }

  start() {
    void this.refresh();
    this.pollTimer = setInterval(() => void this.refresh(), POLL_MS);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) void this.refresh();
    });
  }

  subscribe(listener: (change: SessionChange, session: SessionInfo) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async refresh() {
    try {
      this.apply(await this.api.getSession());
    } catch {
      // Offline or server down: keep the last known state rather than slamming the gate.
    }
  }

  /** Feed in a session returned by login/refresh calls. */
  apply(next: SessionInfo) {
    const change = classifyChange(this.current, next, this.checkingOut);
    this.current = next;
    this.checkingOut = false;
    this.scheduleExpiryCheck();
    if (change.kind !== 'unchanged') for (const listener of this.listeners) listener(change, next);
  }

  async extend() {
    this.apply(await this.api.refreshSession());
  }

  async checkOut() {
    this.checkingOut = true;
    try {
      this.apply(await this.api.logout());
    } catch {
      this.checkingOut = false;
      await this.refresh();
    }
  }

  /** Ask the server again right after the idle timeout should have hit. */
  private scheduleExpiryCheck() {
    clearTimeout(this.expiryTimer);
    const times = this.current && sessionTimes(this.current);
    if (times) this.expiryTimer = setTimeout(() => void this.refresh(), times.untilExpiry + 1000);
  }

  dispose() {
    clearInterval(this.pollTimer);
    clearTimeout(this.expiryTimer);
  }
}
