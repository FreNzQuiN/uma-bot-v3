# Architecture

Single Node.js process. No microservices, no cache layer — one process handles WhatsApp (Baileys), HTTP API, cron scheduling, and report generation.

**Why:** Data processing is arithmetic on arrays of ~34 integers. uma.moe data is static for 24h. Splitting adds operational friction without benefit.

---

## System Overview

```
┌─────────────────────────────────────────────────────────┐
│                    Uma Club Bot v3                        │
│                     (Node.js)                            │
│                                                         │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────┐ │
│  │ WhatsApp │  │   HTTP   │  │ Scheduler│  │  Data  │ │
│  │ (Baileys)│  │   API    │  │(node-cron│  │ Fetch  │ │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └───┬────┘ │
│       │              │              │             │      │
│       └──────────────┴──────┬───────┴─────────────┘      │
│                             │                            │
│                    ┌────────▼────────┐                   │
│                    │   Report Engine │                   │
│                    │  (daily/weekly/ │                   │
│                    │   monthly/etc.) │                   │
│                    └────────┬────────┘                   │
│                             │                            │
│              ┌──────────────┼──────────────┐             │
│              │              │              │             │
│         ┌────▼────┐  ┌─────▼─────┐  ┌────▼────┐       │
│         │Snapshot │  │  SQLite   │  │ Config  │       │
│         │  Store  │  │  (sql.js) │  │ (YAML)  │       │
│         └─────────┘  └───────────┘  └─────────┘       │
└─────────────────────────────────────────────────────────┘
```

## Data Flow

### Inbound: Data Acquisition

```
uma.moe API → UmaMoeClient → Snapshot (JSON) → data/snapshots/YYYY/MM/DD.json
```

1. **UmaMoeClient** fetches circle data from uma.moe using Playwright-harvested tokens.
2. Token auto-refreshes on 401/403 (up to 3 retries).
3. Response is saved as an immutable snapshot: `data/snapshots/YYYY/MM/DD.json`.
4. Snapshots are never mutated after saving — reports recompute from the array each time.

**When data is fetched:**
- On startup (if snapshot is stale: 2+ days behind current day)
- On scheduled data fetch (same cron as daily report, before report generation)
- On-demand via `npm run fetch`
- On report request with month mismatch (auto-fetches current month)

### Outbound: Report Delivery

```
Snapshot → computeMembers() → ReportOrchestrator → generateReport() → deliverReport() → WhatsApp → Announcement Group
```

1. **computeMembers** (in `reports/compute.ts`) is called once per report pipeline by the orchestrator or dispatch layer. It transforms raw `daily_fans` arrays into `ComputedMember` objects with monthlyGain, latestDailyGain, weeklyGains, status, etc.
2. **ReportOrchestrator** (in `orchestrator/report-orchestrator.ts`) orchestrates the full pipeline: snapshot alignment, month pre-fetch, report generation, delivery, and alert processing.
3. **generateReport** (e.g., `reports/daily.ts`) receives pre-computed members and generates report-specific data.
4. **deliverReport** sends the message to all configured announcement groups via Baileys, splitting at newline boundaries (configurable).
5. If delivery fails, the scheduler marks the run as `failed` in the database.

### Alerts

```
Snapshot → detectAlerts() → recordAlert() → formatAlerts() → WhatsApp → Admin/Group
```

1. **detectAlerts** (in `alerts/alerts.ts`) runs after each report delivery.
2. Checks: performance drop, demotion risk, streak break, new transfer, rank drop.
3. Alerts are deduplicated via the database (`event_key` uniqueness).
4. During catch-up, alerts are collected and aggregated into a single message.

---

## Startup Sequence

```
1. Load config + init DB
2. Watch config.yaml for changes (polling every 5s)
3. Fetch fresh data if snapshot is stale
4. Pre-fetch previous 2 months
5. Update member history + rank history
6. Start HTTP API server (localhost only)
7. Start scheduler (cron tasks)
8. Connect WhatsApp (non-blocking)
   └── Once connected → run catch-up → start normal scheduling
```

