import type { Db, Tx } from './db';

export type AuditAction =
  'SIGNUP' | 'LOGIN' | 'LOGIN_FAILED' | 'LOGIN_LOCKED' | 'LOGOUT' | 'ACCOUNT_RENAMED' | 'TRANSFER';

export interface AuditInput {
  userId: string | null;
  action: AuditAction;
  /** Never put passwords, tokens, or full request bodies here. */
  metadata?: Record<string, unknown>;
  ip?: string;
  at: Date;
}

export async function audit(db: Db | Tx, input: AuditInput) {
  await db.auditLog.create({
    data: {
      userId: input.userId,
      action: input.action,
      metadata: input.metadata ? JSON.stringify(input.metadata) : null,
      ip: input.ip ?? null,
      createdAt: input.at,
    },
  });
}
