# Adversarial Validation

## Summary
- Total findings reviewed: 36
- CONFIRMED (kept as-is): 18
- DOWNGRADED (severity reduced): 7
- REJECTED (false positive): 3
- UNVERIFIABLE (can't confirm or deny): 0
- Already POSITIVE: 4 (kept as-is)

---

## Rejected Findings (False Positives)

### [Architecture] "Duplicated report dispatch at 3 locations" — actually 2, not 3
- Original file: `.audit/architecture-review.md` finding #2
- Original severity: HIGH
- Reason for rejection: The audit claims a "third implicit dispatch" in `index.ts` (lines 270-293) for combined reports. Reading `index.ts:270-293`, the combined handler calls `orchestrator.generateCombinedReportString()` which delegates to `reports/combined.ts`. There is no switch statement in `index.ts` — the third "dispatch" doesn't exist. The real duplication is between `dispatch.ts:360-411` and `report-orchestrator.ts:168-177` (2 locations, not 3). The claim of 3 locations inflates the finding.
- Evidence: `index.ts:270-293` calls `orchestrator.generateCombinedReportString(types, ...)` — no switch on report type. `reports/combined.ts` handles the type routing internally.

### [Correctness] "isStaleMember is dead code" — used in tests
- Original file: `.audit/correctness.md` finding #9
- Original severity: LOW
- Reason for rejection: The finding states `isStaleMember` is "exported but never imported or called by any source file." While technically true for `src/`, `isStaleMember` IS imported and used extensively in 5 test files (`tests/data/daily-fans.test.ts`, `tests/reports/ranks.test.ts`, `tests/reports/daily/daily.unit.test.ts`, `tests/reports/daily/daily.dispatch.test.ts`, `tests/reports/daily/daily.format.test.ts`, `tests/reports/stats.test.ts`). It serves as a utility for computing expected stale status in test assertions. Calling test-support code "dead code" is misleading — it has callers, just not in production.
- Evidence: `tests/data/daily-fans.test.ts:8` imports it; lines 477-517 have a full test suite for it. `tests/reports/ranks.test.ts:26,85,106,445` uses it for expected value computation.

### [Architecture] "runtime.ts module-level mutable state with no reset" — by design
- Original file: `.audit/architecture-review.md` finding #10
- Original severity: LOW
- Reason for rejection: `runtime.ts` is a singleton stats counter for a single-process bot. Module-level state is the standard Node.js pattern for this. The "no reset mechanism" concern is about test isolation, but the bot is a long-running process — runtime stats are never expected to reset. The `getRuntimeStats()` already returns a shallow copy (line 42), which prevents external mutation. This is a style preference, not an architecture issue.
- Evidence: `runtime.ts:41-43` — `getRuntimeStats()` returns a copy with deep-copied array field. The entire module is 93 lines with a single concern (runtime counters).

---

## Downgraded Findings

### [Security] Rate limiter Map grows unbounded
- Original severity: MEDIUM
- New severity: LOW
- Reason: The API binds exclusively to `127.0.0.1` (verified at `server.ts:87`). The only IPs that can hit it are loopback addresses (`127.0.0.1`, `::1`). The Map will have at most 2 entries (IPv4 and IPv6 loopback). The finding itself acknowledges "the practical risk is low." The memory concern is theoretical — even with 1 million entries of `string[]`, it's a few MB at most. The finding also proposes a fix (pruning), which is good hygiene, but LOW severity is appropriate for localhost-only.

### [Correctness] computeRollingAverage excludes zero-gain days
- Original severity: HIGH
- New severity: MEDIUM
- Reason: The function's JSDoc (line 228-231) explicitly documents: "Only counts days where gain can be computed (both current and previous positive)." This is a deliberate design choice to compute "average when active" rather than "average over time." The audit's own LOW-CONFIDENCE note acknowledges this may be intentional. The test suite (`daily-fans.test.ts:525-600`) has extensive tests verifying this behavior — the tests pass, meaning the tests were written to match this exact behavior. A design choice with passing tests should not be rated HIGH. The downstream concern about alert sensitivity is valid but is a configuration tuning issue (adjust `thresholdPercent`), not a code defect.

### [Correctness] Ghost detection can misclassify transfer members
- Original severity: HIGH (within finding body) → already self-corrected to MEDIUM
- New severity: MEDIUM (keeping the finding's own downgrade)
- Reason: The real snapshot data (34 members, member_count=30, ghostCount=4) shows the 4 ghosts ARE correctly classified as left — verified by `compute.test.ts:213-247`. The transfer members (Zero, TheTengOne, Sairen, VitoHoow, Ceciria, Falkrum) all have positive monthlyGain and sort above the zero-gain ghosts. The edge case where ghostCount exceeds the number of true zero-gain members exists in theory but doesn't manifest with real data. The finding's own LOW-CONFIDENCE note explains why stale members (0 gain) fill the bottom before transfer members.

### [Architecture] whatsapp/client.ts is a god module
- Original severity: HIGH
- New severity: MEDIUM
- Reason: 634 lines with many concerns is a valid architecture observation, but this is a single-process WhatsApp bot, not an enterprise system. The "responsibilities" listed (connection, messaging, reconnection, cache) are inherently coupled — reconnection depends on connection state, which depends on auth state. Splitting would increase cross-module coupling without reducing complexity. The architecture-review itself correctly notes "monkey-patch at lines 52-68 is a global side effect" which is a separate valid concern. Calling this a "god module" at HIGH severity overstates the impact for a single-process bot.

### [Architecture] Duplicated report generation dispatch (3→2 locations)
- Original severity: HIGH
- New severity: MEDIUM
- Reason: As noted in Rejected above, this is 2 locations not 3. While DRY violations are real maintenance concerns, both switch statements are small (10 cases each), have identical structure, and serve different contexts (command dispatch vs. orchestrator). A report registry is a nice improvement but HIGH severity implies defect-level risk. Adding a new report type requires updating 2 locations — that's a maintenance cost, not a defect.

### [Correctness] catchup.ts combined report persistence gap
- Original severity: MEDIUM
- New severity: LOW
- Reason: The gap between `this.db.save()` at line 218 and line 230 requires the process to crash in a ~10ms window (time to execute a `for` loop with `recordRun` calls + one more `writeFileSync`). sql.js's in-memory save + `writeFileSync` are fast. The finding's own LOW-CONFIDENCE note says "catch-up completes in seconds, making the window very small." Additionally, `db.save()` at line 230 is called immediately after the loop, so the window is even narrower. Real-world risk is negligible.

### [Security] WA_SESSION_DIR env var without sanitization
- Original severity: MEDIUM
- New severity: LOW
- Reason: This env var is set by the bot operator for their own deployment. The attack scenario requires an attacker to (1) control the bot's environment variables, and (2) set `WA_SESSION_DIR` to a sensitive directory. But an attacker with env var control already has process-level access — they could just read `config.yaml` directly. The validation proposed (checking the path is within project directory) is good hygiene but the threat model doesn't hold.

---

## Confirmed Findings

### Security — kept at original severity

**[HIGH] API server has no authentication** — `src/api/server.ts:104-193`
- The handleRequest method has zero auth checks. Bound to localhost, but Docker EXPOSE or port-forward extends to network.

**[HIGH] Error messages leaked in /groups response** — `src/api/server.ts:227`
- `handleGroups()` catch block returns `(error as Error).message` directly. The outer `.catch()` at line 125-128 correctly uses 'Internal server error', but the inner catch at line 227 leaks the original error. If `handleGroups` catches internally, the error message reaches the response.

**[MEDIUM] Dockerfile bakes config.yaml into image layer** — `Dockerfile:38`
- `COPY config.yaml ./` embeds admin JIDs and group identifiers in a permanent image layer.

**[MEDIUM] console.error monkey-patching suppresses errors permanently** — `src/whatsapp/client.ts:52-68`
- Global, process-lifetime monkey-patch of console.error. Well-documented but inflexible — no runtime disable flag.

**[LOW] saveConfig non-exclusive temp file** — `src/config.ts:226-228`
- Predictable `.tmp` path, no exclusive creation flag. Requires local symlink attack.

**[LOW] Log injection via user message content** — `src/whatsapp/dispatch.ts:134`, `src/whatsapp/client.ts:338`
- User-controlled text interpolated into log lines without newline sanitization.

**[POSITIVE] SQL injection fully mitigated** — `src/db/database.ts` (all query methods)
- All queries use `?` parameterized placeholders. No string interpolation.

### Correctness — kept at original severity

**[HIGH] Catch-up alerts never marked as 'sent'** — `src/orchestrator/report-orchestrator.ts:231-236`
- CONFIRMED BUG: When `collectAlerts=true`, alerts are recorded with `status: 'pending'` but the `markAlertSent()` call at line 234 is inside the `if (!options?.collectAlerts)` block. After the catch-up flow in `index.ts:337-353` delivers the aggregated alert message, there is NO call to mark those alert IDs as sent. They remain 'pending' in the DB. On the next report cycle, `isAlertAlreadySent()` returns false (checks `status='sent'`), so the same alerts are detected, recorded (idempotent — returns existing ID), and delivered a second time.
- Evidence: `database.ts:228-231` — `isAlertAlreadySent` queries `WHERE status = ?` with `'sent'`. `report-orchestrator.ts:231` — `markAlertSent` only called when `!options?.collectAlerts`. `index.ts:337-353` — aggregated alerts sent but never marked.

**[HIGH] dispatch.ts monthly pre-fetch calculates wrong target month** — `src/whatsapp/dispatch.ts:269-275`
- Uses `snapshot.members[0]` year/month to compute target, but `monthly.ts:47` and `report-orchestrator.ts:275` use `getDataDateComponents()`. When snapshot is stale (from previous month), pre-fetch targets the wrong month.
- Evidence: `dispatch.ts:269`: `const { year: snapYear, month: snapMonth } = snapshot.members[0];` vs `monthly.ts:47`: `const { year: curYear, month: curMonth } = getDataDateComponents();`

**[HIGH] Monthly report silently shows wrong month** — `src/reports/monthly.ts:44-60`
- When offset>0 and no previous-month snapshot exists, falls back to current snapshot with no warning. User receives a report labeled "Mei 2026" that contains June data.

**[MEDIUM] Quiet hours permanently suppress alerts** — `src/alerts/alerts.ts:194-211`
- Confirmed: alerts recorded with `status: 'sent'` during quiet hours (line 204), preventing re-fire. Architecture doc acknowledges this is intentional, but the finding correctly identifies the tradeoff — critical alerts (demotion_risk) at 23:01 are permanently silenced.

**[MEDIUM] Database save() blocks event loop** — `src/db/database.ts:384-389`
- `writeFileSync` blocks the event loop. During catch-up of 3+ reports, this delays WhatsApp message delivery between sends.

### Architecture — kept at original severity

**[HIGH] Reversed dependency: data layer imports API layer** — `src/data/snapshot.ts:13`
- `import type { UmaMoeClient } from '../api/uma-moe'` — data persistence module depends on network client. The `type` keyword erases it at compile time, but `ensureMonthSnapshot` (line 390) takes `UmaMoeClient` as a runtime parameter. This makes `snapshot.ts` untestable without mocking the API.

**[MEDIUM] data/snapshot.ts mixes 3 concerns** — `src/data/snapshot.ts:1-426`
- Handles JSON file I/O, SQLite member history operations, and HTTP API fetching. The mid-file import at line 206 (`import type { Database }`) confirms this was added later.

**[MEDIUM] Monthly offset calculation duplicated** — `src/index.ts:279-283`, `src/whatsapp/dispatch.ts:268-283`, `src/orchestrator/report-orchestrator.ts:273-290`
- Same `let targetMonth = curMonth - absOffset; while (targetMonth <= 0)` pattern in 3 locations. Note that `dispatch.ts` uses the wrong base (snapshot vs current date — see correctness finding above).

**[MEDIUM] Cross-module coupling: alerts → reports/tier** — `src/alerts/alerts.ts:11`
- `computeTierData` is a pure computation function living in a report module. Alert detection depends on it. Moving to `reports/compute.ts` would be cleaner.

**[MEDIUM] Alert delivery duplicated** — `src/orchestrator/report-orchestrator.ts:85-104`, `src/index.ts:337-353`
- Catch-up flow in `index.ts` reimplements `deliverAlerts()` logic (target resolution + sendMessage loop) instead of calling `orchestrator.deliverAlerts()`.

**[MEDIUM] reports/format.ts grab-bag** — `src/reports/format.ts:1-135`
- Re-exports from `utils/timezone` (line 39-40) and `utils/format` (line 135). 12 dependents import from here when they should import from source modules.

**[MEDIUM] configChanged uses JSON.stringify** — `src/index.ts:42-65`
- Relies on Zod-validated config producing consistent key ordering. Works in practice but is semantically fragile.

**[LOW] logger.ts synchronous file I/O** — `src/utils/logger.ts:183,189`
- `appendFileSync` on every log line. Acceptable at current scale (~100 lines/report cycle).

### Positive findings (kept as-is)

**[POSITIVE] SQL injection fully mitigated** — `src/db/database.ts`
**[POSITIVE] Clean composition root** — `src/index.ts:67-382`
**[POSITIVE] Zero circular dependencies** — codebase-wide
**[POSITIVE] Pure report functions** — `src/reports/*.ts`

---

## Low-Confidence Notes

- [src/reports/compute.ts:93] The ghost detection sort puts ALL members (including transfer members with positive gain) into the candidate pool. The finding about transfer misclassification is theoretically valid, but with real data (ghostCount=4, all 4 true ghosts have 0 gain), transfer members always sort above them. The edge case exists but requires ghostCount > number of zero-gain members.

- [src/data/daily-fans.ts:249] The `gain > 0` filter in `computeRollingAverage` is explicitly documented in the JSDoc. The function computes "average of positive gains" not "average over time." Changing this would alter all downstream alert sensitivity. The finding correctly identifies the downstream impact but frames it as a bug rather than a design choice.

- [src/scheduler/catchup.ts:217-230] The persistence gap between combined run save and individual run save is a real atomicity issue, but the window is extremely narrow (two sequential synchronous DB operations + one writeFileSync). The 30-second auto-save would also persist pending records before the next scheduled report. Risk is negligible in practice.

- [src/api/server.ts:227] The `.catch()` handler at line 125-128 already catches unhandled rejections from `handleGroups()` and returns 'Internal server error'. But `handleGroups()` catches its OWN errors at line 226-228 and returns `(error as Error).message` — so the `.catch()` at line 125 would only trigger if `handleGroups` threw synchronously, which it can't since it's async. The leak at line 227 is the real path for errors.
