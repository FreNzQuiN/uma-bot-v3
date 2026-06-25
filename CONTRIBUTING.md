# Contributing to Uma Club Bot v3

## Quick Start

```bash
git clone <repo-url> && cd uma-club-automation-v3
npm install
cp config.example.yaml config.yaml   # edit with your circle details
npm run dev                           # start in dev mode
```

## Before You Commit

```bash
npm run lint:check && npm test
```

Both must pass. No exceptions.

## Code Conventions

### TypeScript

- **Strict mode** is enabled. No `any` unless absolutely unavoidable.
- Target ES2022, module CommonJS.
- Use named exports. Default exports only for classes.
- Types live in `src/types/index.ts`. Shared across all modules.
- **Immutable by default.** Config objects are never mutated — `updateConfig()` returns a new object.

### Naming

- Files: `kebab-case.ts` (e.g., `daily-fans.ts`)
- Functions: `camelCase` (e.g., `generateDailyReport`)
- Types/Interfaces: `PascalCase` (e.g., `ComputedMember`)
- Constants: `UPPER_SNAKE_CASE` (e.g., `ADMIN_COMMANDS`)
- Test files: `<name>.test.ts` in `tests/` mirroring `src/` path

### Error Handling

- Never swallow errors. Log them and propagate or return failure state.
- Use structured logging: `log.info('Module', 'Message', context)`.
- Module names are first argument: `'Bot'`, `'Config'`, `'Scheduler'`, `'Report'`, `'API'`, etc.

### Code Documentation

Comment depth follows a tiered system. The goal: explain **why**, not **what**. Code explains what it does; comments explain why it does it that way.

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
- Document: algorithms with non-obvious logic, edge cases the caller needs to know, business rules encoded in code, ambiguous parameter meanings.
- Skip: self-explanatory getters, simple transformations where name + types say everything, `@param` that just restates the parameter name.
- Test: *If you can guess what the function does and its edge cases from the name and signature alone, skip the JSDoc.*

```typescript
// ✓ Good — explains the algorithm contract
/**
 * Compute the daily gain for a given 1-indexed day.
 *
 * Gain = dailyFans[day-1] - dailyFans[day-2]
 * Both current and previous must be positive → return the difference.
 * Current positive but previous is 0, missing, or negative → return 0 (baseline).
 */
export function getDailyGain(...): number { ... }

// ✓ Good — explains non-obvious behavior
/**
 * Split a message into parts that fit within maxLength.
 * Uses a two-pass approach: chunk content, then prepend "Part X/Y" markers.
 */

// ✗ Bad — restates the code
/**
 * Sort members by monthly gain in descending order.
 */
const sorted = [...members].sort((a, b) => b.monthlyGain - a.monthlyGain);
```

**Tier 3 — Inline comments (only for "why"):**
- Good: `"Guard: empty members"`, `"Ghost detection via member_count"`, `"Compute gains for the SPECIFIC offset day, not the latest"`.
- Bad: restating what the next line does.

**Don't retrofit.** When touching a file, bring its documentation to the same depth as `data/daily-fans.ts` for non-trivial logic. Don't rewrite files you're not changing.

### Anti-AI-Slop Comment Rules

These rules catch comments that look like they were generated, not written. If a comment follows an AI pattern, delete it.

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
Section dividers are noise. The file-level JSDoc already describes the module's purpose. If you need visual separation, use a single blank line. Function names and blank lines provide enough structure.

**Redundant "what" comments — don't:**
```typescript
// ✗ Bad — restates what the next line does
// Create directories recursively if they don't exist
fs.mkdirSync(dir, { recursive: true });

// ✗ Bad
// Save to disk
saveSnapshot(snapshot, dataDay, resolvedRoot);

// ✗ Bad
// Handle incoming messages
sock.ev.on('messages.upsert', ...);

// ✓ Good — explains WHY, not WHAT
// Write to temp file then rename for atomicity.
// This prevents corrupt files if the process crashes mid-write.
const tmpPath = filePath + '.tmp';
```

**Phase/step comments — don't (usually):**
```typescript
// ✗ Bad — just labels the obvious
// --- Performance drop ---
if (config.alerts.performanceDrop.enabled) { ... }

// ✗ Bad
// --- Phase 2: Batch pre-fetch existing keys (1 query instead of N) ---
// Phase labels are useful only when they explain a performance or architectural decision.
// "1 query instead of N" is good. "Phase 2" alone is not.
```

**The "would a human write this?" test:**

Before writing any comment, ask:
1. **Would a human developer write this comment?** If not, don't write it.
2. **Does the code already say this?** If yes, delete the comment.
3. **Does this explain WHY?** If yes, keep it. If it only explains WHAT, delete it.
4. **Is this a workaround for a library bug?** If yes, explain the bug and link to it.
5. **Is this documenting a business rule?** If yes, keep it — but write it in plain language.

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
npm test                              # all tests
npx jest tests/reports/daily/daily.unit.test.ts  # single file
npx jest -t "test name pattern"       # single test
npm run test:coverage                 # with coverage report
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

## Key Gotchas for Contributors

| Gotcha | Detail |
|--------|--------|
| **No `dist/` in git** | Run `npm run build` before `npm start`. `npm run dev` works without building. |
| **PM2 runs from `dist/`** | `ecosystem.config.js` points to `dist/index.js`. Always `npm run build` before `pm2:start` or `pm2:restart`. |
| **PM2 uninstall** | `pm2:uninstall` stops + removes the bot + disables Windows startup. `pm2:uninstall:full` also removes PM2 globally. |
| **sql.js, not sqlite3** | Uses in-memory WASM SQLite. No native compilation needed. DB file is a binary blob. |
| **Baileys doesn't clean up** | Tests use `--forceExit --detectOpenHandles` because Baileys sockets don't close cleanly. |
| **Windows paths** | `npm run restart` uses `timeout /t 2 >nul` (Windows syntax). |
| **Snapshot immutability** | Never mutate saved snapshots. Reports recompute from the array each time. |
| **daily_fans negatives** | Negative values indicate club transfers, not data corruption. Use `abs()`. |
| **Month boundaries** | Monthly reports use offset=-1 (previous month). Don't hardcode current month. |
| **Message splitting** | WhatsApp 4096-char limit. Long reports split at newline boundaries. |
| **User-facing language** | Indonesian (`id`). Bot responses, reports, alerts — all in Bahasa Indonesia. |
| **All times are WIB** | Asia/Jakarta (UTC+7). uma.moe data updates at ~22:00 WIB daily. |

## Architecture Decisions

See `docs/architecture.md` for system design and data flow.
See `docs/configuration.md` for config reference.
See `docs/message-design.md` for the Bourbon persona and message formatting rules.
See `AGENTS.md` for a concise architecture overview.

## Reporting Issues

When reporting a bug, include:

1. What you expected to happen
2. What actually happened
3. Steps to reproduce
4. Relevant log output (set `logging.level: debug` in config.yaml)
5. Snapshot date and circle ID (if applicable)

## What Not to Do

- Don't add new dependencies without discussion. The dependency list is intentionally small.
- Don't modify `config.yaml` format without updating `config.example.yaml` and `docs/configuration.md`.
- Don't change WhatsApp message format without updating `docs/message-design.md`.
- Don't delete tests without approval. Flaky tests should be fixed, not removed.
