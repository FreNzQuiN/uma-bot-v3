# Test Suite Quality Audit

## Summary
- Files reviewed: 55
- Total findings: 14 (0 CRITICAL, 3 HIGH, 6 MEDIUM, 5 LOW)
- Good patterns found: 12

---

## Critical Issues

None found. The test suite has no tests that produce incorrect results or test the wrong behavior fundamentally.

---

## High Issues

### [tests/scheduler/scheduler.unit.test.ts:267-286] Tests access private internals via `as any`
- **What:** Multiple scheduler tests reach into private methods (`recordAndSend`) via `(scheduler as any).recordAndSend` to verify behavior.
- **Why:** These tests are coupled to implementation details. Refactoring the Scheduler's internal structure (e.g., renaming `recordAndSend` or changing how it's invoked) will break tests without changing behavior. The tests verify the condition *outside* the method rather than observing the method's observable effects.
- **How to fix:** Either (a) extract the collision-detection and skip-logic into testable public methods, or (b) test through the `start()` lifecycle by triggering cron callbacks and asserting on `onReport` calls. Alternatively, add a public `testRecordAndSend(type)` method explicitly for testing.

### [tests/scheduler/scheduler.unit.test.ts:306-318] Tests duplicate implementation logic instead of verifying behavior
- **What:** The "weekly handler skips when daily IS enabled" test manually recomputes collision logic (`collidingTypes.includes('daily') && collidingTypes.includes('weekly') && dailyEnabled`) and asserts the raw boolean, rather than testing that the handler actually skips.
- **Why:** The test is verifying *how* the code works (the condition), not *what* it does (the skip). If the implementation changes the condition but preserves the skip behavior, this test breaks for no reason.
- **How to fix:** Test the observable outcome: configure a scheduler with daily+weekly at the same time, fire the weekly handler, and assert that `onReport` was NOT called for 'weekly'.

### [tests/reports/bottom.unit.test.ts:303-321] Tests read source code to check DRY violations
- **What:** Two tests read `src/reports/bottom.ts` source code with `fs.readFileSync` and assert on specific string content (`expect(src).not.toContain('getStaleDataWarning')`).
- **Why:** These tests verify implementation structure, not behavior. They'll fail if someone renames a function or restructures code while preserving correct behavior. They also create a maintenance burden — every refactoring requires updating these tests.
- **How to fix:** Remove these tests. If the concern is that stale warning logic should be centralized, write a behavioral test that verifies the bottom report produces the same stale warning as other reports for the same data.

---

## Medium Issues

### [tests/whatsapp/dispatch.test.ts, daily.dispatch.test.ts, daily.edge.test.ts, etc.] Duplicated `makeConfig` helper across 8+ files
- **What:** Nearly every test file defines its own `makeConfig()` function with slight variations. At least 8 files have independent implementations: `dispatch.test.ts:33`, `daily.dispatch.test.ts:50`, `daily.edge.test.ts:53`, `scheduler.unit.test.ts:13`, `access.test.ts:14`, `admin.test.ts`, `config.unit.test.ts`, and `bottom.unit.test.ts:31`.
- **Why:** When the BotConfig type or defaults change, multiple files need manual updates. The variations (e.g., some override `groups`, some override `admins`) make it hard to know which version is canonical.
- **How to fix:** The `_helpers/index.ts` already exports `makeConfig`. Migrate all test files to import from `_helpers` and add override parameters there as needed.

### [tests/whatsapp/dispatch.test.ts, daily.dispatch.test.ts] Duplicated `makeMessage` and `makeMockDb` helpers
- **What:** `makeMessage()` is copy-pasted identically in `dispatch.test.ts:107` and `daily.dispatch.test.ts:66`. `makeMockDb()` appears in `dispatch.test.ts:121` and `daily.dispatch.test.ts` (via `_helpers`).
- **Why:** Duplication means inconsistent mock shapes across files — if the mock needs a new method, some files get updated and others don't.
- **How to fix:** Move both to `_helpers/index.ts` and import from there.

### [tests/reports/daily/daily.edge.test.ts:451-467] `restoreDateMocks()` called inside test body instead of `afterEach`
- **What:** The test at line 452 calls `restoreDateMocks()` at the end of the test body (line 466) rather than in an `afterEach` hook. The `afterEach` at line 271 only covers the "Stale warning through dispatch" describe block.
- **Why:** If the test throws before reaching `restoreDateMocks()`, subsequent tests will run with a mocked Date, causing cascading failures that are hard to diagnose.
- **How to fix:** Move `restoreDateMocks()` to the describe-level `afterEach` block, or better yet, to the top-level `afterEach` for this file.

