import { PrismaLibSql } from '@prisma/adapter-libsql';
import { PrismaClient, type Prisma } from './generated/prisma/client';

export type Db = PrismaClient;
export type Tx = Prisma.TransactionClient;

export function createDb(url: string): Db {
  return new PrismaClient({ adapter: new PrismaLibSql({ url }) });
}

export function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && err.code === 'P2002';
}
