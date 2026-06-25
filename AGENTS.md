# Uma Club Bot v3

WhatsApp bot for Uma Musume club leaders. Tracks member performance, sends automated reports, and provides tier intelligence from uma.moe data.

**What it does:** Replaces manual tracking of ~30 members' fan progress. Leaders check uma.moe once a day, mentally compare numbers, and decide who's meeting the 20M monthly requirement. The bot does this automatically and sends the result to WhatsApp.

**Who it's for:** Circle leaders who need to know who's contributing, who's falling behind, and whether the club is promoting or demoting.

**Core insight:** Everything is arithmetic on one array. uma.moe gives you a `daily_fans` array — 32 cumulative integers, one per day. Daily gain, weekly gain, monthly gain, who's stale, who's below requirement — all different math on the same data.

---

## Quick Reference

```bash
npm run setup        # install deps + copy config.example.yaml -> config.yaml
npm run build        # tsc -> dist/
npm start            # node dist/index.js
npm run dev          # ts-node src/index.ts
npm run dev:watch    # ts-node-dev with hot-reload
npm test             # all tests
npm run lint:check   # tsc --noEmit (type-check only, no build)
npm run fetch        # manually fetch uma.moe data for current month
```

**Verify before committing:** `npm run lint:check && npm test`

---

## How It Works

Single Node.js process. No microservices, no cache layer. One process handles WhatsApp (Baileys), HTTP API, cron scheduling, and report generation. Data processing is arithmetic on arrays of ~34 integers. uma.moe data is static for 24h. Splitting adds friction without benefit.

**Key constraint:** The bot runs intermittently (on/off at unpredictable intervals). It must detect missed reports on restart and send catch-up reports tagged `*⚠️ Catch-up*` (below the report title).

### Data Flow

```
uma.moe → Snapshot (immutable JSON) → computeMembers() → Report → WhatsApp
```

1. Playwright fetches circle data from uma.moe (solves Cloudflare Turnstile)
2. Saved as `data/snapshots/YYYY/MM/DD.json` — immutable once written
3. `computeMembers()` transforms `daily_fans` arrays into `ComputedMember` objects
4. 12 report generators produce WhatsApp-formatted strings
5. Split at newline boundaries (4096 char limit), sent to announcement groups

### Source Layout

```
src/
├── index.ts          # Composition root — wires everything together
├── config.ts         # YAML config + Zod validation + hot-reload
├── data/             # Snapshots (immutable JSON) + daily_fans arithmetic
├── db/               # Pluggable database (SQLite default, MySQL/TiDB optional)
├── reports/          # 12 report generators + compute engine + registry
├── alerts/           # Performance drop, demotion risk, streak break detection
├── scheduler/        # Cron delivery + catch-up on restart
├── orchestrator/     # Report pipeline: generation → delivery → alerts
├── whatsapp/         # Baileys client + command dispatch + access control
├── api/              # HTTP API (localhost) + uma.moe client
└── utils/            # Logger, timezone helpers, string formatting
```

The `db/` directory uses the adapter pattern — `IDatabase` interface with SQLite and MySQL implementations. Consumer code depends only on the interface.

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

**Test naming convention:**
```
*.unit.test.ts          — pure logic, mocked deps
*.integration.test.ts   — real I/O (HTTP, DB, filesystem)
*.edge.test.ts          — boundary conditions, empty data, overflow
*.regression.test.ts    — bug fix reproduction tests (lives NEXT TO the module)
```

Special files that keep their names: `e2e-output.test.ts`, `golden-inline.test.ts`, `dispatch-fuzz.test.ts`.

---

## Configuration

All config lives in `config.yaml` (gitignored). Copy from `config.example.yaml`.

Key sections: `circleId`, `admins` (WhatsApp JIDs), `groups` (command/announcement/alertAdmin), `requirements` (fan thresholds), `schedule` (cron times in WIB), `catchUp`, `alerts`, `message` (split settings, language: `id`), `database` (backend selection: sqlite or mysql).

Env vars (optional, `.env`): `API_PORT` (default 3000), `API_TOKEN` (bearer token for API auth), `WA_SESSION_DIR` (default `data/auth`).

**Config is validated with Zod at load time.** Invalid config throws immediately with field-level errors.

---

## Key Gotchas

| Gotcha | Why it matters |
|--------|---------------|
| **No `dist/` in git** | Must `npm run build` before `npm start`. `npm run dev` works without building. |
| **Snapshot immutability** | Never mutate saved snapshots. Reports recompute from the array each time. |
| **Month boundaries** | Monthly reports use offset=-1 (previous month). Pre-fetching is automatic. |
| **Combined reports** | On collision days (daily + weekly), a single combined message is sent. |
| **sql.js, not sqlite3** | In-memory WASM SQLite. No native compilation. DB file is a binary blob. |
| **mysql2 is optional** | Only imported when `backend: mysql`. SQLite works without it. |
| **MySQL 8.0.31+ required** | Adapter checks version at startup. TiDB auto-detected and bypasses check. |
| **Config hot-reload** | Polls mtime every 5s. Schedule changes restart scheduler automatically. |
| **Windows paths** | `npm run restart` uses `timeout /t 2 >nul` (Windows syntax). |
| **Baileys doesn't clean up** | Tests use `--forceExit` because Baileys sockets don't close cleanly. |
| **User-facing language** | Indonesian (`id`). All reports, alerts, and bot responses. |
| **All times are WIB** | Asia/Jakarta (UTC+7). uma.moe data updates at ~22:00 WIB. |

---

## Product Context

See `docs/uma-moe-api.md` for the uma.moe API documentation.
See `docs/game-context.md` for Uma Musume game mechanics.
See `docs/architecture.md` for system design and data flow.
See `docs/message-design.md` for the Bourbon persona and message formatting.
See `docs/configuration.md` for full config reference.
See `tests/examples/snapshot-june-12.json` for real snapshot data.
