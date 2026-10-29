import { changePasswordSchema, PASSWORD_MIN_LENGTH } from '@dddbanker/shared';
import { h } from '../../ui/dialogs';
import { errorsFromZod } from '../../ui/windows/formErrors';
import type { StationDef } from '../stations';
import { attempt, emptyErrors, formatDateTime, speakerOf, type BankContext } from './kit';

const ACTIVITY_LABEL = {
  LOGIN: 'Checked in',
  LOGIN_FAILED: '⚠ Failed check-in',
  LOGIN_LOCKED: '⚠ Locked out',
  LOGOUT: 'Checked out',
} as const;

/** Thorne at the Security Center. */
export async function securityDesk(def: StationDef, ctx: BankContext) {
  const staff = speakerOf(def);
  let greeting = def.greeting;
  for (;;) {
    const choice = await ctx.ui.dialogue<
      'password' | 'twofactor' | 'sessions' | 'activity' | 'bye'
    >({
      ...staff,
      lines: [greeting],
      choices: [
        { value: 'password', label: 'Change my password' },
        { value: 'twofactor', label: 'Two-step verification' },
        { value: 'sessions', label: 'Devices signed in' },
        { value: 'activity', label: 'Recent check-ins' },
        { value: 'bye', label: "I'm all set" },
      ],
    });
    if (!choice || choice === 'bye') return;
    greeting = 'Anything else to lock down?';
    if (choice === 'password') await changePasswordFlow(ctx);
    if (choice === 'twofactor') await twoFactorFlow(ctx);
    if (choice === 'sessions') await sessionsFlow(ctx);
    if (choice === 'activity') await activityFlow(ctx);
  }
}

async function changePasswordFlow(ctx: BankContext) {
  const done = await ctx.ui.form({
    title: 'Change Password',
    fields: [
      {
        name: 'currentPassword',
        label: 'Current password',
        type: 'password',
        autocomplete: 'current-password',
      },
      {
        name: 'newPassword',
        label: 'New password',
        type: 'password',
        autocomplete: 'new-password',
        hint: `At least ${PASSWORD_MIN_LENGTH} characters, with a mix of different ones.`,
      },
      {
        name: 'confirm',
        label: 'Type the new password again',
        type: 'password',
        autocomplete: 'new-password',
      },
    ],
    footnote: 'Other devices will be signed out. This one stays checked in.',
    submitLabel: 'Change password',
    validate: (values) => {
      const parsed = changePasswordSchema.safeParse(values);
      const errors = parsed.success ? emptyErrors() : errorsFromZod(parsed.error);
      if (!errors.fields.newPassword && values.newPassword !== values.confirm)
        errors.fields.confirm = 'The two passwords do not match';
      return errors;
    },
    submit: async (values) => {
      await ctx.api.changePassword(values.currentPassword!, values.newPassword!);
      return true;
    },
  });
  if (done) {
    await ctx.ui.result({
      title: 'Password Changed',
      tone: 'success',
      lines: ['Your new password is set, and any other devices were signed out.'],
    });
    void ctx.watcher.refresh();
  }
}

