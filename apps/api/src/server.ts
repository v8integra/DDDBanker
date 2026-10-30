import { buildApp } from './app';
import { BankClock } from './bank/clock';
import { runBankDays } from './bank/days';
import { systemClock } from './clock';
import { loadConfig } from './config';
import { createDb } from './db';

const config = loadConfig();
const db = createDb(config.DATABASE_URL);
const bank = new BankClock(systemClock);
await bank.load(db);
const app = await buildApp({ config, db, clock: systemClock, bank });

try {
  await app.listen({ host: config.API_HOST, port: config.API_PORT });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

// In-process scheduler: once a minute, catch up on bank days (interest,
// maturities, statements, loan bills, premiums, scheduled payments).
const tick = () =>
  runBankDays(db, bank.now()).catch((err: unknown) =>
    app.log.error({ err }, 'bank day job failed'),
  );
void tick();
const scheduler = setInterval(tick, 60_000);

// Stop cleanly, but always stop: a close that hangs (an open connection, a
// stuck query) must not leave the port taken. SIGHUP is what Windows sends
// when the console window closes, SIGBREAK is Ctrl+Break.
const SHUTDOWN_GRACE_MS = 5_000;
let stopping = false;
function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  app.log.info({ signal }, 'shutting down');
  clearInterval(scheduler);
  setTimeout(() => {
    app.log.warn('shutdown took too long, exiting anyway');
    process.exit(1);
  }, SHUTDOWN_GRACE_MS).unref();
  app
    .close()
    .then(() => db.$disconnect())
    .then(
      () => process.exit(0),
      (err: unknown) => {
        app.log.error({ err }, 'error while shutting down');
        process.exit(1);
      },
    );
}
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK'] as const) {
  process.on(signal, () => shutdown(signal));
}
