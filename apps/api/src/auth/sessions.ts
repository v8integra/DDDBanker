import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { SessionInfo } from '@dddbanker/shared';
import { minutesFrom } from '../clock';
import type { AppDeps } from '../deps';

export interface AuthContext {
  sessionId: string;
  csrfToken: string;
  user: { id: string; email: string; name: string };
  lastSeenAt: Date;
  expiresAt: Date;
}

/** Skip the lastSeenAt write if the session was touched this recently. */
const TOUCH_THROTTLE_MS = 15_000;

const newToken = () => randomBytes(32).toString('base64url');
const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function createSession(
  deps: AppDeps,
  req: FastifyRequest,
  reply: FastifyReply,
  userId: string,
): Promise<AuthContext> {
  const { db, clock, config } = deps;
  // Rotation: whatever session the browser had before is gone.
  await destroySession(deps, req, reply);

  const token = newToken();
  const now = clock.now();
  const session = await db.session.create({
    data: {
      tokenHash: hashToken(token),
      csrfToken: newToken(),
      userId,
      createdAt: now,
      lastSeenAt: now,
      expiresAt: minutesFrom(now, config.SESSION_ABSOLUTE_HOURS * 60),
      ip: req.ip,
      userAgent: req.headers['user-agent']?.slice(0, 255) ?? null,
    },
    include: { user: { select: { id: true, email: true, name: true } } },
  });

  reply.setCookie(config.sessionCookieName, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: config.secureCookies,
    path: '/',
  });

  return {
    sessionId: session.id,
    csrfToken: session.csrfToken,
    user: session.user,
    lastSeenAt: session.lastSeenAt,
    expiresAt: session.expiresAt,
  };
}

/**
 * Look up the session for this request's cookie. Expired sessions are deleted.
 * `touch` slides the idle timeout forward; status polling passes false so it
 * can't keep an idle session alive.
 */
export async function resolveSession(
  { db, clock, config }: AppDeps,
  req: FastifyRequest,
  { touch }: { touch: boolean },
): Promise<AuthContext | null> {
  const token = req.cookies[config.sessionCookieName];
  if (!token) return null;

  const session = await db.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: { select: { id: true, email: true, name: true } } },
  });
  if (!session) return null;

  const now = clock.now();
  const idleExpiry = minutesFrom(session.lastSeenAt, config.SESSION_IDLE_MINUTES);
  if (now >= session.expiresAt || now >= idleExpiry) {
    await db.session.deleteMany({ where: { id: session.id } });
    return null;
  }

  let lastSeenAt = session.lastSeenAt;
  if (touch && now.getTime() - lastSeenAt.getTime() > TOUCH_THROTTLE_MS) {
    lastSeenAt = now;
    await db.session.update({ where: { id: session.id }, data: { lastSeenAt } });
  }

  return {
    sessionId: session.id,
    csrfToken: session.csrfToken,
    user: session.user,
    lastSeenAt,
    expiresAt: session.expiresAt,
  };
}

export async function destroySession(
  { db, config }: AppDeps,
  req: FastifyRequest,
  reply: FastifyReply,
) {
  const token = req.cookies[config.sessionCookieName];
  if (token) await db.session.deleteMany({ where: { tokenHash: hashToken(token) } });
  reply.clearCookie(config.sessionCookieName, { path: '/' });
}

export function toSessionInfo({ config }: AppDeps, auth: AuthContext | null): SessionInfo {
  if (!auth) return { authenticated: false };
  const idle = minutesFrom(auth.lastSeenAt, config.SESSION_IDLE_MINUTES);
  return {
    authenticated: true,
    user: auth.user,
    csrfToken: auth.csrfToken,
    idleExpiresAt: (idle < auth.expiresAt ? idle : auth.expiresAt).toISOString(),
    absoluteExpiresAt: auth.expiresAt.toISOString(),
  };
}