### [tests/reports/stats.unit.test.ts, ranks.unit.test.ts] Repeated snapshot structure assertions across report test files
- **What:** Tests like "has 34 members", "latest data day is 11", "has correct club metadata" appear in at least 5 files: `stats.unit.test.ts:81-96`, `ranks.unit.test.ts:59-72`, `compute.unit.test.ts:33-67`, `bottom.unit.test.ts:86-131`, `members.unit.test.ts:661-688`.
- **Why:** These are verification of the test fixture, not of the code under test. If the fixture changes (e.g., a new snapshot), 5+ files need updates. They add noise to the test output without testing product behavior.
- **How to fix:** Validate fixture structure once in a shared `beforeAll` or in `_helpers`, and remove redundant assertions from individual report tests.

### [tests/data/daily-fans.unit.test.ts] 970-line single file — approaching split threshold
- **What:** At 970 lines, this is the largest test file. It tests 11 different functions in a single file.
- **Why:** While currently well-organized with section comments, the file tests `getLatestDataDay`, `getFirstPositiveDay`, `getDailyGain`, `getWeeklyGain`, `getMonthlyGain`, `isTransferMember`, `isStaleMember`, `computeRollingAverage`, `countActiveDays`, `countConsecutiveZeroDaysAtEnd`, and `isStaleForReport` — all in one file. This makes it harder to find tests for a specific function and increases the blast radius of merge conflicts.
- **How to fix:** Split into per-function test files (e.g., `get-daily-gain.unit.test.ts`, `is-stale-member.unit.test.ts`), following the same pattern used for daily/weekly/monthly reports.

### [tests/alerts/alerts.unit.test.ts:64-92] Test calls `db.markAlertSent(db.recordAlert(...))` — double-wraps recordAlert return value
- **What:** At line 79, `db.markAlertSent` is called with the return value of `db.recordAlert(...)`, but the outer `db.recordAlert` at line 69 also records the same alert. The test records each alert twice (once explicitly, once via the markAlertSent wrapper), then expects deduplication to return 0.
- **Why:** The double-recording obscures the test's intent. It works because of SQLite UNIQUE constraint handling, but the test logic is harder to follow than necessary.
- **How to fix:** Simplify to: (1) record each alert once, (2) mark each as sent, (3) verify dedup returns 0.

---

## Low Issues

### [tests/reports/daily/daily.dispatch.test.ts:157-158, daily.edge.test.ts:129,141,157] "Left section removed" assertion repeated 5+ times across daily test files
- **What:** The assertion `expect(report).not.toContain('🚪 Keluar dari klub:')` appears in `daily.dispatch.test.ts:158`, `daily.edge.test.ts:129`, `daily.edge.test.ts:141`, `daily.edge.test.ts:157`, `daily.edge.test.ts:405`.
- **Why:** This is testing the same invariant repeatedly in different describe blocks. It's not wrong, just redundant — if the left section were accidentally added, one assertion would suffice.
- **How to fix:** Keep one explicit test for this invariant and remove the redundant assertions from other test blocks.

### [tests/reports/daily/daily.edge.test.ts:379] Assertion comment says "34 anggota" should NOT appear, but test also checks `30 anggota` elsewhere
- **What:** Line 381 asserts `expect(report).not.toContain('34 anggota')` — the test verifies the total member count in the contributing line uses 30 (active) not 34 (total).
- **Why:** This is actually correct behavior verification, but the negative assertion is fragile — if the string format changes from "30 anggota" to "30 members", the negative assertion would still pass without catching the real issue.
- **How to fix:** Use a more specific positive assertion like `expect(report).toContain('30 anggota')` instead of the negative one.

### [tests/whatsapp/client.test.ts:180-203] Cache eviction test hardcodes magic numbers
- **What:** The cache eviction test at line 180-203 hardcodes `2000` (MESSAGE_CACHE_MAX), `500` (MESSAGE_CACHE_EVICT), and `1501` (expected size).
- **Why:** If the constants change in production code, this test silently breaks or passes incorrectly. The test is coupled to specific constant values.
- **How to fix:** Import the constants from the source module, or document them as test assumptions with a comment.

### [tests/reports/compare.unit.test.ts:59] `buildMember` uses `Math.random()` for IDs
- **What:** Lines 59-60 use `Math.floor(Math.random() * 1e9)` for `id` and `viewer_id`. The same pattern appears in `analyze.unit.test.ts:51-52`.
- **Why:** While practically safe (1e9 range makes collisions negligible), non-deterministic test data can cause intermittent failures in edge cases and makes tests non-reproducible.
- **How to fix:** Use a counter or fixed values instead of `Math.random()`.

