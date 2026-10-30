import { attempt, formatDate, serverNow, type BankContext } from './kit';

/**
 * Dev tool (only with ?debug, and only when the server allows it): move the
 * bank's clock forward so interest, bills, statements and premiums happen
 * now instead of next month. Sessions keep real time, so you stay checked in.
 */
export async function timeMachine(ctx: BankContext) {
  if (!ctx.watcher.signedIn) {
    await ctx.ui.result({
      title: 'Time Machine',
      tone: 'info',
      lines: ['Check in first: the time machine runs your accounts forward.'],
    });
    return;
  }
  for (;;) {
    const pick = await ctx.ui.options<'1d' | '7d' | '1m' | '3m' | 'reset' | 'done'>({
      title: 'Time Machine (dev)',
      text: [
        `Bank date: ${formatDate(serverNow(ctx))}. Jumping ahead runs every day in between: interest, bills, statements, premiums, schedules.`,
      ],
      choices: [
        { value: '1d', label: '+1 day' },
        { value: '7d', label: '+1 week' },
        { value: '1m', label: '+1 month' },
        { value: '3m', label: '+3 months' },
        {
          value: 'reset',
          label: 'Reset my demo data',
          hint: 'Back to day one: fresh checking, savings, and $1,000',
        },
        { value: 'done', label: 'Done' },
      ],
    });
    if (!pick || pick === 'done') return;
    if (pick === 'reset') {
      const sure = await ctx.ui.confirm({
        title: 'Reset Demo Data',
        text: [
          'Delete all your accounts, loans, cards, policies and history, and start over with the welcome bonus? Your login stays the same.',
        ],
        confirmLabel: 'Yes, reset everything',
        danger: true,
      });
      if (sure && (await attempt(ctx, () => ctx.api.resetMyData())) !== null) {
        await ctx.ui.result({
          title: 'Fresh Start',
          tone: 'success',
          lines: ['Your demo data is back to day one.'],
        });
      }
      void ctx.watcher.refresh();
      continue;
    }
    const body = { '1d': { days: 1 }, '7d': { days: 7 }, '1m': { months: 1 }, '3m': { months: 3 } }[
      pick
    ];
    const clock = await attempt(ctx, () => ctx.api.advanceClock(body));
    await ctx.watcher.refresh();
    if (clock)
      await ctx.ui.result({
        title: 'Whoosh!',
        tone: 'success',
        lines: [
          `It's now ${formatDate(clock.bankTime)} at the bank. Check the bell for what happened.`,
        ],
      });
  }
}
