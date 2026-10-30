# Deploying the Bank of Bramblewood

The production setup is **one Node process**. The API serves the built web app
from the same origin, keeps its data in a **SQLite file on a persistent disk**,
and runs the bank-day job (interest, statements, loan bills, scheduled payments)
in-process once a minute.

```
browser ──HTTPS──▶ host / reverse proxy ──HTTP──▶ node (API + web app)
                                                    └─ /data/bank.db (persistent disk)
```

Same origin matters. The session cookie is `__Host-bb_session`: `Secure`,
`HttpOnly` and `SameSite=Strict`. It only works when the pages and `/api/v1`
come from the same HTTPS origin, which serving both from one process
gives you for free.

## Requirements

- Node 22 or newer.
- A persistent disk or volume for the SQLite file. Most Node hosts wipe the
  app folder on every deploy, so the database must live somewhere else.
- **HTTPS**, provided by the host or by a reverse proxy such as Caddy or nginx.
  Secure cookies don't work over plain HTTP, except on `localhost`.
- **One instance only.** The scheduler runs inside the process, and SQLite
  doesn't share across machines. Don't scale out to several copies.

## Environment variables

| Variable                 | Production value                                 | Notes                                                                                                             |
| ------------------------ | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`               | `production`                                     | Turns on secure cookies, HSTS and the `__Host-` cookie name. Dev tools default to off.                            |
| `DATABASE_URL`           | `file:/data/bank.db`                             | An absolute path on the persistent disk.                                                                          |
| `WEB_DIST`               | absolute path to `apps/web/dist`                 | Makes the API serve the web app. Relative paths resolve from `apps/api`.                                          |
| `API_HOST`               | `0.0.0.0`                                        | The default `127.0.0.1` only accepts local connections. Use `0.0.0.0` unless a proxy runs on the same machine.    |
| `API_PORT`               | whatever the host gives you (often `PORT`)       | Default 3001.                                                                                                     |
| `TRUST_PROXY`            | `true` behind a proxy or PaaS, otherwise `false` | Needed so rate limits and the sign-in log see real client IPs. Never set it when clients can reach Node directly. |
| `LOG_LEVEL`              | `info`                                           | Credentials, cookies and CSRF tokens are always redacted.                                                         |
| `SESSION_IDLE_MINUTES`   | `15`                                             | Optional.                                                                                                         |
| `SESSION_ABSOLUTE_HOURS` | `12`                                             | Optional.                                                                                                         |
| `LOCKOUT_THRESHOLD`      | `5`                                              | Optional: failed sign-ins before a lockout.                                                                       |
| `LOCKOUT_MINUTES`        | `15`                                             | Optional.                                                                                                         |

With `NODE_ENV=production` the API refuses to start if `DEV_TOOLS=true` (the time
machine could move the bank clock) or if `RATE_LIMITS_ENABLED=false`.

## Build and start

```bash
npm ci
npm run build        # builds apps/web/dist
npm run db:deploy    # applies migrations to DATABASE_URL (safe to re-run)
npm run db:seed      # optional: the demo customers (safe to re-run)
npm start            # API + web app
```

Run `db:deploy` on every release, before `npm start`. A health check is at
`GET /api/v1/health`.

**About the seed:** it creates the public demo accounts (`demo@bramblewood.test` and
`sam@bramblewood.test`, password `bramblewood-demo-2026`). That's what a demo site
wants. Skip `db:seed` if you don't want anyone to be able to sign in with the
published password.

## Example: a small Linux server with Caddy

1. Install Node 22, clone the repo to `/srv/bramblewood`, and make `/data` for the database.
2. Build:

   ```bash
   npm ci && npm run build
   ```

3. Create `/etc/systemd/system/bramblewood.service`:

   ```ini
   [Unit]
   Description=Bank of Bramblewood
   After=network.target

   [Service]
   WorkingDirectory=/srv/bramblewood
   Environment=NODE_ENV=production
   Environment=DATABASE_URL=file:/data/bank.db
   Environment=WEB_DIST=/srv/bramblewood/apps/web/dist
   Environment=API_PORT=3001
   Environment=TRUST_PROXY=true
   ExecStartPre=/usr/bin/npm run db:deploy
   ExecStart=/usr/bin/npm start
   Restart=on-failure
   User=bramblewood

   [Install]
   WantedBy=multi-user.target
   ```

4. Add a Caddyfile. Caddy gets the HTTPS certificate itself:

   ```
   bank.example.com {
     reverse_proxy 127.0.0.1:3001
   }
   ```

5. Run `systemctl enable --now bramblewood`, then `npm run db:seed` once (with the same environment) for the demo customers.

## Example: a Node PaaS

Any host that runs a Node web service with a persistent disk works:

- **Build command:** `npm ci && npm run build`
- **Start command:** `npm run db:deploy && npm start`
- **Disk:** mount it at `/data`, and set `DATABASE_URL=file:/data/bank.db`.
- **Environment:**
  - `NODE_ENV=production`
  - `WEB_DIST` set to the absolute path of `apps/web/dist` in the app folder
  - `API_HOST=0.0.0.0`
  - `API_PORT` set to the port the platform gives you
  - `TRUST_PROXY=true`
- **Instances:** exactly one.

## What production gets

- **Security headers** (Helmet) on everything.
  - The API sends `default-src 'none'`.
  - Pages get a CSP that only allows the site itself: `script-src 'self' 'wasm-unsafe-eval'` (Rapier compiles WebAssembly), `style-src 'self'`, `font-src 'self'`, `connect-src 'self'`, `frame-ancestors 'none'`. Inline style attributes are the one exception.
  - Fonts are self-hosted, so pages make no requests to other origins.
- **Caching:** files under `assets/` have hashed names and are cached for a year as `immutable`. The HTML pages use `no-cache`, so a new release shows up right away.
- **Rate limits** on sign-in, sign-up and money movement. Lockouts after repeated failed sign-ins.
- **Dev tools off.** `/dev/*` returns 404 and the time machine is gone. `?debug` still shows the FPS and collider overlay, which is harmless.

`npm run test:e2e:prod` builds the web app and runs the whole Playwright suite
against this exact setup: production mode, one origin, secure cookies, the CSP,
and rate limits on. It fails on any console error or CSP violation.

## Backups

SQLite is one file. Back it up with the SQLite CLI while the app runs:

```bash
sqlite3 /data/bank.db ".backup '/backups/bank-$(date +%F).db'"
```

Or stop the service and copy the file. Copying a live database file directly can
capture a half-written state.

## Switching to Postgres later

The code talks to the database only through Prisma, so the switch is contained:

1. In `apps/api/prisma/schema.prisma`, change the datasource `provider` to `postgresql`.
2. Swap the driver adapter in `apps/api/src/db.ts` from `@prisma/adapter-libsql` to `@prisma/adapter-pg`.
3. SQLite migrations don't apply to Postgres, so start a fresh migration history with `prisma migrate dev --name init` against a Postgres database.
4. Run the API test suite against Postgres before switching.
5. Keep one instance, or move the bank-day job out of the web process first.

Money is stored as integer cents and dates as timestamps, so no data types need
to change.