### [tests/reports/formatters.unit.test.ts:303-309] "No English month names" assertion only checks one English word
- **What:** Line 354 only checks `expect(report).not.toContain('June')`.
- **Why:** This is a narrow check. It doesn't catch "January", "February", etc. Though the function uses Indonesian month names and other English months are unlikely to appear, the test gives false confidence.
- **How to fix:** Either expand to check all 12 English month names, or (better) rely on the `formatDateWIB` tests which already verify Indonesian formatting comprehensively.

---

## Good Patterns

### [tests/_helpers/index.ts] Shared test utilities
Centralized `loadRealSnapshot`, `mockCurrentDate`, `restoreDateMocks`, `makeMockDb`, `makeConfig`, and constants (`TRANSFER_NAMES`, `STALE_NAMES`, `WHATSAPP_MAX_LENGTH`). This is the right pattern — shared test infrastructure prevents drift.

### [tests/db/*.test.ts] In-memory SQLite for all DB tests
Every database test uses `new Database(':memory:')` with proper `beforeEach`/`afterEach` cleanup. This gives fast, isolated tests with no filesystem side effects.

### [tests/alerts/alerts.unit.test.ts:316-491] Comprehensive quiet hours edge case testing
The quiet hours tests systematically cover: boundary start, one minute before, during, boundary end, wrap-around midnight, and before wrap-around. This is thorough boundary testing done right.

### [tests/whatsapp/dispatch-fuzz.test.ts] Adversarial input testing
56 fuzz inputs covering injection attempts, Unicode edge cases, null bytes, and malformed commands. This is an unusual and valuable pattern — most test suites skip adversarial testing entirely.

### [tests/reports/golden-inline.test.ts] Golden-file inline snapshots for all 8 report types
Uses Jest's `toMatchInlineSnapshot()` to capture exact output. This catches any formatting regression across all report types in a single file.

### [tests/reports/ranks.unit.test.ts:119-168] Data-driven test generation via loop
Uses `for...of` over `expectedTop10` array to generate individual test cases for each top-10 member. Clean way to test many similar cases without repetition.

### [tests/whatsapp/access.test.ts:120-167] `it.each` for matrix testing
Uses Jest's `it.each` to test admin/report commands × admin/non-admin × command-group/private-chat. Generates many test cases from a compact definition.

### [tests/data/daily-fans.unit.test.ts] Real snapshot data as test fixtures
Uses actual player data (Ryu, Zero, TheTengOne, etc.) with documented properties. Tests are grounded in real-world scenarios, not synthetic data.

### [tests/reports/e2e-output.test.ts] Cross-report consistency validation
Verifies that all 8 report types produce non-empty output, are under 4096 chars, have no Markdown syntax, and use Indonesian labels. Single file catches format regressions across all reports.

### [tests/data/snapshot.integration.test.ts] Comprehensive error path testing
Tests corrupt JSON, empty files, missing fields (circle without members, members without circle), and various file system edge cases. Proper error path coverage.

### [tests/whatsapp/client.test.ts:179-203] Cache eviction behavior test
Tests the actual eviction behavior (size drops from 2000 to 1501 after adding one entry) rather than just checking the cache exists. Verifies the right entries are evicted.

### [tests/scheduler/scheduler.unit.test.ts:351-449] Double-send guard with real DB state
Tests the double-send guard by recording actual DB state and verifying the scheduler respects it. Integration-level test using in-memory SQLite.

---

## Per-File Summary

