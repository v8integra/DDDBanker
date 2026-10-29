import { hash, verify } from '@node-rs/argon2';

// OWASP-recommended argon2id baseline: 19 MiB memory, 2 iterations. Argon2id is
// the library default (its Algorithm enum is const and can't be imported here);
// a test asserts the stored hash really is $argon2id$.
const OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 };

export function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

let dummyHash: Promise<string> | undefined;

/** Burn the same time as a real check so unknown emails can't be detected by timing. */
export async function verifyAgainstDummy(password: string): Promise<false> {
  dummyHash ??= hashPassword('not-a-real-password-just-timing');
  await verifyPassword(await dummyHash, password);
  return false;
}
