import type { SessionInfo } from '@dddbanker/shared';
import { h } from './dialogs';

/**
 * Always-visible overlay: where you are, whether you're checked in, and
 * buttons for help and the menu. Real HTML so it's keyboard and screen-reader friendly.
 */
export class Hud {
  readonly root: HTMLElement;
  private readonly location: HTMLElement;
  private readonly status: HTMLElement;
  private readonly announcer: HTMLElement;
  private readonly hint: HTMLElement;

  private readonly bell: HTMLButtonElement;
  private readonly badge: HTMLElement;

  constructor(handlers: { onMenu: () => void; onHelp: () => void; onBell: () => void }) {
    this.badge = h('span', { class: 'hud-button__badge', 'aria-hidden': 'true', hidden: true });
    this.bell = h(
      'button',
      {
        type: 'button',
        class: 'hud-button',
        hidden: true,
        onclick: handlers.onBell,
        'aria-label': 'Notices',
      },
      '🔔',
      this.badge,
    );
    this.location = h('span', { class: 'hud-chip__value' });
    this.status = h('span', { class: 'hud-chip__value' }, 'Checking…');
    this.announcer = h('div', { class: 'visually-hidden', 'aria-live': 'polite', role: 'status' });
    const touchOnly = window.matchMedia('(pointer: coarse) and (not (any-pointer: fine))').matches;
    this.hint = touchOnly
      ? h(
          'p',
          { class: 'hud-hint' },
          'Tap the ground to walk there · drag to look around · ☰ for the menu',
        )
      : h(
          'p',
          { class: 'hud-hint' },
          h('kbd', {}, 'W A S D'),
          ' or ',
          h('kbd', {}, 'arrows'),
          ' to walk · click the ground to walk there · drag to look · ',
          h('kbd', {}, 'Esc'),
          ' for the menu',
        );

    this.root = h(
      'div',
      { class: 'hud' },
      h(
        'div',
        { class: 'hud-top' },
        h(
          'div',
          { class: 'hud-chips' },
          h(
            'div',
            { class: 'hud-chip' },
            h('span', { class: 'hud-chip__label' }, 'Location'),
            this.location,
          ),
          h(
            'div',
            { class: 'hud-chip' },
            h('span', { class: 'hud-chip__label' }, 'Customer'),
            this.status,
          ),
        ),
        h(
          'div',
          { class: 'hud-buttons' },
          this.bell,
          h(
            'button',
            {
              type: 'button',
              class: 'hud-button',
              onclick: handlers.onHelp,
              'aria-label': 'Controls help',
            },
            '?',
          ),
          h(
            'button',
            {
              type: 'button',
              class: 'hud-button',
              onclick: handlers.onMenu,
              'aria-label': 'Open menu',
            },
            '☰',
          ),
        ),
      ),
      this.hint,
      this.toastEl,
      this.announcer,
    );
  }

  private readonly toastEl = h('p', { class: 'hud-toast', hidden: true });
  private toastTimer: ReturnType<typeof setTimeout> | undefined;

  /** A short message near the top of the screen, also read to screen readers. */
  toast(message: string, ms = 3500) {
    this.toastEl.textContent = message;
    this.toastEl.hidden = false;
    this.announce(message);
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => (this.toastEl.hidden = true), ms);
  }

  setLocation(name: string) {
    if (this.location.textContent === name) return;
    this.location.textContent = name;
    this.announce(`Location: ${name}`);
  }

  setSession(session: SessionInfo | null) {
    this.status.textContent = session?.authenticated ? session.user.name : 'Not checked in';
    // The bell shows for checked-in customers, with a count of unread notices.
    const unread = session?.authenticated ? session.unreadNotifications : 0;
    this.bell.hidden = !session?.authenticated;
    this.badge.hidden = unread === 0;
    this.badge.textContent = unread > 9 ? '9+' : String(unread);
    this.bell.setAttribute('aria-label', unread ? `Notices, ${unread} unread` : 'Notices');
  }

  /** Read a message to screen-reader users without moving focus. */
  announce(message: string) {
    this.announcer.textContent = '';
    // Re-setting on the next frame makes repeated messages announce again.
    requestAnimationFrame(() => (this.announcer.textContent = message));
  }

  /** Fade the controls hint once the player has started moving. */
  dismissHint() {
    this.hint.classList.add('hud-hint--hidden');
  }
}
