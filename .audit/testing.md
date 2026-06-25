# Testing Audit Findings

## Summary
10 findings: 0 CRITICAL, 2 HIGH, 5 MEDIUM, 3 LOW

## Findings

### [HIGH] Port conflict causes flaky test failure between server integration tests
- File: `tests/api/server.integration.test.ts:251` and `tests/api/server-auth.integration.test.ts:9`
- What: Both test files use port 18767 — `FAIL_DB_PORT = 18767` in server.integration.test.ts and `PORT = 18767` in server-auth.integration.test.ts. When Jest runs them in the same worker, the second server fails to bind with `EADDRINUSE`, causing a test failure observed during this review.
- Why: The test suite currently has 1 flaky failure (1/1632 tests). This erodes confidence in CI and masks real regressions. The error message (`listen EADDRINUSE: address already in use 127.0.0.1:18767`) is non-obvious, making it hard for contributors to diagnose.
- How: Change `FAIL_DB_PORT` in `tests/api/server.integration.test.ts:251` to a unique port (e.g., `18769`) that doesn't collide with any other test file. Alternatively, use port `0` for all test servers to let the OS assign free ports dynamically.
- Confidence: HIGH

### [HIGH] No regression test for weekly/monthly stale detection offset bug
- File: `tests/reports/weekly/weekly.stale.test.ts` (entire file)
- What: The correctness audit found a HIGH-severity bug where `isStaleForReport` uses the snapshot's latest data day instead of the viewed week's end day when computing stale zero-gain counts for offset reports (`/weekly -1`). No test in the suite exercises this code path — `weekly.stale.test.ts` only tests `offset=0` and one `offset=1` case that checks stale warning text, not stale member sections.
- Why: The bug silently produces incorrect stale member lists for any weekly or monthly report viewed with a non-zero offset. Without a regression test, the fix (when applied) cannot be verified, and the bug could re-emerge.
- How: Add a test in `tests/reports/weekly/weekly.stale.test.ts` that constructs a snapshot where a member was active in week N but inactive in week N+1. Call `generateWeeklyReport` with `offset=-1` and verify the stale section reflects week N's activity, not the full month tail. Same pattern needed for `tests/reports/monthly/monthly.stale.test.ts`.
- Confidence: HIGH

### [MEDIUM] No regression test for daily stale warning showing false alarm on offset reports
- File: `tests/reports/daily/daily.stale.test.ts`
- What: The daily stale test file tests stale warnings for `offset=0`, `offset=1`, and `offset=2`, but all three cases assert the stale warning IS present. None of the tests verify the correctness bug where `offset > 0` reports incorrectly show "Data mungkin tidak terbaru" for historical days that have complete data.
- Why: When the bug fix is applied (using `adjustedDataDay` instead of `latestDataDay`), there's no test to verify that offset reports no longer show false staleness warnings. The existing tests would need to be updated too.
- How: Add a test case: mock the current date to June 15, use the real snapshot (data through day 11), and verify that `generateDailyReport(snapshot, config, members, -3)` (viewing day 12) does NOT show the stale warning. This requires modifying `makeSnapshotWithLatestDay` or using a different snapshot construction.
- Confidence: HIGH

### [MEDIUM] Catch-up regression tests use unmocked `new Date()` making them date-dependent
- File: `tests/scheduler/catchup-regression.test.ts:31,68,112`
- What: Three tests in `catchup-regression.test.ts` call `new Date()` to get the current day for computing "last weekly run" and "last monthly run" dates. Unlike other test files that use `mockCurrentDate()` from `_helpers`, these tests operate against the real system clock.
- Why: The tests could produce different results depending on when they run. If run on day 29-31, the "most recent weekly scheduled day" calculation may behave differently than on day 8. On day 1, the monthly test's `if (todayDay >= 1)` guard is always true but still adds unnecessary conditional logic.
- How: Use `mockCurrentDate(2026, 6, 15)` from `tests/_helpers` instead of `new Date()` to make tests deterministic. This also eliminates the need for the `if (todayDay >= ...)` guards.
- Confidence: MEDIUM

### [MEDIUM] Config hot-reload watcher is untested
- File: `src/index.ts:132-198`
- What: The config hot-reload mechanism (5-second mtime polling, content hash comparison, config reload, scheduler restart) has zero test coverage. This is approximately 67 lines of code with non-trivial branching (schedule diff detection, error handling).
- Why: A bug in the watcher could cause the bot to silently ignore config changes or crash on malformed YAML. Since the watcher is the only way to change configuration at runtime (other than restart), this is a meaningful gap.
- How: Create `tests/config-watcher.unit.test.ts` with mocked `fs.watchFile`/`fs.statSync` to verify: (1) config reloads when mtime changes, (2) scheduler restarts when schedule config changes, (3) no restart when non-schedule config changes, (4) error logging when YAML is invalid.
- Confidence: MEDIUM

### [MEDIUM] Orchestrator unit test mocks detectAlerts at module level, masking behavior
- File: `tests/orchestrator/report-orchestrator.unit.test.ts:353-357`
- What: The `detectAlerts` mock is declared at module scope (line 353: `const mockDetectAlerts = jest.fn().mockResolvedValue([])`) with `jest.mock` at line 354. This applies to ALL tests in the file, including `deliverReport`, `deliverAlerts`, `generateReportString`, and `generateCombinedReport` describe blocks that run before the mock setup at line 352.
- Why: While the mock defaults to returning `[]` (harmless for most tests), it makes it impossible to test `sendReport` end-to-end with real alert detection. Any future test that accidentally relies on real `detectAlerts` behavior will silently get the mocked version.
- How: Move the `jest.mock` and mock variable to a nested `describe('processAlertsForReport')` block, or use `jest.spyOn` on a per-test basis for better isolation. Alternatively, document explicitly that all tests in this file use the mock.
- Confidence: MEDIUM

