# Uma Club Bot v3

WhatsApp bot for Uma Musume club leaders. Tracks member performance, sends automated reports, and provides tier intelligence from uma.moe data.

**What it does:** Replaces manual tracking of ~30 members' fan progress. Leaders check uma.moe once a day, mentally compare numbers, and decide who's meeting the 20M monthly requirement. The bot does this automatically and sends the result to WhatsApp.

**Who it's for:** Circle leaders who need to know who's contributing, who's falling behind, and whether the club is promoting or demoting.

**Core insight:** Everything is arithmetic on one array. uma.moe gives you a `daily_fans` array — 32 cumulative integers, one per day. Daily gain, weekly gain, monthly gain, who's stale, who's below requirement — all different math on the same data.

---

**Verify before committing:** `npm run lint:check && npm test`

---

## How It Works

Single Node.js process. No microservices, no cache layer. One process handles WhatsApp (Baileys), HTTP API, cron scheduling, and report generation. Data processing is arithmetic on arrays of ~34 integers. uma.moe data is static for 24h. Splitting adds friction without benefit.

**Key constraint:** The bot runs intermittently (on/off at unpredictable intervals). It must detect missed reports on restart and send catch-up reports tagged `*⚠️ Catch-up*`.

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
| **Baileys doesn't clean up** | Tests use `--forceExit` because Baileys sockets don't close cleanly. |
| **User-facing language** | Indonesian (`id`). All reports, alerts, and bot responses. |
| **All times are WIB** | Asia/Jakarta (UTC+7). uma.moe data updates at ~22:00 WIB. |
| **Message splitting** | WhatsApp 4096-char limit. Long reports split at newline boundaries. |

---

## Product Context

See `docs/uma-moe-api.md` for the uma.moe API documentation.
See `docs/game-context.md` for Uma Musume game information.
See `docs/architecture.md` for system design (What) and Core Decision (Why).
See `docs/message-design.md` for the Bourbon persona and message formatting.
See `docs/configuration.md` for full config reference.
See `tests/examples/snapshot-june-12.json` for real snapshot data example.

# IMPORTANT for Agents

## Code Conventions

### TypeScript

- **Strict mode** is enabled. No `any` unless absolutely unavoidable.
- Target ES2022, module CommonJS.
- Use named exports. Default exports only for classes.
- Types live in `src/types/index.ts`. Shared across all modules.
- **Immutable by default.** Config objects are never mutated.

### Naming

- Files: `kebab-case.ts` (e.g., `daily-fans.ts`)
- Functions: `camelCase` (e.g., `generateDailyReport`)
- Types/Interfaces: `PascalCase` (e.g., `ComputedMember`)
- Constants: `UPPER_SNAKE_CASE` (e.g., `ADMIN_COMMANDS`)
- Test files: `<name>.test.ts` in `tests/` mirroring `src/` path

### Error Handling

- Never swallow errors. Log them and propagate or return failure state.
- No stack trace errors leakage. Always write helpful error message.
- Use structured logging: `log.info('Module', 'Message', context)`.
- Module names are first argument: `'Bot'`, `'Config'`, `'Scheduler'`, `'Report'`, `'API'`, etc.

### Code Documentation

Comment follows a tiered system. Eliminate **what**, only explain **why**. Comments explain why it does it that way.

**Tier 1 — File block comment (every file):**
```typescript
/**
 * Daily fans calculation helpers for the Uma Club Bot's core data model.
 *
 * The core data is a `daily_fans` array — 32 cumulative integers
 * representing each day's total fans for one member in a month.
 */
```