**Why this order:**
- Config must load first (everything depends on it).
- Data must be available before reports can generate.
- API server starts before WhatsApp because it's independent.
- Scheduler starts before WhatsApp because it handles WA-not-connected gracefully.
- WhatsApp connects last because it needs QR scan on first run.
- Catch-up runs after WhatsApp connects because it needs to send messages.

---

## Key Components

### Snapshot Store (`data/snapshot.ts` + `data/ensure-snapshot.ts`)

**What:** Immutable JSON files at `data/snapshots/YYYY/MM/DD.json`.

**Why immutable:** Reports are pure functions on the `daily_fans` array. Recomputing from the same data always produces the same result. Mutating saved data would break this invariant.

**Path convention:** `YYYY/MM/DD` matches the data date (WIB), not the fetch date.

**`ensureMonthSnapshot`** lives in `data/ensure-snapshot.ts` (extracted from `snapshot.ts` to fix a reversed dependency — the data layer should not depend on the API layer). It fetches missing month data from uma.moe when the orchestrator or dispatch layer requests it.

### SQLite Database (`db/database.ts`)

**What:** Operational state — schedule runs, alert dedup, member history, rank history.

**Why sql.js:** Pure WASM, no native compilation needed. Works in Docker without system deps. DB file is a binary blob loaded entirely into memory.

**Tables:**
- `schedule_runs` — tracks every report send attempt (status: pending/sent/failed)
- `alert_events` — dedup for alerts (event_key uniqueness)
- `member_history` — tracks member presence across months
- `rank_history` — daily rank snapshots for trend analysis
- `settings` — key-value store for runtime settings

**Auto-save:** DB is written to disk every 30 seconds, plus on critical events (catch-up completion).

### Config (`config.ts`)

**What:** YAML configuration with Zod validation.

**Why YAML:** Human-readable, supports comments, familiar to most developers. Better than JSON for a config file that gets edited manually.

**Why Zod:** Type-safe validation at load time. Invalid config throws immediately with field-level errors instead of cryptic runtime crashes.

**Hot-reload mechanism:** Polls `config.yaml` mtime every 5 seconds. Compares both mtime AND content hash to avoid false triggers on mtime-only changes (e.g., editors that touch mtime without content changes).

### Scheduler (`scheduler/scheduler.ts`)

**What:** Cron-based auto-delivery using node-cron.

**Why node-cron:** Simple, no external deps, works on all platforms. No need for a full task queue — the bot is a single process.

**Collision detection:** When daily + weekly are scheduled at the same time on the same day, only the daily handler fires. It detects the collision and sends a combined message. This prevents duplicate messages.

**Duplicate prevention:** Before sending, the scheduler checks the database for the last successful run of that report type. If it was already sent today, it skips.

### Catch-Up Manager (`scheduler/catchup.ts`)

**What:** Detects missed reports on restart and sends them.

**How it works:**
1. For each report type, checks the last successful run in the database.
2. Compares against the most recent scheduled day (not just "today").
3. If the last run is before the most recent scheduled day, the report is "missed".
4. Missed reports are grouped by collision (same time → combined message).
5. Sent oldest-first, respecting `maxReportsPerStartup`.

**Why it's needed:** The bot runs intermittently. Without catch-up, any report missed while offline is permanently lost.

### WhatsApp Client (`whatsapp/client.ts`)

**What:** Baileys-based WhatsApp Web connection.

**Why Baileys:** Unofficial WhatsApp Web API. No official API available. Baileys handles auth, reconnection, and message sending.

**Key behaviors:**
- QR code shown in terminal on first run for authentication.
- Session data persists in `data/auth/` (or `WA_SESSION_DIR`).
- Auto-reconnects on network errors.
- Rejected only for `loggedOut`/`badSession` (requires user action).

