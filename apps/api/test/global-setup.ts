import { execSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import type { TestProject } from 'vitest/node';

export const TEST_DB_DIR = '.test-dbs';
const TEMPLATE = `${TEST_DB_DIR}/template.db`;

declare module 'vitest' {
  export interface ProvidedContext {
    templateDb: string;
  }
}

/** Migrate one template database; each test file then copies it, so files can run in parallel. */
export default function setup(project: TestProject) {
  rmSync(TEST_DB_DIR, { recursive: true, force: true });
  mkdirSync(TEST_DB_DIR, { recursive: true });
  execSync('npx prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL: `file:./${TEMPLATE}` },
    stdio: 'pipe',
  });
  project.provide('templateDb', TEMPLATE);

  return () => rmSync(TEST_DB_DIR, { recursive: true, force: true });
}
