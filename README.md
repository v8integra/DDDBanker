# Bank of Bramblewood

A fictional bank you visit as a small 3D world. Walk in, check in at the desk, and do your banking at retro RPG-style stations. No real money moves, but the backend behaves like a real bank.

See [docs/3d-bank-plan.md](docs/3d-bank-plan.md) for the full plan and phase status.

## Setup (Windows)

Requires Node 22 or newer.

```bash
npm install
npm run db:seed
npm run dev
```

Then open http://127.0.0.1:5173. The API runs on http://127.0.0.1:3001. The SQLite database is created at `apps/api/prisma/dev.db` on first run.

**Demo login:** `demo@bramblewood.test` (or `sam@bramblewood.test`), password `bramblewood-demo-2026`. This is a demo bank: never enter real personal or financial information.

## Scripts

| Script               | What it does                          |
| -------------------- | ------------------------------------- |
| `npm run dev`        | API and web client together, watching |
| `npm test`           | Vitest in every workspace             |
| `npm run typecheck`  | `tsc` in every workspace              |
| `npm run lint`       | ESLint                                |
| `npm run format`     | Prettier (write)                      |
| `npm run db:seed`    | Add demo customers (safe to re-run)   |
| `npm run db:migrate` | Create a migration after schema edits |
| `npm run db:reset`   | Wipe the dev database and re-seed     |

## Layout

```
apps/api         Fastify backend
apps/web         Three.js client and menu UI
packages/shared  Bank config, money helpers, shared Zod schemas
docs/            Plan and notes
```
