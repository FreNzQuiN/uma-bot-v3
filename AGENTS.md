# Uma Club Bot v3

WhatsApp bot for Uma Musume club leaders. Tracks member performance, sends automated reports, and provides tier intelligence from uma.moe data.

---

## Quick Reference

```bash
npm run setup        # install deps + copy config.example.yaml -> config.yaml
npm run build        # tsc -> dist/
npm start            # node dist/index.js
npm run dev          # ts-node src/index.ts
npm run dev:watch    # ts-node-dev with hot-reload
npm test             # jest --forceExit --detectOpenHandles (1389 tests)
npm run lint:check   # tsc --noEmit (type-check only, no build)
npm run fetch        # manually fetch uma.moe data for current month
```

**Verify before committing:** `npm run lint:check && npm test`

---

## Architecture

Single Node.js process. No microservices, no cache layer — one process handles WhatsApp (Baileys), HTTP API, cron scheduling, and report generation.

**Why:** Data processing is arithmetic on arrays of ~34 integers. uma.moe data is static for 24h. Splitting adds friction without benefit.

**Key constraint:** The bot runs intermittently (on/off at unpredictable intervals). It must detect missed reports on restart and send catch-up reports tagged `[Mode catch-up]`.

### Source Layout

```
src/
├── index.ts          # Entry point — composition root (wires modules together)
├── config.ts         # YAML config loading + Zod validation + hot-reload watcher
├── runtime.ts        # Runtime stats (uptime, reconnects, message counts)
├── types/index.ts    # Shared TypeScript types (BotConfig, Snapshot, ComputedMember, etc.)
├── orchestrator/
│   └── report-orchestrator.ts  # Report pipeline: generation + delivery + alerts
├── api/
│   ├── uma-moe.ts    # HTTP client for uma.moe circle data API
│   └── server.ts     # HTTP API (reports, members, tier endpoints)
├── data/
│   ├── snapshot.ts   # Snapshot save/load/path management (data/snapshots/YYYY/MM/DD.json)
│   └── daily-fans.ts # Daily fan array arithmetic
├── db/
│   └── database.ts   # SQLite via sql.js (member history, rank history, alerts)
├── reports/
│   ├── daily.ts, weekly.ts, monthly.ts, ranks.ts, bottom.ts, stats.ts, members.ts, tier.ts
│   ├── compare.ts, analyze.ts, combined.ts
│   ├── compute.ts    # Shared report computation (computeMembers)
│   └── format.ts     # WhatsApp message formatting + splitting
├── alerts/
│   └── alerts.ts     # Alert detection + formatting (performance drop, demotion risk, etc.)
├── scheduler/
│   ├── scheduler.ts  # Cron-based auto-delivery (daily 22:05, weekly, monthly)
│   ├── catchup.ts    # Missed report detection + catch-up execution
│   └── helpers.ts    # Scheduler helper utilities
├── whatsapp/
│   ├── client.ts     # Baileys WhatsApp connection
│   ├── dispatch.ts   # Command routing (parses /commands, routes to handlers)
│   ├── commands.ts   # Command handler implementations
│   ├── admin.ts      # Admin-only command handlers
│   └── access.ts     # Access control (admin vs command group)
└── utils/
    ├── format.ts     # Pure string utilities (splitMessage)
    ├── logger.ts     # Pino-based logger with file rotation
    ├── timezone.ts   # WIB (Asia/Jakarta) timezone helpers
    └── index.ts      # General utilities
```

### Data Model

Core data is a `daily_fans` array — cumulative integers, one per day. Every report (daily, weekly, monthly, ranks, bottom, stats) is different arithmetic on this same array.

Snapshots: `data/snapshots/YYYY/MM/DD.json` — immutable once saved.
Database: `data/bot.db` — SQLite via sql.js (member history, rank history, alert dedup).
Config: `config.yaml` — YAML with Zod validation. Hot-reloaded every 5s via mtime polling.

### Startup Order

1. Load config + init DB
2. Fetch fresh data if snapshot is stale (2+ days behind)
3. Pre-fetch previous 2 months
4. Start HTTP API server
5. Connect WhatsApp (non-blocking, QR scan on first run)
6. Once connected: run catch-up, then start scheduler

