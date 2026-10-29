import type { TransferResult } from '@dddbanker/shared';
import { getOwnedAccount, toAccountSummary } from '../accounts/accounts';
import { audit } from '../audit';
import type { Tx } from '../db';
import { AppError } from '../errors';
import { postTransaction } from '../ledger/ledger';

const TRANSFERABLE = new Set(['CHECKING', 'SAVINGS']);

export interface TransferRequest {
  userId: string;
  fromAccountId: string;
  toAccountId: string;
  amountCents: number;
  memo?: string | undefined;
  at: Date;
  ip?: string;
}

/** Move money between two of the user's own deposit accounts. Run inside a DB transaction. */
export async function transferBetweenOwnAccounts(
  tx: Tx,
  req: TransferRequest,
): Promise<TransferResult> {
  const from = await getOwnedAccount(tx, req.userId, req.fromAccountId);
  const to = await getOwnedAccount(tx, req.userId, req.toAccountId);
  if (!TRANSFERABLE.has(from.type) || !TRANSFERABLE.has(to.type)) {
    throw new AppError(
      422,
      'TRANSFER_NOT_ALLOWED',
      'Transfers work between checking and savings accounts.',
    );
  }

  const amount = BigInt(req.amountCents);
  const transactionId = await postTransaction(tx, {
    type: 'TRANSFER',
    description: `Transfer from ${from.nickname} to ${to.nickname}`,
    memo: req.memo,
    initiatedByUserId: req.userId,
    at: req.at,
    entries: [
      { accountId: from.id, amountCents: -amount, description: `Transfer to ${to.nickname}` },
      { accountId: to.id, amountCents: amount, description: `Transfer from ${from.nickname}` },
    ],
  });

  await audit(tx, {
    userId: req.userId,
    action: 'TRANSFER',
    metadata: {
      transactionId,
      fromAccountId: from.id,
      toAccountId: to.id,
      amountCents: req.amountCents,
    },
    ...(req.ip && { ip: req.ip }),
    at: req.at,
  });

  return {
    transactionId,
    from: toAccountSummary(await tx.account.findUniqueOrThrow({ where: { id: from.id } })),
    to: toAccountSummary(await tx.account.findUniqueOrThrow({ where: { id: to.id } })),
  };
}