**Tier 2 — Function JSDoc (only when the signature doesn't tell the story):**
- Document: non-obvious algorithm logic, edge cases, business rules encoded in code, ambiguous code.
- Skip: self-explanatory getters, simple transformations where name + types say everything, `@param` that just restates the parameter name.
- Test: *Skip the JSDoc if you can guess what the function does and its edge cases from the name and signature alone.*

```typescript
 // Sort members by monthly gain in descending order.
const sorted = [...members].sort((a, b) => b.monthlyGain - a.monthlyGain);
// ✗ Bad — restates the code

/**
 * Compute the daily gain for a given 1-indexed day.
 *
 * Gain = dailyFans[day-1] - dailyFans[day-2]
 * Both current and previous must be positive → return the difference.
 * Current positive but previous is 0, missing, or negative → return 0 (baseline).
*/
export function getDailyGain(...): number { ... }
// ✓ Good — explains the algorithm contract

/**
 * Split a message into parts that fit within maxLength.
 * Uses a two-pass approach: chunk content, then prepend "Part X/Y" markers.
 */
// ✓ Good — explains non-obvious behavior
```

**Tier 3 — Inline comments (only for "why"):**
- Good: `"Guard: empty members"`, `"Ghost detection via member_count"`.
- Bad: restating what the code does.

### Anti-AI-Slop

These rules catch comments that look like they were generated, not written. Delete comment that follows AI pattern.

**Section divider comments — don't:**
```typescript
// ✗ Bad — AI separator pattern
// ============================================================
// Zod schema for validation
// ============================================================

// ✗ Bad — another AI separator pattern
// ── Delivery ──────────────────────────────────────────────

// ✓ Good — use blank lines instead, or nothing at all
```
Section dividers are noise. The file-level JSDoc already describes the module's purpose. Use a single blank line.

**Redundant "what" comments — don't:**
```typescript
// Create directories recursively if they don't exist
fs.mkdirSync(dir, { recursive: true });
// ✗ Bad — restates what the next line does

// Save to disk
saveSnapshot(snapshot, dataDay, resolvedRoot);
// ✗ Bad

// Write to temp file then rename for atomicity.
// This prevents corrupt files if the process crashes mid-write.
const tmpPath = filePath + '.tmp';
// ✗ Bad — explains WHY, but still too obvious and long
 
// Prevents corrupt files if the process crashes mid-write.
const tmpPath = filePath + '.tmp';
// ✓ Good — explains WHY, eliminate WHAT
```

**"would a human write this?":**

Before writing any comment, ask:
1. **Would a human developer write this comment?** If not, don't write it.
2. **Does the code already say this?** If yes, delete the comment.
3. **Does this explain WHY?** If it explains WHAT, delete it. If yes, rewrite it to be more compact.
4. **Is this documenting a business rule?** If yes, rewrite it in plain language.

**Summary of rules:**
1. **No section dividers.** Use blank lines.
2. **No "what" comments.** The code says what it does.
3. **"Why" comments only.** Explain reasoning, not actions.
4. **No phase labels** unless they explain a performance decision.
5. **Write like a human.** No AI filler ("The following function...", "This method is responsible for...").
6. **No restating parameter names.** `@param snapshot - The snapshot data` is noise.
7. **Keep comments that explain non-obvious behavior**, workarounds, or business rules.

### Config

- All config validated with Zod at load time. Invalid config throws immediately.
- Config is hot-reloaded every 5s via mtime polling.
- `saveConfig()` does atomic write (write to `.tmp`, then rename).
- Never mutate config objects. Use `updateConfig()` which returns a new validated copy.

### Tests

- Framework: Jest + ts-jest.
- Test structure mirrors `src/`: `src/reports/daily.ts` → `tests/reports/daily/daily.unit.test.ts`.
- Test categories: `*.unit.test.ts` (logic), `*.format.test.ts` (output), `*.dispatch.test.ts` (integration), `*.edge.test.ts` (edge cases), `*.stale.test.ts` (stale data).
- Shared helpers in `tests/_helpers/` (snapshot loader, mock date, constants).
- Real fixture data in `tests/examples/` (actual uma.moe snapshots).
- Coverage thresholds: 70% branches, 80% functions/lines/statements.
- Coverage excludes: `src/index.ts`, `src/types/**`, `src/api/uma-moe.ts`.

```bash
npm test
npx jest tests/reports/daily/daily.unit.test.ts
npx jest -t "test name pattern"
npm run test:coverage
```

## Making Changes

### 1. Create a Branch

```bash
git checkout -b feature/my-change
```

### 2. Write Tests First (Preferred)

The project uses test-driven development for new features and bug fixes:

- **RED:** Write a failing test that describes expected behavior.
- **GREEN:** Write the minimum code to make it pass.
- **REFACTOR:** Clean up while keeping tests green.

### 3. Implement

Follow existing patterns. Read neighboring files for style reference.

### 4. Verify

```bash
npm run lint:check && npm test
```

### 5. Commit

Use clear, descriptive commit messages:

```
Add weekly report stale data detection

- Detects when weekly data is 3+ days behind
- Shows warning in report header
- Adds stale threshold to config (staleAfterDaysWeekly)
```

## Reporting Issues

When reporting a bug, include:

1. What you expected to happen
2. What actually happened
3. Steps to reproduce
4. Relevant log output
5. Snapshot date and circle ID (if applicable)

## What Not to Do

- Don't add new dependencies without discussion. Kept dependency list small.
- Don't modify `config.yaml` format without updating `config.example.yaml` and `docs/configuration.md`.
- Don't change WhatsApp message format without updating `docs/message-design.md`.
- Don't delete tests without approval. Flaky tests should be fixed, not removed.