### Command Dispatch (`whatsapp/dispatch.ts`)

**What:** Routes incoming WhatsApp messages to report generators or admin handlers.

**Flow:** Message → Parse command → Access control → Generate report → Send

Uses static imports for all report generators (no dynamic `import()` — no circular dependencies exist).

**Access control** (`whatsapp/access.ts`):
- Report commands → allowed in `command` groups or by admins.
- Admin commands → only admins, only in `command` groups or private chats.
- Unauthorized sources → silently ignored (no error message to non-admins in non-command groups).

### REST API (`api/server.ts`)

**What:** HTTP API on `127.0.0.1:3000` for external access to reports and data.

**Why localhost only:** Security — limits access to the machine itself. Combined with bearer token auth for additional protection.

**Authentication:** Optional bearer token via `API_TOKEN` env var. If set, all endpoints except `/health` require `Authorization: Bearer <token>`. If not set, auth is disabled (backwards compatible).

**Rate limiting:** 50 requests per second per IP. Returns 429 on excess.

**Response envelope:** All responses use `{ success, data, error, meta }` format.

See `docs/api-reference.md` for endpoint details.

### Report Engine (`reports/`)

**What:** Generates report strings from snapshot data.

**Core function:** `computeMembers()` in `reports/compute.ts` transforms raw `daily_fans` arrays into rich `ComputedMember` objects. This is called once per pipeline by the orchestrator/dispatch layer and injected into each report generator — never called internally by generators.

**Report registry:** `reports/registry.ts` maps type strings to generator functions. Both `dispatch.ts` and `report-orchestrator.ts` import from the registry — single source of truth for report type routing.

**Report types:**
| Type | File | What it computes |
|------|------|-----------------|
| Daily | `daily.ts` | Today's gain per member, ranked |
| Weekly | `weekly.ts` | Week block gain, requirement check |
| Monthly | `monthly.ts` | Month-to-date gain, projections |
| Ranks | `ranks.ts` | Top 10 members |
| Bottom | `bottom.ts` | Members needing attention |
| Stats | `stats.ts` | Club-wide statistics |
| Members | `members.ts` | Full member list |
| Tier | `tier.ts` | Tier promotion/demotion analysis |
| Compare | `compare.ts` | Side-by-side member comparison |
| Analyze | `analyze.ts` | Deep single-member analysis |
| Combined | `combined.ts` | Multi-type combined report (for collision days) |

### Report Orchestrator (`orchestrator/report-orchestrator.ts`)

**What:** Encapsulates the full report pipeline — generation, delivery, and alert processing.

**Why:** Extracted from `index.ts` to separate business logic from the composition root. The orchestrator owns: snapshot alignment (month-boundary and stale-data handling), month pre-fetch, report generation dispatch, message delivery to WhatsApp groups, and alert detection/recording/delivery.

**Dependencies:** `getConfig`, `getSnapshot`, `UmaMoeClient`, `Database`, `WhatsAppClient` — all injected via constructor.

### String Utilities (`utils/format.ts`)

**What:** Pure string formatting utilities with no domain logic.

**Key function:** `splitMessage()` — splits WhatsApp messages at newline boundaries with "Part X/Y" markers. Used by both `reports/format.ts` (re-exported for backward compatibility) and `whatsapp/client.ts` (static import).

---

## The daily_fans Array

Everything revolves around this 32-element integer array:

```
Index:  0   1   2   3  ...  30  31
Day:    1   2   3   4  ...  31  (unused)
Value:  cumulative fans at end of each day
```

**Positive values:** Cumulative total fans at end of that day.
**Zero:** No data (member hasn't contributed or hasn't joined).
**Negative values:** Transfer indicator (member transferred from another club).

**Daily gain calculation:**
```
day_gain = daily_fans[today] - daily_fans[yesterday]
```

**Weekly gain:** Sum of daily gains within the week block.
**Monthly gain:** `daily_fans[today] - daily_fans[0]` (or `abs()` for transfers).