### [LOW] Scheduler tests access private internals via `as any` casts
- File: `tests/scheduler/scheduler.unit.test.ts:226,244,331,374,399`
- What: Five test cases access `(scheduler as any).recordAndSend` to invoke private methods. This creates tight coupling to the Scheduler class's internal structure.
- Why: If `recordAndSend` is renamed or refactored, all five tests break even if the public behavior is unchanged. The `as any` cast also suppresses TypeScript checks, hiding potential type mismatches.
- How: Either expose `recordAndSend` as a public (or `@internal`) method if it's intentionally testable, or test through the public `start()` API by triggering the cron callback. The existing `detectCollision` tests already use the public API correctly.
- Confidence: MEDIUM

### [LOW] No test for runtime.ts module-level singleton
- File: `src/runtime.ts` (93 lines, no corresponding test file in `tests/`)
- What: `runtime.ts` tracks uptime, reconnect count, and message counts via module-level mutable state. Despite being a leaf module with no dependencies, it has zero dedicated tests.
- Why: While the module is simple (93 lines, mostly getters/setters), the `trackReconnect()` and `trackMessage()` functions mutate shared state. A regression in the getter pattern (e.g., shallow-copy returning a stale reference) would go undetected.
- How: Create `tests/utils/runtime.unit.test.ts` testing: (1) `getStats()` returns expected initial values, (2) `trackReconnect()` increments counter, (3) `trackMessage()` increments counter, (4) `getStats()` returns a copy (not a reference to internal state).
- Confidence: MEDIUM

### [LOW] e2e-output.test.ts depends on config.yaml existing on disk
- File: `tests/reports/e2e-output.test.ts:33`
- What: The test calls `loadConfig()` which reads `config.yaml` from the project root. If the file doesn't exist (fresh clone, CI environment), it falls back to defaults. This means the "actual formatted output" tests are actually testing against default config, not the production config.
- Why: If a production config has different values (e.g., different `requirements.monthlyFans`, different `message` settings), the e2e output would differ between dev and CI environments. The golden-inline tests use `makeConfig()` (defaults), which is more reliable.
- How: Replace `loadConfig()` with `getDefaultConfig()` in `beforeAll` to make the test deterministic and CI-friendly, or use `makeConfig()` from `_helpers` for consistency with golden-inline tests.
- Confidence: LOW

### [POSITIVE] Exceptional test infrastructure and coverage breadth
- File: `tests/_helpers/index.ts` (221 lines), `tests/` (67 suites, 1632 tests)
- What: The test suite demonstrates exceptional quality: shared helpers eliminate duplication, tests mirror source structure, regression tests are co-located with bug history, golden-inline snapshots catch formatting regressions, 56 adversarial fuzz inputs test security boundaries, and coverage exceeds all thresholds (84% statements, 70% branches, 83% functions).
- Why: This is a textbook test architecture for a medium-sized Node.js project. The consistent patterns (real fixture snapshot, mock DB for unit tests, real SQLite for integration, port-isolated API servers) show deliberate design. The regression test naming convention (`*-regression.test.ts`) with bug context in descriptions makes it easy to understand what each test prevents.
- How: Maintain this standard. The only structural improvement would be adding the missing regression tests identified in this audit.
- Confidence: HIGH

## Modules Reviewed
- Reports (daily, weekly, monthly, ranks, bottom, stats, members, tier, compare, analyze, combined): 2 findings (missing stale offset regression tests)
- Database (SQLite integration, MySQL unit): clean — thorough coverage of both adapters
- Alerts (detection, formatting, dedup, quiet hours): clean — excellent edge case coverage
- Scheduler (collision detection, cron expressions, double-send guard): clean
- Catch-up (detection, execution, maxReportsPerStartup, collision grouping): 1 finding (date-dependent tests)
- WhatsApp (dispatch, fuzz, commands, access, admin): clean — fuzz testing is exemplary
- Orchestrator (deliver, alert processing, sendReport): 1 finding (module-level mock)
- API (server integration, auth integration): 1 finding (port conflict)
- Data layer (snapshot I/O, daily fans arithmetic, ensure-snapshot): clean
- Config (validation, defaults, update, save): clean
- Utils (format, timezone, logger): clean
- Helpers (shared test utilities): clean — well-designed

## Low-Confidence Notes

- [tests/reports/e2e-output.test.ts:80] The test file includes a `generateRanksReport` assertion against 4096-char limit. With the real snapshot (34 members), ranks report is typically short. But with a hypothetical 100+ member club, it could exceed the limit. No test verifies this upper bound.

- [tests/whatsapp/dispatch.test.ts:100] The dispatch tests mock the snapshot but use real `computeMembers`. This is a reasonable boundary, but it means dispatch tests don't catch bugs in `computeMembers` that would affect the dispatch flow. The compute module has its own thorough tests, so this is acceptable.

- [tests/db/mysql-database.unit.test.ts] All MySQL tests are fully mocked (no real MySQL server). This is expected for CI but means MySQL-specific SQL syntax is only tested structurally (string matching), not semantically (actual execution). The SQLite integration tests serve as the semantic correctness baseline.
