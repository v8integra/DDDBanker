import { dollarInputSchema, formatCents, type AccountSummary } from '@dddbanker/shared';
import { ApiRequestError, type ApiClient } from '../../api/client';
import type { SessionWatcher } from '../../auth/sessionWatcher';
import type { FormErrors } from '../../ui/windows/formErrors';
import type { Choice, Windows } from '../../ui/windows/windows';
import type { StationDef } from '../stations';

export interface BankContext {
  watcher: SessionWatcher;
  api: ApiClient;
  ui: Windows;
  /** Open the Controls help window. */
  openControls(): void;
}

export const TYPE_LABEL: Record<string, string> = {
  CHECKING: 'Checking',
  SAVINGS: 'Savings',
  CD: 'CD',
  CREDIT_CARD: 'Credit card',
  AUTO_LOAN: 'Auto loan',
  MORTGAGE: 'Mortgage',
  PERSONAL_LOAN: 'Personal loan',
};

export const isDepositAccount = (a: AccountSummary) =>
  (a.type === 'CHECKING' || a.type === 'SAVINGS') && a.status === 'OPEN';

export function speakerOf(def: StationDef) {
  return { speaker: def.staff?.name ?? def.title, ...(def.staff ? { role: def.staff.role } : {}) };
}

export function accountLabel(a: AccountSummary) {
  return `${a.nickname} ${a.maskedNumber} · ${formatCents(a.balanceCents)}`;
}

export function accountOptions(accounts: AccountSummary[]) {
  return accounts.map((a) => ({ value: a.id, label: accountLabel(a) }));
}

export function accountChoices(accounts: AccountSummary[]): Choice<string>[] {
  return accounts.map((a) => ({
    value: a.id,
    label: `${a.nickname} ${a.maskedNumber}`,
    hint: `${TYPE_LABEL[a.type] ?? a.type} · ${formatCents(a.balanceCents)}`,
  }));
}

/** Parse a dollars field into cents, or add a field error. */
export function readAmount(
  values: Record<string, string>,
  field: string,
  errors: FormErrors,
): number | null {
  const parsed = dollarInputSchema.safeParse(values[field] ?? '');
  if (parsed.success) return parsed.data;
  errors.fields[field] = parsed.error.issues[0]?.message ?? 'Enter an amount';
  return null;
}

export const emptyErrors = (): FormErrors => ({ fields: {}, form: null });

/**
 * Run a station action and turn API failures into a friendly window. A
 * signed-out error also nudges the session watcher so the gate reacts.
 */
export async function attempt<T>(ctx: BankContext, action: () => Promise<T>): Promise<T | null> {
  try {
    return await action();
  } catch (err) {
    if (err instanceof ApiRequestError && err.status === 401) {
      void ctx.watcher.refresh();
      await ctx.ui.result({
        title: 'Checked Out',
        tone: 'error',
        lines: ['Your session has ended. Please check in again at the front desk.'],
      });
      return null;
    }
    const message =
      err instanceof ApiRequestError
        ? err.message
        : "We couldn't reach the bank. Check your connection and try again.";
    await ctx.ui.result({ title: 'Something Went Wrong', tone: 'error', lines: [message] });
    return null;
  }
}

export async function loadAccounts(ctx: BankContext) {
  return attempt(ctx, () => ctx.api.getAccounts());
}

const dateFormat = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
});
const dateTimeFormat = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

/** "Jan 15, 2026". Bank dates are UTC days. */
export const formatDate = (iso: string) => dateFormat.format(new Date(iso));
/** "Jan 15, 3:04 PM" in the viewer's time zone. */
export const formatDateTime = (iso: string) => dateTimeFormat.format(new Date(iso));

/** "YYYY-MM" for this month and the five before it, newest first, from the server's clock. */
export function recentMonths(serverTime: string, count = 6) {
  const now = new Date(serverTime);
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const value = d.toISOString().slice(0, 7);
    const label = new Intl.DateTimeFormat('en-US', {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(d);
    return { value, label };
  });
}

/** Tomorrow as YYYY-MM-DD on the server's clock (the default first date for schedules). */
export function tomorrow(serverTime: string) {
  const d = new Date(serverTime);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export function serverNow(ctx: BankContext) {
  const s = ctx.watcher.session;
  return s?.authenticated ? s.serverTime : new Date().toISOString();
}