Every report type is different arithmetic on this same array. The report engine never mutates it — only reads.

---

## Message Splitting

WhatsApp has a 4096-character limit. Long reports are split:

1. Try to split at a newline boundary near the limit.
2. If no newline found, split at the character limit.
3. Each part is sent as a separate message.
4. Splitting is configurable (`message.splitAtNewline`).

**Why newline boundaries:** Splitting mid-sentence or mid-table produces unreadable messages.

---

## Error Recovery

| Scenario | Behavior |
|----------|----------|
| uma.moe API down | Logs error, uses existing snapshots |
| WhatsApp disconnected | Reports generated but not delivered; scheduler marks as `failed` |
| Config invalid | Bot refuses to start with field-level error messages |
| Database corrupted | sql.js handles gracefully; can be reset with `npm run db:reset` |
| Bot crashes mid-report | Scheduler marks run as `failed`; catch-up sends it on restart |
| Token expired | Auto-refreshes via Playwright (up to 3 retries) |

---

## Testing Architecture

Tests mirror `src/` structure in `tests/` (1,599 tests across 47 suites):

```
src/reports/daily.ts     →  tests/reports/daily/daily.unit.test.ts
src/reports/daily.ts     →  tests/reports/daily/daily.format.test.ts
src/reports/daily.ts     →  tests/reports/daily/daily.dispatch.test.ts
src/reports/daily.ts     →  tests/reports/daily/daily.stale.test.ts
src/reports/daily.ts     →  tests/reports/daily/daily.edge.test.ts
```

**Test categories:**
- `*.unit.test.ts` — Pure logic tests (data computation)
- `*.format.test.ts` — Output formatting tests
- `*.dispatch.test.ts` — Integration tests (command routing)
- `*.stale.test.ts` — Stale data handling
- `*.edge.test.ts` — Edge cases (empty data, transfers, month boundaries)

**Integration tests:**
- `tests/api/server.test.ts` — Real HTTP server, real `http.get()` requests
- `tests/api/server-auth.test.ts` — Bearer token auth + rate limiting
- `tests/orchestrator/report-orchestrator.test.ts` — Full pipeline (mock deps)

**E2E validation:**
- `tests/reports/e2e-output.test.ts` — Cross-report consistency from real snapshot
- `tests/reports/golden-inline.test.ts` — Golden-file snapshots for all 8 report types
- `tests/whatsapp/dispatch-fuzz.test.ts` — 56 adversarial inputs (injection, Unicode, etc.)

**Shared helpers** in `tests/_helpers/`:
- `snapshot-loader.ts` — Load real snapshot JSON fixtures
- `mock-date.ts` — Freeze time for deterministic tests
- `constants.ts` — Shared test constants

**Real fixtures** in `tests/examples/`:
- `snapshot-june-12.json` — Actual uma.moe snapshot data

---

## Deployment

### PM2 (Recommended for Windows)

PM2 runs the bot as a background service with auto-restart, crash recovery, and boot persistence.

```bash
npm run pm2:install    # one-time: install PM2 + pm2-windows-startup
npm run pm2:start      # build + start as background service
npm run pm2:logs       # view logs
npm run pm2:stop       # stop the service
npm run pm2:restart    # rebuild + restart
```

**ecosystem.config.js** configures:
- Single instance (no clustering — the bot has WebSocket state)
- Auto-restart on crash
- Memory limit: 500MB (safety net, not expected usage)
- Logs: `data/logs/pm2-error.log`, `data/logs/pm2-out.log`
- `NODE_ENV=production`

**Boot persistence:** `pm2-windows-startup` registers PM2 as a Windows service. The bot starts automatically on system boot.

**Save process list:** `pm2 save` is called automatically by `pm2:start`. This persists the process list so PM2 knows what to restart on boot.

### Docker

