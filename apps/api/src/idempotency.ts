import { createHash } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { IDEMPOTENCY_HEADER, idempotencyKeySchema } from '@dddbanker/shared';
import type { Db, Tx } from './db';
import { isUniqueViolation } from './db';
import { AppError } from './errors';

export interface IdempotentResult<T> {
  statusCode: number;
  body: T;
  replayed: boolean;
}

export function readIdempotencyKey(req: FastifyRequest): string {
  const parsed = idempotencyKeySchema.safeParse(req.headers[IDEMPOTENCY_HEADER]);
  if (!parsed.success) {
    throw new AppError(400, 'VALIDATION', 'This request needs a valid Idempotency-Key header.');
  }
  return parsed.data;
}

/**
 * Run a money-moving operation at most once per (user, key). The operation
 * and the stored result commit together, so a retry after a crash either
 * sees the stored result or runs fresh. Only successes are stored: a failed
 * attempt moved no money, so retrying it is safe.
 */
export async function runIdempotent<T>(
  db: Db,
  {
    userId,
    key,
    scope,
    payload,
    statusCode,
    at,
  }: {
    userId: string;
    key: string;
    /** Route name, so one key can't be replayed against a different endpoint. */
    scope: string;
    payload: unknown;
    statusCode: number;
    at: Date;
  },
  operation: (tx: Tx) => Promise<T>,
): Promise<IdempotentResult<T>> {
  const requestHash = createHash('sha256').update(JSON.stringify({ scope, payload })).digest('hex');

  const replay = async (): Promise<IdempotentResult<T> | null> => {
    const record = await db.idempotencyRecord.findUnique({
      where: { userId_key: { userId, key } },
    });
    if (!record) return null;
    if (record.requestHash !== requestHash) {
      throw new AppError(
        422,
        'IDEMPOTENCY_CONFLICT',
        'This request key was already used for a different request.',
      );
    }
    return {
      statusCode: record.statusCode,
      body: JSON.parse(record.responseJson) as T,
      replayed: true,
    };
  };

  const existing = await replay();
  if (existing) return existing;

  try {
    const body = await db.$transaction(async (tx) => {
      const result = await operation(tx);
      await tx.idempotencyRecord.create({
        data: {
          userId,
          key,
          requestHash,
          statusCode,
          responseJson: JSON.stringify(result),
          createdAt: at,
        },
      });
      return result;
    });
    return { statusCode, body, replayed: false };
  } catch (err) {
    // A concurrent request with the same key won the race; ours rolled back.
    if (isUniqueViolation(err)) {
      const winner = await replay();
      if (winner) return winner;
    }
    throw err;
  }
}
