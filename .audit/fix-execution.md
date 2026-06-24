# Fix Execution Plan

## Batch 1: Trivial fixes (config + database + reports)
- Branch: fix/batch-001-trivial
- Fixes:
  1. saveConfig temp file collision — src/config.ts:227 — change flag 'wx' to 'w'
  2. console.error bypasses logger — src/db/database.ts:65,75 — replace with log.error
  3. dataDay naming ambiguity — src/reports/daily.ts:38, stats.ts:34, monthly.ts:93 — rename variables
- Total estimated diff: ~20 lines
- Verify: npm run lint:check && npm test

## Batch 2: Simple fixes (reports + whatsapp)
- Branch: fix/batch-002-simple-reports
- Fixes:
  1. Unused db parameter — src/reports/daily.ts, weekly.ts, monthly.ts, bottom.ts, stats.ts, tier.ts — remove db param
  2. re-exports formatDateWIB — src/reports/format.ts:13 — remove re-export, update imports
  3. identical toggle handlers — src/whatsapp/admin.ts:157-193 vs 199-234 — extract helper
- Total estimated diff: ~50 lines
- Verify: npm run lint:check && npm test

## Batch 3: Simple fixes (whatsapp + orchestrator)
- Branch: fix/batch-003-simple-dispatch
- Fixes:
  1. help text hardcoded — src/whatsapp/dispatch.ts:190-199, 210-219 — generate from ADMIN_COMMANDS
  2. monthly pre-fetch duplication — src/index.ts, orchestrator.ts, dispatch.ts — extract helper
- Total estimated diff: ~80 lines
- Verify: npm run lint:check && npm test

## Isolated Fix 1: Combined report alert processing gap
- Branch: fix/cor-002-combined-report-alerts
- Finding: Combined report alert processing gap (MEDIUM)
- Files: src/index.ts, tests/orchestrator/report-orchestrator.unit.test.ts
- Verify: npm run lint:check && npm test
- Depends on: None

## Isolated Fix 2: Database auto-save dirty flag
- Branch: fix/perf-001-database-dirty-flag
- Finding: Database auto-save exports WASM blob (MEDIUM)
- Files: src/db/database.ts
- Verify: npm run lint:check && npm test
- Depends on: None

## Isolated Fix 3: Tests for fixes
- Branch: fix/tests-001-regression-tests
- Findings: No test for combined report alert gap, No test for saveConfig temp file collision
- Files: tests/orchestrator/report-orchestrator.unit.test.ts, tests/config.unit.test.ts
- Verify: npm run lint:check && npm test
- Depends on: Isolated Fix 1, Batch 1