```bash
npm run build                    # compile TypeScript
docker build -t uma-club-bot .   # build image
docker run -d --name uma-bot \
  -v "$(pwd)/data:/app/data" \
  -v "$(pwd)/config.yaml:/app/config.yaml" \
  --env-file .env \
  uma-club-bot
```

**Why volume mounts:** Session data (`data/auth/`) and config must persist across container restarts. Snapshots (`data/snapshots/`) are cached to avoid re-fetching.

**Health check:** Dockerfile includes a health check hitting `http://127.0.0.1:3000/health` every 30 seconds.

### Direct

```bash
npm install
npm run build
npm start
```

Uses `data/bot.pid` for process management (`npm run stop`).

**Limitation:** No auto-restart on crash. No boot persistence. The terminal must stay open. Use PM2 or Docker for production.

---

## Design Decisions

The following design choices are intentional. They have been reviewed and accepted during the codebase audit. Do not flag these as issues in future reviews.

### Rate limiter Map is unbounded (`api/server.ts:55`)
The `requestTimestamps` Map is never pruned. This is acceptable because the API binds exclusively to `127.0.0.1` — only loopback IPs (127.0.0.1, ::1) can reach it. The Map will have at most 2 entries. If the API is ever exposed beyond localhost, add periodic pruning.

### WA_SESSION_DIR is not path-sanitized (`whatsapp/client.ts:139`)
The `WA_SESSION_DIR` env var is used directly as a filesystem path. This is acceptable because the env var is set by the bot operator for their own deployment. An attacker who controls environment variables already has process-level access and doesn't need path traversal.

### Security headers are minimal (`api/server.ts:32-34`)
The API sets `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, and `Cache-Control: no-store, no-cache`. HSTS and X-XSS-Protection are omitted because the API serves only JSON (no HTML), binds to localhost, and has no browser-rendered content.

### Runtime stats use module-level mutable state (`runtime.ts:21-39`)
The `stats` object is a module-level singleton. `getRuntimeStats()` returns a shallow copy with the array field deep-copied. This is the standard Node.js pattern for a single-process application. No reset mechanism is needed because the bot is a long-running process.

### Logger uses synchronous file I/O (`utils/logger.ts:183,189`)
`appendFileSync` is called on every log line. This is acceptable at the current scale (~100 log lines per report cycle). If throughput increases significantly, switch to a buffered async writer with periodic flush.

### Catch-up persistence has a narrow window (`scheduler/catchup.ts:217-233`)
After sending a combined catch-up report, the combined run is saved (line 221), then individual type records are written (lines 223-232), then saved again (line 233). A crash between lines 221 and 233 would lose individual records. This window is ~10ms (two synchronous DB operations + one writeFileSync). The 30-second auto-save interval also persists pending records. Real-world risk is negligible.

### computeRollingAverage excludes zero-gain days (`data/daily-fans.ts:249`)
The `gain > 0` filter is explicitly documented in the JSDoc. This computes "average when active" rather than "average over time." The downstream alert threshold (`performanceDrop.thresholdPercent`) should be tuned to account for this behavior. This is a design choice, not a bug.

### Ghost detection edge case (`reports/compute.ts:90-104`)
Transfer members with low gain could theoretically be misclassified as "left" when `ghostCount` exceeds the number of true zero-gain members. With real data (34 members, ghostCount=4), this doesn't manifest — transfer members always sort above ghosts. The edge case exists but requires `ghostCount > (zero-gain members + stale members)`.

### WhatsApp client is a large file (`whatsapp/client.ts`, 635 lines)
The file handles connection lifecycle, QR auth, reconnection, heartbeat, message caching, and send logic. These concerns are inherently coupled to Baileys' state machine — `connect()` modifies `this.sock`, `this.connectionState`, `this.reconnectAttempts`, and `this.messageCache` within nested closures. Splitting would increase cross-module coupling without reducing complexity. Revisit if connection-related bugs recur or Baileys upgrades require touching this logic.
