import type { Clock } from './clock';
import type { Config } from './config';
import type { Db } from './db';

/** Everything route handlers and services need, passed explicitly so tests can swap any of it. */
export interface AppDeps {
  config: Config;
  db: Db;
  clock: Clock;
}
