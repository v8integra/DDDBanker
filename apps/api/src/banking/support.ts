import type { NotificationView, TicketView } from '@dddbanker/shared';
import type { Db } from '../db';
import { AppError, notFound } from '../errors';
import type { SupportMessage, SupportTicket } from '../generated/prisma/client';
import { notify } from './common';

const AUTO_REPLY =
  "Thanks for writing in! I'm Bramble from the Help Desk. This is a demo bank, so there's no team reading tickets, but in a real bank someone would reply within a day. Meanwhile, the FAQ at the Help Desk might help.";

function toTicketView(t: SupportTicket & { messages: SupportMessage[] }): TicketView {
  return {
    id: t.id,
    subject: t.subject,
    status: t.status,
    updatedAt: t.updatedAt.toISOString(),
    messages: t.messages.map((m) => ({
      author: m.author as 'CUSTOMER' | 'STAFF',
      body: m.body,
      at: m.createdAt.toISOString(),
    })),
  };
}

const withMessages = { messages: { orderBy: { createdAt: 'asc' as const } } };

export async function listTickets(db: Db, userId: string) {
  const tickets = await db.supportTicket.findMany({
    where: { userId },
    include: withMessages,
    orderBy: { updatedAt: 'desc' },
  });
  return tickets.map(toTicketView);
}

export async function openTicket(
  db: Db,
  userId: string,
  input: { subject: string; message: string },
  at: Date,
) {
  const open = await db.supportTicket.count({ where: { userId, status: { not: 'CLOSED' } } });
  if (open >= 10)
    throw new AppError(
      422,
      'LIMIT_EXCEEDED',
      'You have 10 open tickets. Close one before opening another.',
    );
  const ticket = await db.supportTicket.create({
    data: {
      userId,
      subject: input.subject,
      status: 'ANSWERED',
      createdAt: at,
      updatedAt: at,
      messages: {
        create: [
          { author: 'CUSTOMER', body: input.message, createdAt: at },
          // A second later so ordering is stable.
          { author: 'STAFF', body: AUTO_REPLY, createdAt: new Date(at.getTime() + 1000) },
        ],
      },
    },
    include: withMessages,
  });
  await notify(db, userId, 'SUPPORT', `The Help Desk replied to "${input.subject}".`, at);
  return toTicketView(ticket);
}

export async function replyToTicket(
  db: Db,
  userId: string,
  ticketId: string,
  message: string,
  at: Date,
) {
  const ticket = await db.supportTicket.findFirst({ where: { id: ticketId, userId } });
  if (!ticket) throw notFound('That ticket');
  if (ticket.status === 'CLOSED')
    throw new AppError(422, 'VALIDATION', 'This ticket is closed. Open a new one instead.');
  const updated = await db.supportTicket.update({
    where: { id: ticket.id },
    data: {
      status: 'OPEN',
      updatedAt: at,
      messages: { create: { author: 'CUSTOMER', body: message, createdAt: at } },
    },
    include: withMessages,
  });
  return toTicketView(updated);
}

export async function closeTicket(db: Db, userId: string, ticketId: string, at: Date) {
  const { count } = await db.supportTicket.updateMany({
    where: { id: ticketId, userId },
    data: { status: 'CLOSED', updatedAt: at },
  });
  if (count === 0) throw notFound('That ticket');
}

// ---------- Notifications ----------

export async function listNotifications(db: Db, userId: string): Promise<NotificationView[]> {
  const rows = await db.notification.findMany({
    where: { userId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: 50,
  });
  return rows.map((n) => ({
    id: n.id,
    type: n.type,
    message: n.message,
    createdAt: n.createdAt.toISOString(),
    read: n.readAt !== null,
  }));
}

export async function markNotificationsRead(db: Db, userId: string, at: Date, id?: string) {
  const { count } = await db.notification.updateMany({
    where: { userId, readAt: null, ...(id ? { id } : {}) },
    data: { readAt: at },
  });
  if (id && count === 0) {
    const exists = await db.notification.count({ where: { id, userId } });
    if (!exists) throw notFound('That notification');
  }
}

export function unreadCount(db: Db, userId: string) {
  return db.notification.count({ where: { userId, readAt: null } });
}
