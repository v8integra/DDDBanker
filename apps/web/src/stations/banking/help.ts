import { newTicketSchema } from '@dddbanker/shared';
import { errorsFromZod } from '../../ui/windows/formErrors';
import type { StationDef } from '../stations';
import {
  attempt,
  emptyErrors,
  formatDate,
  formatDateTime,
  speakerOf,
  type BankContext,
} from './kit';

const FAQ: { q: string; a: string[] }[] = [
  {
    q: 'Is any of this real money?',
    a: [
      "Nope! Every balance is play money in a demo bank. Please don't enter real personal or financial details anywhere here.",
    ],
  },
  {
    q: 'How do I get to the banking hall?',
    a: [
      'Check in with Pip at the front desk in the lobby. The security gate opens as soon as you are checked in.',
    ],
  },
  {
    q: 'Why was I checked out?',
    a: [
      'For your security, you are checked out after 15 minutes without banking, or 12 hours in total. You will get a warning two minutes before, with a button to stay.',
    ],
  },
  {
    q: 'What are the limits?',
    a: [
      'Deposits: up to $10,000.00 at a time. ATM cash: $500.00 a day, in $20s. Sending money to people: $2,500.00 a day. Card purchases: $1,000.00 a day per card.',
    ],
  },
  {
    q: 'I lost my card!',
    a: [
      'Visit Basil at Card Services and choose "Report lost or stolen". The old card stops working right away and you get a new number.',
    ],
  },
  {
    q: 'How do I make my account more secure?',
    a: [
      'Thorne at the Security Center can turn on two-step verification, change your password, and sign out devices you do not recognize.',
    ],
  },
];

/** Bramble at the Help Desk. */
export async function helpDesk(def: StationDef, ctx: BankContext) {
  const staff = speakerOf(def);
  let greeting = def.greeting;
  for (;;) {
    const choice = await ctx.ui.dialogue<'faq' | 'contact' | 'tickets' | 'controls' | 'bye'>({
      ...staff,
      lines: [greeting],
      choices: [
        { value: 'faq', label: 'Common questions' },
        { value: 'contact', label: 'Contact support' },
        { value: 'tickets', label: 'My support tickets' },
        { value: 'controls', label: 'How do the controls work?' },
        { value: 'bye', label: 'Thanks, Bramble!' },
      ],
    });
    if (!choice || choice === 'bye') return;
    greeting = 'What else can I help with?';
    if (choice === 'faq') await faqFlow(ctx, staff);
    if (choice === 'contact') await contactFlow(ctx);
    if (choice === 'tickets') await ticketsFlow(ctx);
    if (choice === 'controls') ctx.openControls();
    if (choice === 'controls') return; // the Controls window takes over
  }
}

async function faqFlow(ctx: BankContext, staff: { speaker: string; role?: string }) {
  for (;;) {
    const index = await ctx.ui.options({
      title: 'Common Questions',
      choices: FAQ.map((f, i) => ({ value: String(i), label: f.q })),
    });
    if (index === null) return;
    const item = FAQ[Number(index)]!;
    await ctx.ui.dialogue({ ...staff, lines: item.a });
  }
}

async function contactFlow(ctx: BankContext) {
  const ticket = await ctx.ui.form({
    title: 'Contact Support',
    fields: [
      { name: 'subject', label: 'Subject', type: 'text', maxLength: 80 },
      { name: 'message', label: 'Your message', type: 'textarea', maxLength: 2000 },
    ],
    submitLabel: 'Send',
    validate: (values) => {
      const parsed = newTicketSchema.safeParse(values);
      return parsed.success ? emptyErrors() : errorsFromZod(parsed.error);
    },
    submit: (values) => ctx.api.openTicket(values.subject!, values.message!),
  });
  if (!ticket) return;
  await ctx.ui.result({
    title: 'Message Sent',
    tone: 'success',
    lines: ['Thanks! You can read the reply under "My support tickets".'],
  });
  void ctx.watcher.refresh();
}

async function ticketsFlow(ctx: BankContext) {
  for (;;) {
    const tickets = await attempt(ctx, () => ctx.api.getTickets());
    if (!tickets) return;
    const pick = await ctx.ui.table<'read' | 'done'>({
      title: 'Support Tickets',
      caption: 'Your support tickets',
      columns: [{ label: 'Subject' }, { label: 'Status' }, { label: 'Updated' }],
      rows: tickets.map((t) => [
        t.subject,
        t.status === 'ANSWERED' ? 'Replied' : t.status === 'OPEN' ? 'Waiting' : 'Closed',
        formatDate(t.updatedAt),
      ]),
      empty: 'No tickets yet.',
      choices: [
        ...(tickets.length ? [{ value: 'read' as const, label: 'Read a ticket' }] : []),
        { value: 'done', label: 'Done' },
      ],
    });
    if (pick !== 'read') return;
    const id = await ctx.ui.options({
      title: 'Which Ticket?',
      choices: tickets.map((t) => ({ value: t.id, label: t.subject })),
    });
    const ticket = tickets.find((t) => t.id === id);
    if (!ticket) continue;

    const next = await ctx.ui.table<'reply' | 'close' | 'back'>({
      title: ticket.subject,
      caption: `Messages in "${ticket.subject}"`,
      columns: [{ label: 'From' }, { label: 'When' }, { label: 'Message' }],
      rows: ticket.messages.map((m) => [
        m.author === 'STAFF' ? 'Help Desk' : 'You',
        formatDateTime(m.at),
        m.body,
      ]),
      choices:
        ticket.status === 'CLOSED'
          ? [{ value: 'back', label: 'Back' }]
          : [
              { value: 'reply', label: 'Reply' },
              { value: 'close', label: 'Close this ticket' },
              { value: 'back', label: 'Back' },
            ],
    });
    if (next === 'reply') {
      await ctx.ui.form({
        title: 'Reply',
        fields: [{ name: 'message', label: 'Your reply', type: 'textarea', maxLength: 2000 }],
        submitLabel: 'Send',
        validate: (values) => {
          const errors = emptyErrors();
          if (!values.message?.trim()) errors.fields.message = 'Write a reply';
          return errors;
        },
        submit: (values) => ctx.api.replyToTicket(ticket.id, values.message!.trim()),
      });
    } else if (next === 'close') {
      await attempt(ctx, () => ctx.api.closeTicket(ticket.id));
    }
  }
}

/** The notifications window, from the Notices kiosk or the HUD bell. */
export async function notificationsWindow(ctx: BankContext) {
  if (!ctx.watcher.signedIn) {
    await ctx.ui.result({
      title: 'Notices',
      tone: 'info',
      lines: ['Check in to see your notices.'],
    });
    return;
  }
  const notes = await attempt(ctx, () => ctx.api.getNotifications());
  if (!notes) return;
  await ctx.ui.table({
    title: 'Notices',
    caption: 'Your notices, newest first',
    columns: [{ label: 'When' }, { label: 'Notice' }],
    rows: notes.map((n) => [
      `${n.read ? '' : '● New · '}${formatDateTime(n.createdAt)}`,
      n.message,
    ]),
    empty: 'No notices yet. Activity like deposits and payments shows up here.',
  });
  if (notes.some((n) => !n.read)) {
    await attempt(ctx, () => ctx.api.markAllRead());
    void ctx.watcher.refresh();
  }
}
