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

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    clearInterval(scheduler);
    void app
      .close()
      .then(() => db.$disconnect())
      .then(() => process.exit(0));
  });
}
