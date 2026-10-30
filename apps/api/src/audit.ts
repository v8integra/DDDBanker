import type { Db, Tx } from './db';

export type AuditAction =
  | 'SIGNUP'
  | 'LOGIN'
  | 'LOGIN_FAILED'
  | 'LOGIN_LOCKED'
  | 'LOGOUT'
  | 'ACCOUNT_RENAMED'
  | 'ACCOUNT_OPENED'
  | 'TRANSFER'
  | 'DEPOSIT'
  | 'WITHDRAWAL'
  | 'P2P'
  | 'BILL_PAY'
  | 'PAYEE_ADDED'
  | 'PAYEE_REMOVED'
  | 'SCHEDULED_PAYMENT'
  | 'CARD_STATUS'
  | 'CARD_PURCHASE'
  | 'PASSWORD_CHANGED'
  | 'TWO_FACTOR_ENABLED'
  | 'TWO_FACTOR_DISABLED'
  | 'SESSION_REVOKED'
  | 'APPLICATION'
  | 'LOAN_ACCEPTED'
  | 'LOAN_PAYMENT'
  | 'POLICY_BOUND'
  | 'POLICY_CANCELLED'
  | 'DEV_CLOCK'
  | 'DEV_RESET';

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