| File | Lines | Findings | Status |
|------|-------|----------|--------|
| tests/data/daily-fans.unit.test.ts | 970 | 1 (MEDIUM — oversized) | ⚠️ Split recommended |
| tests/reports/stats.unit.test.ts | 868 | 1 (MEDIUM — fixture assertions) | ⚠️ Issues found |
| tests/whatsapp/dispatch.test.ts | 831 | 1 (MEDIUM — duplicated helpers) | ⚠️ Issues found |
| tests/reports/members.unit.test.ts | 792 | 0 | ✅ Clean |
| tests/scheduler/scheduler.unit.test.ts | 758 | 2 (HIGH — private access, impl testing) | ⚠️ Issues found |
| tests/alerts/alerts.unit.test.ts | 691 | 1 (MEDIUM — double recordAlert) | ⚠️ Issues found |
| tests/db/database.integration.test.ts | 590 | 0 | ✅ Clean |
| tests/reports/compute.unit.test.ts | 576 | 0 | ✅ Clean |
| tests/reports/analyze.unit.test.ts | 565 | 0 | ✅ Clean |
| tests/reports/daily/daily.edge.test.ts | 555 | 2 (MEDIUM — restoreDateMocks, LOW — repeated assertions) | ⚠️ Issues found |
| tests/reports/ranks.unit.test.ts | 503 | 1 (LOW — fixture assertions) | ⚠️ Issues found |
| tests/whatsapp/client.test.ts | 499 | 1 (LOW — magic numbers) | ⚠️ Issues found |
| tests/utils/logger.unit.test.ts | 490 | 0 | ✅ Clean |
| tests/orchestrator/report-orchestrator.unit.test.ts | 487 | 0 | ✅ Clean |
| tests/reports/daily/daily.dispatch.test.ts | 477 | 1 (MEDIUM — duplicated helpers) | ⚠️ Issues found |
| tests/data/snapshot.integration.test.ts | 459 | 0 | ✅ Clean |
| tests/reports/bottom.unit.test.ts | 450 | 1 (HIGH — source code reading) | ⚠️ Issues found |
| tests/reports/monthly/monthly.unit.test.ts | 447 | 0 | ✅ Clean |
| tests/reports/weekly/weekly.format.test.ts | 439 | 0 | ✅ Clean |
| tests/reports/monthly/monthly.format.test.ts | 428 | 0 | ✅ Clean |
| tests/reports/compare.unit.test.ts | 425 | 1 (LOW — Math.random) | ⚠️ Issues found |
| tests/whatsapp/commands.test.ts | 413 | 0 | ✅ Clean |
| tests/reports/golden-inline.test.ts | 386 | 0 | ✅ Clean |
| tests/reports/daily/daily.unit.test.ts | 384 | 0 | ✅ Clean |
| tests/reports/daily/daily.stale.test.ts | 354 | 0 | ✅ Clean |
| tests/reports/weekly/weekly.unit.test.ts | 351 | 0 | ✅ Clean |
| tests/data/left-members.unit.test.ts | 345 | 0 | ✅ Clean |
| tests/config.unit.test.ts | 324 | 0 | ✅ Clean |
| tests/api/server.integration.test.ts | 300 | 0 | ✅ Clean |
| tests/reports/formatters.unit.test.ts | 289 | 1 (LOW — narrow assertion) | ⚠️ Issues found |
| tests/reports/daily/daily.format.test.ts | 281 | 0 | ✅ Clean |
| tests/whatsapp/access.test.ts | 267 | 0 | ✅ Clean |
| tests/data/archive.unit.test.ts | 265 | 0 | ✅ Clean |
| tests/reports/weekly/weekly.edge.test.ts | 233 | 0 | ✅ Clean |
| tests/utils/timezone.unit.test.ts | 204 | 0 | ✅ Clean |
| tests/alerts/alerts-regression.test.ts | 200 | 0 | ✅ Clean |
| tests/whatsapp/admin.test.ts | 177 | 0 | ✅ Clean |
| tests/reports/e2e-output.test.ts | 177 | 0 | ✅ Clean |
| tests/api/server-auth.integration.test.ts | 172 | 0 | ✅ Clean |
| tests/scheduler/catchup-regression.test.ts | 171 | 0 | ✅ Clean |
| tests/whatsapp/dispatch-fuzz.test.ts | 167 | 0 | ✅ Clean |
| tests/reports/monthly/monthly.edge.test.ts | 162 | 0 | ✅ Clean |
| tests/reports/e2e-output-regression.test.ts | 159 | 0 | ✅ Clean |
| tests/reports/monthly/monthly.stale.test.ts | 89 | 0 | ✅ Clean |
| tests/db/database-regression.test.ts | 89 | 0 | ✅ Clean |
| tests/data/snapshot-regression.test.ts | 84 | 0 | ✅ Clean |
| tests/reports/weekly/weekly.stale.test.ts | 81 | 0 | ✅ Clean |
| tests/reports/formatters-regression.test.ts | 76 | 0 | ✅ Clean |
| tests/reports/tier-regression.test.ts | 75 | 0 | ✅ Clean |
| tests/reports/combined.unit.test.ts | 74 | 0 | ✅ Clean |
| tests/reports/tier.unit.test.ts | 67 | 0 | ✅ Clean |
| tests/api/uma-moe.unit.test.ts | 37 | 0 | ✅ Clean |
| tests/whatsapp/client-regression.test.ts | 18 | 0 | ✅ Clean |
