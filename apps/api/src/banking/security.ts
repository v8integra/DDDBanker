import { BANK, type LoginActivity, type SessionView, type TwoFactorSetup } from '@dddbanker/shared';
import { audit } from '../audit';
import { hashPassword, verifyPassword } from '../auth/passwords';
import { generateTotpSecret, totpUri, verifyTotp } from '../auth/totp';
import type { Db } from '../db';
import { AppError, notFound } from '../errors';
import { notify } from './common';

const WRONG_PASSWORD = () =>
  new AppError(400, 'VALIDATION', 'Your current password is not right.', {
    currentPassword: 'That is not your current password',
  });

/** Change password; every other device is signed out. */
export async function changePassword(
  db: Db,
  user: { id: string },
  sessionId: string,
  input: { currentPassword: string; newPassword: string },
  at: Date,
) {
  const row = await db.user.findUniqueOrThrow({ where: { id: user.id } });
  if (!(await verifyPassword(row.passwordHash, input.currentPassword))) throw WRONG_PASSWORD();
  if (input.currentPassword === input.newPassword) {
    throw new AppError(400, 'VALIDATION', 'Choose a password you have not used here.', {
      newPassword: 'Pick a different password',
    });
  }
  const passwordHash = await hashPassword(input.newPassword);
  await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: user.id }, data: { passwordHash } });
    await tx.session.deleteMany({ where: { userId: user.id, id: { not: sessionId } } });
    await audit(tx, { userId: user.id, action: 'PASSWORD_CHANGED', at });
    await notify(
      tx,
      user.id,
      'SECURITY',
      'Your password was changed. Other devices were signed out.',
      at,
    );
  });
}

/** Turn a browser user-agent into something a person recognizes. */
export function describeDevice(userAgent: string | null) {
  if (!userAgent) return 'Unknown device';
  const browser = /Edg\//.test(userAgent)
    ? 'Edge'
    : /Firefox\//.test(userAgent)
      ? 'Firefox'
      : /Chrome\//.test(userAgent)
        ? 'Chrome'
        : /Safari\//.test(userAgent)
          ? 'Safari'
          : 'A browser';
  const os = /Windows/.test(userAgent)
    ? 'Windows'
    : /iPhone|iPad/.test(userAgent)
      ? 'iOS'
      : /Android/.test(userAgent)
        ? 'Android'
        : /Mac OS X/.test(userAgent)
          ? 'macOS'
          : /Linux/.test(userAgent)
            ? 'Linux'
            : null;
  return os ? `${browser} on ${os}` : browser;
}

export async function listSessions(
  db: Db,
  userId: string,
  currentId: string,
  now: Date,
): Promise<SessionView[]> {
  const sessions = await db.session.findMany({
    where: { userId, expiresAt: { gt: now } },
    orderBy: { lastSeenAt: 'desc' },
  });
  return sessions.map((s) => ({
    id: s.id,
    current: s.id === currentId,
    device: describeDevice(s.userAgent),
    ip: s.ip,
    createdAt: s.createdAt.toISOString(),
    lastSeenAt: s.lastSeenAt.toISOString(),
  }));
}

export async function revokeSession(
  db: Db,
  userId: string,
  currentId: string,
  sessionId: string,
  at: Date,
) {
  if (sessionId === currentId) {
    throw new AppError(422, 'VALIDATION', 'That is this device. Use Check Out to sign out here.');
  }
  const { count } = await db.session.deleteMany({ where: { id: sessionId, userId } });
  if (count === 0) throw notFound('That session');
  await audit(db, { userId, action: 'SESSION_REVOKED', metadata: { sessionId }, at });
}

export async function loginActivity(db: Db, userId: string): Promise<LoginActivity[]> {
  const rows = await db.auditLog.findMany({
    where: { userId, action: { in: ['LOGIN', 'LOGIN_FAILED', 'LOGIN_LOCKED', 'LOGOUT'] } },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });
  return rows.map((r) => ({
    at: r.createdAt.toISOString(),
    action: r.action as LoginActivity['action'],
    ip: r.ip,
  }));
}

// ---------- Two-step verification ----------

export async function startTwoFactorSetup(
  db: Db,
  user: { id: string; email: string },
): Promise<TwoFactorSetup> {
  const row = await db.user.findUniqueOrThrow({ where: { id: user.id } });
  if (row.totpSecret) throw new AppError(422, 'VALIDATION', 'Two-step verification is already on.');
  const secret = generateTotpSecret();
  await db.user.update({ where: { id: user.id }, data: { totpPendingSecret: secret } });
  return { secret, uri: totpUri(secret, user.email, BANK.name) };
}

const BAD_CODE = () =>
  new AppError(
    400,
    'TWO_FACTOR_INVALID',
    "That code didn't match. Codes change every 30 seconds, so try the current one.",
    {
      code: "That code didn't match",
    },
  );

export async function confirmTwoFactor(db: Db, userId: string, code: string, at: Date) {
  const row = await db.user.findUniqueOrThrow({ where: { id: userId } });
  if (!row.totpPendingSecret) throw new AppError(422, 'VALIDATION', 'Start setup first.');
  if (!verifyTotp(row.totpPendingSecret, code, at)) throw BAD_CODE();
  await db.user.update({
    where: { id: userId },
    data: { totpSecret: row.totpPendingSecret, totpPendingSecret: null },
  });
  await audit(db, { userId, action: 'TWO_FACTOR_ENABLED', at });
  await notify(
    db,
    userId,
    'SECURITY',
    'Two-step verification is now on. You will need a code each time you check in.',
    at,
  );
}

export async function disableTwoFactor(db: Db, userId: string, code: string, at: Date) {
  const row = await db.user.findUniqueOrThrow({ where: { id: userId } });
  if (!row.totpSecret)
    throw new AppError(422, 'VALIDATION', 'Two-step verification is already off.');
  if (!verifyTotp(row.totpSecret, code, at)) throw BAD_CODE();
  await db.user.update({
    where: { id: userId },
    data: { totpSecret: null, totpPendingSecret: null },
  });
  await audit(db, { userId, action: 'TWO_FACTOR_DISABLED', at });
  await notify(db, userId, 'SECURITY', 'Two-step verification was turned off.', at);
}

export async function twoFactorEnabled(db: Db, userId: string) {
  const row = await db.user.findUniqueOrThrow({
    where: { id: userId },
    select: { totpSecret: true },
  });
  return row.totpSecret !== null;
}
