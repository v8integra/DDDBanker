import { BANK } from '@dddbanker/shared';
import type { SessionWatcher } from '../auth/sessionWatcher';
import type { DialogueOptions } from '../ui/dialogue';
import type { StationDef } from './stations';

export interface StationContext {
  watcher: SessionWatcher;
  say<T extends string = 'ok'>(options: DialogueOptions<T>): Promise<T | null>;
}

const soon = 'This window opens in an upcoming update of the bank.';

/**
 * What happens when you talk to each station. Phase 4 swaps the check-in and
 * new-accounts placeholders for real login and signup windows; Phase 5+
 * gives every other station its menu.
 */
export async function runStation(def: StationDef, ctx: StationContext) {
  const speaker = def.staff?.name ?? def.title;
  const role = def.staff?.role;
  const session = ctx.watcher.session;
  const name = session?.authenticated ? session.user.name : null;
  const base = { speaker, ...(role ? { role } : {}) };

  switch (def.id) {
    case 'checkin':
      await ctx.say({
        ...base,
        lines: name
          ? [`Welcome back, ${name}! You're checked in, so the security gate is open for you.`]
          : [def.greeting, `The check-in window is being set up. ${soon}`, BANK.disclaimer],
      });
      return;

    case 'newAccounts':
      await ctx.say({
        ...base,
        lines: name
          ? [`You already bank with us, ${name}. Head through the gate to the hall!`]
          : [def.greeting, `Sign-up forms are on their way. ${soon}`, BANK.disclaimer],
      });
      return;

    case 'exit': {
      if (!name) {
        await ctx.say({
          ...base,
          lines: ["You're not checked in right now. The front door is back through the lobby."],
        });
        return;
      }
      const choice = await ctx.say<'out' | 'stay'>({
        ...base,
        lines: [`${def.greeting} I can check you out, ${name}.`],
        choices: [
          { value: 'out', label: 'Yes, check me out' },
          { value: 'stay', label: 'Not yet' },
        ],
      });
      if (choice !== 'out') return;
      await ctx.watcher.checkOut();
      await ctx.say({
        ...base,
        lines: ["You're checked out. Have a lovely day, and see you soon!"],
      });
      return;
    }

    default:
      await ctx.say({
        ...base,
        lines: [def.greeting, `Here you'll be able to: ${def.services.join(' · ')}.`, soon],
      });
  }
}

export function infoBoardLines() {
  return [
    'Open 24/7. (It is a demo bank, after all!)',
    BANK.disclaimer,
    'Check in at the front desk to open the security gate. New here? Visit New Accounts.',
    'Walk with W A S D or the arrow keys, or click the floor. Press E near staff to talk. Esc opens the menu.',
  ];
}