async function twoFactorFlow(ctx: BankContext) {
  const status = await attempt(ctx, () => ctx.api.twoFactorStatus());
  if (!status) return;

  if (status.enabled) {
    const off = await ctx.ui.options<'off' | 'keep'>({
      title: 'Two-Step Verification',
      text: ['✓ On. Each check-in asks for a code from your authenticator app.'],
      choices: [
        { value: 'keep', label: 'Keep it on' },
        { value: 'off', label: 'Turn it off' },
      ],
    });
    if (off !== 'off') return;
    const done = await codeForm(
      ctx,
      'Turn Off Two-Step',
      'Enter a current code to confirm it is really you.',
      'Turn it off',
      (code) => ctx.api.disableTwoFactor(code),
    );
    if (done)
      await ctx.ui.result({
        title: 'Turned Off',
        tone: 'info',
        lines: ['Two-step verification is off. You can turn it back on here anytime.'],
      });
    return;
  }

  const start = await ctx.ui.confirm({
    title: 'Two-Step Verification',
    text: [
      'Off. Turning it on means checking in needs your password and a 6-digit code from an authenticator app on your phone.',
      "You'll need an app like Google Authenticator, Microsoft Authenticator, or 1Password.",
    ],
    confirmLabel: 'Set it up',
    cancelLabel: 'Not now',
  });
  if (!start) return;
  const setup = await attempt(ctx, () => ctx.api.startTwoFactor());
  if (!setup) return;

  const grouped = setup.secret.match(/.{1,4}/g)?.join(' ') ?? setup.secret;
  await ctx.ui.result({
    title: 'Add the Bank to Your App',
    tone: 'info',
    lines: [
      'In your authenticator app, choose "Enter a setup key" and type this key. Name it Bank of Bramblewood, and pick "time-based" if asked.',
    ],
    extra: h(
      'code',
      { class: 'secret-code', 'aria-label': `Setup key: ${setup.secret.split('').join(' ')}` },
      grouped,
    ),
  });
  const done = await codeForm(
    ctx,
    'Confirm Two-Step',
    'Enter the 6-digit code your app shows now.',
    'Turn it on',
    (code) => ctx.api.confirmTwoFactor(code),
  );
  if (done) {
    await ctx.ui.result({
      title: 'Two-Step Is On',
      tone: 'success',
      lines: ['From now on, checking in will ask for a code from your app.'],
    });
    void ctx.watcher.refresh();
  }
}

function codeForm(
  ctx: BankContext,
  title: string,
  intro: string,
  submitLabel: string,
  send: (code: string) => Promise<void>,
) {
  return ctx.ui.form({
    title,
    intro: [intro],
    fields: [{ name: 'code', label: '6-digit code', type: 'code', autocomplete: 'one-time-code' }],
    submitLabel,
    validate: (values) => {
      const errors = emptyErrors();
      if (!/^\d{6}$/.test((values.code ?? '').trim()))
        errors.fields.code = 'Enter the 6-digit code';
      return errors;
    },
    submit: async (values) => {
      await send(values.code!.trim());
      return true;
    },
  });
}

async function sessionsFlow(ctx: BankContext) {
  for (;;) {
    const sessions = await attempt(ctx, () => ctx.api.getSessions());
    if (!sessions) return;
    const others = sessions.filter((s) => !s.current);
    const pick = await ctx.ui.table<'revoke' | 'done'>({
      title: 'Devices Signed In',
      caption: 'Devices signed in to your account',
      columns: [{ label: 'Device' }, { label: 'Last active' }, { label: 'Address' }],
      rows: sessions.map((s) => [
        s.current ? `${s.device} (this one)` : s.device,
        formatDateTime(s.lastSeenAt),
        s.ip ?? 'Unknown',
      ]),
      choices: [
        ...(others.length ? [{ value: 'revoke' as const, label: 'Sign out another device' }] : []),
        { value: 'done', label: 'Done' },
      ],
    });
    if (pick !== 'revoke') return;
    const id = await ctx.ui.options({
      title: 'Sign Out Which?',
      choices: others.map((s) => ({
        value: s.id,
        label: s.device,
        hint: `Last active ${formatDateTime(s.lastSeenAt)}`,
      })),
    });
    if (!id) continue;
    if (
      await ctx.ui.confirm({
        title: 'Sign Out Device',
        text: ['That device will need to check in again.'],
        confirmLabel: 'Yes, sign it out',
        danger: true,
      })
    ) {
      await attempt(ctx, () => ctx.api.revokeSession(id));
    }
  }
}

async function activityFlow(ctx: BankContext) {
  const activity = await attempt(ctx, () => ctx.api.getActivity());
  if (!activity) return;
  await ctx.ui.table({
    title: 'Recent Check-Ins',
    caption: 'Recent check-in activity',
    columns: [{ label: 'When' }, { label: 'What' }, { label: 'Address' }],
    rows: activity.map((a) => [formatDateTime(a.at), ACTIVITY_LABEL[a.action], a.ip ?? 'Unknown']),
    empty: 'No activity yet.',
    note: "Don't recognize something? Change your password and sign out other devices.",
  });
}
