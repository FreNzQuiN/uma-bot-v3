# Testing Audit Findings

## Summary
12 findings: 0 CRITICAL, 3 HIGH, 5 MEDIUM, 4 LOW

## Findings

### [HIGH] `runtime.ts` (93 LOC, 11 exports) has zero dedicated test coverage
- File: `src/runtime.ts:1-93`
- What: The `runtime.ts` module exports 11 functions (`getRuntimeStats`, `recordReconnect`, `recordSchedulerRestart`, `recordConfigReload`, `recordMessageReceived/Parsed/Responded/Failed`, `recordSocketCreated`, `recordDisconnect`, `recordConnectionState`, `getUptimeMs`) but has no dedicated test file. `tests/whatsapp/client.test.ts:18-32` mocks the entire module, so runtime functions are never exercised.
- Why: All 11 functions contain logic (counter increments, timestamp recording, array copying in `getRuntimeStats`). A bug in `getRuntimeStats` (e.g., shallow copy of `lastConfigChangeFields` array) would go undetected. The module-level singleton state (`stats` object) is also untested for cross-call accumulation.
- How: Create `tests/utils/runtime.unit.test.ts`. Test each recorder function: call it, then call `getRuntimeStats()` and verify the corresponding field incremented. Test `getRuntimeStats()` returns a copy (mutation of returned object doesn't affect subsequent calls). Test `getUptimeMs()` returns positive value.
- Confidence: HIGH

### [HIGH] No test for Wave 1 correctness finding: combined report alert processing gap
- File: `src/index.ts:279-300`
- What: Wave 1 correctness finding (HIGH) identified that the `onCombinedReport` callback in `src/index.ts:279-300` generates and delivers the combined report but never calls `orchestrator.processAlertsForReport()` for each type in the combined set. The test file `tests/reports/combined.unit.test.ts` only tests `generateCombinedReport()` — it does not test the scheduler → combined → alert pipeline.
- Why: On collision days (daily+weekly at same time), alerts (performance drop, demotion risk, streak break, etc.) are silently lost. This is a correctness bug with no regression test.
- How: Add a test in `tests/scheduler/catchup-regression.test.ts` or `tests/orchestrator/report-orchestrator.unit.test.ts` that verifies when the combined callback fires, `processAlertsForReport` is called for each type in the set. If the bug is fixed, the test should verify the fix; if not, the test documents the gap as a known issue.
- Confidence: HIGH

### [HIGH] No test for Wave 1 correctness finding: `saveConfig` temp file collision after crash
- File: `src/config.ts:226-228`
- What: Wave 1 correctness finding (HIGH) identified that `writeFileSync(tmpPath, raw, { encoding: 'utf-8', flag: 'wx' })` uses exclusive-create flag that throws EEXIST if the temp file exists from a prior crash. `tests/config.unit.test.ts:301-323` tests `saveConfig` round-trip but never tests crash recovery. No test creates an orphaned `.tmp` file and verifies `saveConfig` still succeeds.
- Why: After a crash, all admin commands that modify config (`/setreq`, `/catchup`, `/alerts`) silently fail until the operator manually deletes `config.yaml.tmp`. Without a regression test, the fix (if applied) could be accidentally reverted.
- How: Add a test that: (1) creates `config.yaml.tmp` on disk, (2) calls `saveConfig(config, path)`, (3) verifies it succeeds (either by cleaning up the tmp file first or by using `flag: 'w'`). Also verify the resulting `config.yaml` is valid.
- Confidence: HIGH

### [MEDIUM] `ensure-snapshot.ts` (66 LOC) has no dedicated test coverage
- File: `src/data/ensure-snapshot.ts:1-66`
- What: This module bridges the data layer and API layer, implementing cache-or-fetch logic for month snapshots. It is imported by `orchestrator/report-orchestrator.ts` and `src/index.ts`. No test file exists for it. The orchestrator test mocks `saveSnapshot` and `ensureMonthSnapshot` but never exercises the actual caching logic.
- Why: The module handles the critical path of "do we have this month's data or do we need to fetch it?" — wrong behavior means either unnecessary network calls or missing data for reports.
- How: Create `tests/data/ensure-snapshot.unit.test.ts`. Test: (1) returns existing snapshot without fetching, (2) calls fetch when snapshot doesn't exist, (3) saves fetched snapshot to disk, (4) handles fetch failure gracefully.
- Confidence: MEDIUM

### [MEDIUM] Dispatch test assertions verify command routing but not report content correctness
- File: `tests/whatsapp/dispatch.test.ts:163-252`
- What: All report command tests (`/daily`, `/weekly`, `/monthly`, `/ranks`, `/stats`, `/bottom`, `/members`, `/tier`) assert only that `sendOrEdit` was called twice and the output contains a keyword like `'Daily'` or `'Weekly'`. None verify the actual report content (correct member counts, correct gain values, correct date formatting).
- Why: A report generator could return completely wrong data (wrong club name, wrong calculations, missing members) and the dispatch tests would still pass, as long as the output contains the word "Daily". The dispatch tests give false confidence in the end-to-end flow.
- How: At minimum, add one integration-level assertion per report type: e.g., for `/daily`, verify the output contains the club name from the snapshot (`'Hol＿Horse'` or the test fixture name). This catches the case where report generation is wired up but produces empty or wrong output.
- Confidence: MEDIUM

### [MEDIUM] Scheduler tests access private methods via `(scheduler as any).recordAndSend`
- File: `tests/scheduler/scheduler.unit.test.ts:229,247,334,364,402`
- What: Multiple tests bypass the public API by accessing private `recordAndSend` via TypeScript `any` cast. This tests internal implementation details rather than observable behavior (cron callbacks firing correctly).
- Why: If the internal method is renamed or its signature changes, tests break without any behavioral change. Conversely, if the public API (`start()`) behavior changes but `recordAndSend` stays the same, tests pass incorrectly.
- How: For the "daily-disabled collision handling" tests, verify the observable outcome: the `onReport` callback is or isn't called when the scheduler's cron would fire. For the "double-send guard" tests, record a successful run and call `start()` — verify `onReport` isn't called again. If private method access is unavoidable, add a comment explaining why.
- Confidence: MEDIUM

### [MEDIUM] `config.unit.test.ts` does not test `deepMerge` prototype pollution guard
- File: `src/config.ts:198-201`, `tests/config.unit.test.ts`
- What: Wave 1 security finding (MEDIUM) identified that `deepMerge` doesn't guard against `__proto__`, `constructor`, or `prototype` keys. The config tests verify `updateConfig` deep-merges correctly but never test with dangerous keys.
- Why: If a guard is added (as recommended by Wave 1), there's no test to verify it works. If the guard is later removed accidentally, there's no test to catch the regression.
- How: Add a test: `updateConfig(getDefaultConfig(), { __proto__: { polluted: true } })` — verify that `Object.prototype.polluted` is undefined afterward.
- Confidence: MEDIUM

### [LOW] `scheduler.unit.test.ts` CatchUpManager tests use `getDataDate()` which depends on real time
- File: `tests/scheduler/scheduler.unit.test.ts:322,349,391`
- What: Tests like "skips sending if report already sent today" call `getDataDate()` to get the current date, then record a run for that date. If the test runs across a JST midnight boundary (00:00-07:00 UTC), the date could shift mid-test, causing flakiness.
- Why: Non-deterministic test failures that depend on when the test runs. The test might pass at 22:00 UTC but fail at 06:00 UTC.
- How: Use `jest.useFakeTimers()` and `jest.setSystemTime()` to fix the date, matching the pattern already used in `tests/alerts/alerts.unit.test.ts:301-306`.
- Confidence: HIGH

### [LOW] No test for `whatsapp/client.ts` reconnection and heartbeat logic
- File: `src/whatsapp/client.ts:130-400`, `tests/whatsapp/client.test.ts`
- What: `client.test.ts` tests `isConnected`, `getConnectionState`, `sendMessage`, `sendOrEdit`, and `disconnect`, but does not test the connection lifecycle: `connect()`, reconnection on disconnect, heartbeat timeout handling, or the `suppressLibsignalErrors` global monkey-patch.
- Why: The reconnection logic includes retry backoff, state transitions, and error handling that are untested. A bug in reconnection could cause the bot to stop recovering from network failures.
- How: Since `connect()` involves Baileys WebSocket, mocking is necessary. Test: (1) after `connect()`, state transitions to 'open', (2) after mock disconnect event, `recordReconnect` is called, (3) connection state updates correctly through transitions. The monkey-patch suppression is lower priority.
- Confidence: MEDIUM

### [LOW] `combined.unit.test.ts` does not test `generateCombinedReport` with `monthly` type in list
- File: `tests/reports/combined.unit.test.ts:52-57`
- What: The test for `types=["monthly"]` verifies the output matches `generateMonthlyReport(snapshot, config, computedMembers, -1, db)`, but there's no test for a combination like `['daily', 'weekly', 'monthly']` (all three types together) or `['daily', 'monthly']`. The "joins multiple reports" test only covers `['daily', 'weekly']`.
- Why: The combined report with monthly type has special offset logic (`-1` for previous month). A three-type combination could produce unexpectedly long output or interaction between the daily/weekly and monthly sections.
- How: Add a test for `['daily', 'monthly']` and `['daily', 'weekly', 'monthly']` combinations. Verify they produce the correct join of individual reports.
- Confidence: MEDIUM

### [LOW] `data/member-history.ts` has no dedicated test file
- File: `src/data/member-history.ts:1-103`
- What: This module tracks member join/leave events by diffing snapshots against DB state. It's tested indirectly via `tests/reports/compute.unit.test.ts:374-492` (DB cross-check section), but the module's own logic (transaction handling, snapshot diffing, status assignment) has no dedicated tests.
- Why: The `updateMemberHistory` function contains branching logic for: new members (INSERT), existing members with name changes (UPDATE), members no longer in snapshot (mark as left), and transfer detection. The indirect tests only verify the `computeMembers` output, not the DB writes themselves.
- How: Create `tests/data/member-history.unit.test.ts`. Test: (1) new members are inserted, (2) existing members are updated, (3) members missing from snapshot are marked 'left', (4) transaction rollback on error.
- Confidence: MEDIUM

### [POSITIVE] Golden-file inline snapshots catch report output regressions across all 8 report types
- File: `tests/reports/golden-inline.test.ts:1-386`
- What: The golden-file tests use `toMatchInlineSnapshot()` to capture the exact formatted output of all 8 report types (daily, weekly, monthly, ranks, bottom, stats, members, tier) against the real June 12 snapshot fixture.
- Why: This is the strongest regression defense for report output. Any change to formatting, calculations, member sorting, or message structure will cause a snapshot mismatch, forcing the developer to review the diff and update the snapshot intentionally. This catches bugs that unit-level assertions (like `toContain('Daily')`) would miss.
- How: No change needed — maintain this pattern. When report output legitimately changes, run `npx jest tests/reports/golden-inline.test.ts -u` to update snapshots.

### [POSITIVE] Adversarial fuzz testing with 56 inputs across 6 attack categories
- File: `tests/whatsapp/dispatch-fuzz.test.ts:54-167`
- What: The dispatch fuzz test exercises 56 adversarial inputs across injection (SQL, command, XSS), Unicode tricks, malformed messages, boundary conditions, encoding attacks, and protocol abuse. Each input is verified to never crash the handler.
- Why: WhatsApp bots are high-attack-surface — users can send arbitrary text. This test suite verifies the bot never crashes, leaks data, or executes injected commands, regardless of what text is received.
- How: No change needed — this is excellent security testing. Consider adding fuzz inputs for the `compare` and `analyze` member name resolution paths as well.

## Modules Reviewed
- `src/runtime.ts`: 1 finding (HIGH — zero test coverage)
- `src/data/ensure-snapshot.ts`: 1 finding (MEDIUM — zero test coverage)
- `src/data/member-history.ts`: 1 finding (LOW — no dedicated test file)
- `src/config.ts`: 2 findings (HIGH — temp file collision, MEDIUM — prototype pollution)
- `src/index.ts`: 1 finding (HIGH — combined report alert gap)
- `src/whatsapp/dispatch.ts`: 1 finding (MEDIUM — weak content assertions)
- `src/whatsapp/client.ts`: 1 finding (LOW — reconnection untested)
- `src/scheduler/scheduler.ts`: 2 findings (MEDIUM — private method access, LOW — time-dependent tests)
- `src/reports/combined.ts`: 1 finding (LOW — missing combo tests)
- `tests/` (general): 2 positives (golden files, fuzz tests)

## Low-Confidence Notes

- [src/index.ts:306-329] The catch-up flow after WhatsApp connection runs concurrently with scheduler startup. No test verifies there's no race condition between catch-up report delivery and the first scheduled report firing. The dedup via `getLastSuccessfulRun` in the scheduler should prevent double-sends, but the timing window is untested.

- [jest.config.js:9-11] Coverage exclusions (`src/index.ts`, `src/types/**`, `src/api/uma-moe.ts`) are appropriate for unit tests, but there's no integration-level test that exercises the `index.ts` startup sequence. The exclusion is documented as intentional.

- [tests/reports/e2e-output.test.ts:34] `loadConfig()` is called without a path, which uses the real `config.yaml` if present or defaults. If `config.yaml` doesn't exist in the test environment, tests use defaults — which may differ from production config values. This could cause golden-file mismatches between environments.
