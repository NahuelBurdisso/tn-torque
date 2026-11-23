# TN-Torque

[![CI](https://github.com/NahuelBurdisso/tn-torque/actions/workflows/ci.yml/badge.svg)](https://github.com/NahuelBurdisso/tn-torque/actions/workflows/ci.yml)

A local, multi-store automation runtime for [Tienda Nube / Nuvemshop](https://www.tiendanube.com/) stores.

It mirrors each store's catalog and checkouts into Postgres, **synthesizes the events the platform does not emit** (abandoned checkouts, stock changes), and runs automation modules on top of them — replacing a stack of paid marketplace apps with one process you run yourself.

TypeScript · Node 22 · Postgres · pnpm workspaces · Vitest

## Why

Tienda Nube has no webhook for abandoned checkouts or restocks; anything about carts and stock has to be polled and diffed. TN-Torque does that diff once, stores the result as an event log, and lets small modules subscribe to it.

## Architecture

```
packages/
  cli/    tnt command (commander)
  core/   domain logic
    tn/        API client, OAuth exchange, rate limiter
    sync/      stage → apply: diff of the remote catalog against the mirror
    events/    deterministic event keys (idempotent emission)
    queue/     Postgres-backed job queue
    modules/   ntfy · daily digest · weekly summary, behind one registry
    crypto/    secret box for store tokens (node:crypto)
    config/    per-store store.toml, validated with zod
  db/     postgres.js client, SQL migrations, mirror + history tables
stores/
  demo/store.toml   one folder per store
```

Design choices worth a look:

- **Sync is stage-then-apply.** Remote data is staged, diffed against the mirror, and the differences become events. Concurrent and duplicate syncs are covered by tests (`apply.concurrency.test.ts`, `apply.duplicate.test.ts`).
- **Cold start is handled explicitly** (`apply-checkouts.coldstart.test.ts`), so the first sync of a store builds a baseline.
- **Multi-store from day one.** A revoked token cancels that store's pending jobs only.
- **Store tokens are sealed** with a master key from the environment before they are persisted.

## Running it

```bash
cp .env.example .env          # set TNT_MASTER_KEY and the partner app credentials
pnpm install
pnpm db:up                    # Postgres via docker compose
pnpm db:migrate

pnpm tnt store add demo       # prints the OAuth URL; re-run with --code
pnpm tnt sync demo            # mirror the store and dispatch events
pnpm tnt worker               # process the job queue
pnpm tnt digest demo          # print the digest without sending it
pnpm tnt store status
```

## Tests

```bash
pnpm test         # Vitest; DB tests use TNT_TEST_DATABASE_URL, which is dropped and recreated on each run
pnpm typecheck
```

Tests cover the sync diff, the queue, module scheduling, OAuth, rate limiting and the migrations.

## Status

Milestone 0 (skeleton, mirror, event log, queue, ntfy) and milestone 1 (abandoned-cart digest, weekly summary) are done. Store names and identifiers in fixtures are placeholders.