---

## Testing

- **Framework:** Jest + ts-jest, tests in `tests/` mirroring `src/` structure
- **Run all:** `npm test` (uses `--forceExit --detectOpenHandles` — Baileys doesn't clean up cleanly)
- **Run single file:** `npx jest tests/reports/daily/daily.unit.test.ts`
- **Run single test:** `npx jest -t "test name pattern"`
- **Coverage:** `npm run test:coverage` — thresholds: 70% branches, 80% functions/lines/statements
- **Coverage exclusions:** `src/index.ts`, `src/types/**`, `src/api/uma-moe.ts` are excluded from coverage

Test structure mirrors src:
```
tests/
├── _helpers/         # Shared test utilities (snapshot loader, mock date, constants)
├── alerts/
├── api/
├── bugs/             # Regression tests for specific bugs
├── config.test.ts
├── data/
├── db/
├── examples/         # Test fixture data (real snapshot JSON)
├── reports/
│   ├── daily/        # daily.unit, daily.format, daily.dispatch, daily.stale, daily.edge
│   ├── weekly/       # weekly.unit, weekly.format, weekly.stale, weekly.edge
│   ├── monthly/      # monthly.unit, monthly.format, monthly.stale, monthly.edge
│   ├── compute.test.ts, ranks.test.ts, bottom.test.ts, stats.test.ts
│   ├── members.test.ts, compare.test.ts, analyze.test.ts
│   ├── formatters.test.ts  # format.ts utilities only
│   ├── e2e-output.test.ts  # Cross-report consistency + data integrity
│   └── tier.test.ts
├── scheduler/
└── whatsapp/
```

---

## Configuration

All config lives in `config.yaml` (gitignored). Copy from `config.example.yaml`.

Key sections: `circleId`, `admins` (WhatsApp JIDs), `groups` (command/announcement/alertAdmin), `requirements` (fan thresholds), `schedule` (cron times in WIB), `catchUp`, `alerts`, `message` (split settings, language: `id`).

Env vars (optional, `.env`): `API_PORT` (default 3000), `WA_SESSION_DIR` (default `data/auth`).

**Config is validated with Zod at load time.** Invalid config throws immediately with field-level errors.

---

## Key Gotchas

- **Windows paths:** `npm run restart` uses `timeout /t 2 >nul` (Windows syntax). `npm run db:reset` and `npm run db:backup` use inline Node scripts.
- **No `dist/` in git:** Must run `npm run build` before `npm start`. `npm run dev` works without building.
- **Snapshot immutability:** Never mutate saved snapshots. Reports recompute from the array each time.
- **Month boundaries:** Monthly reports use offset=-1 (previous month). Pre-fetching target month snapshots is handled automatically.
- **Combined reports:** On collision days (daily + weekly), a single combined message is sent instead of two separate ones.
- **Message splitting:** WhatsApp 4096-char limit. Long reports split at newline boundaries (configurable).
- **Playwright in Docker:** Dockerfile installs Playwright chromium + system deps. `PLAYWRIGHT_BROWSERS_PATH` is set.
- **sql.js not sqlite3:** Uses sql.js (in-memory WASM SQLite). No native compilation needed. DB file is a binary blob.
- **Config hot-reload:** Polls mtime every 5s. Changing schedule requires full scheduler restart (handled automatically).
- **`scripts/*.js` is gitignored:** The `stop.js` script is checked in but `scripts/*.js` is in `.gitignore`. The `scripts/reverse-engineer.js` is generated.

---

## Product Context

See `plans/v4-spec.md` for the full v4 specification (current version in development).
See `docs/uma-moe-api.md` for the uma.moe API documentation.
See `docs/game-context.md` for Uma Musume game mechanics.
See `tests/examples/snapshot-june-12.json` for real snapshot data.

User-facing language is Indonesian (`id`). Report messages, alerts, and bot responses are in Bahasa Indonesia.

All times are WIB (Asia/Jakarta). uma.moe data updates once daily at ~22:00 WIB.
