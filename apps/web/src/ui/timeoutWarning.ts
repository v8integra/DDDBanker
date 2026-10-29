import { formatCountdown, sessionTimes } from '../auth/sessionTiming';
import type { SessionWatcher } from '../auth/sessionWatcher';
import { h, retroDialog, type DialogStack } from './dialogs';

/**
 * "Still there?" warning before the idle timeout, with a way to stay
 * checked in (WCAG 2.2.1 Timing Adjustable).
 */
export class TimeoutWarning {
  private readonly dialog: HTMLDialogElement;
  private readonly countdown: HTMLElement;
  private warnTimer: ReturnType<typeof setTimeout> | undefined;
  private tick: ReturnType<typeof setInterval> | undefined;
  private deadline = 0;

  constructor(
    private readonly watcher: SessionWatcher,
    private readonly dialogs: DialogStack,
    mount: HTMLElement,
  ) {
    this.countdown = h('strong', {});
    this.dialog = retroDialog(
      'timeout-dialog',
      'Still there?',
      h(
        'p',
        {},
        'For your security, you will be checked out in ',
        this.countdown,
        ' unless you choose to stay.',
      ),
      h(
        'div',
        { class: 'retro-menu' },
        h(
          'button',
          {
            type: 'button',
            class: 'retro-option',
            autofocus: true,
            onclick: () => void this.stay(),
          },
          'Stay checked in',
        ),
        h(
          'button',
          { type: 'button', class: 'retro-option', onclick: () => void this.leave() },
          'Check out now',
        ),
      ),
    );
    this.dialog.addEventListener('close', () => clearInterval(this.tick));
    mount.append(this.dialog);

    watcher.subscribe((change, session) => {
      clearTimeout(this.warnTimer);
      if (change.kind === 'signedOut') {
        this.dialog.close();
        return;
      }
      const times = sessionTimes(session);
      if (!times) return;
      this.deadline = performance.now() + times.untilExpiry;
      if (times.untilWarning > 0) {
        this.dialog.close(); // time was extended
        this.warnTimer = setTimeout(() => this.show(), times.untilWarning);
      } else if (!this.dialog.open) {
        this.show();
      }
    });
  }

  private show() {
    this.render();
    clearInterval(this.tick);
    this.tick = setInterval(() => this.render(), 1000);
    this.dialogs.open(this.dialog);
  }

  private render() {
    const left = this.deadline - performance.now();
    this.countdown.textContent = formatCountdown(left);
    if (left <= 0) {
      this.dialog.close();
      void this.watcher.refresh(); // the server will say it's over; the gate reacts
    }
  }

  private async stay() {
    this.dialog.close();
    await this.watcher.extend().catch(() => this.watcher.refresh());
  }

  private async leave() {
    this.dialog.close();
    await this.watcher.checkOut();
  }
}
