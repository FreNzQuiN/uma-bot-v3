# Fix Execution Schedule

## Branch Strategy
- Branch prefix: fix/
- Base branch: main
- Merge strategy: sequential (one branch merged before next starts)

## Execution Waves

### Wave 1 (Quick Wins — Trivial fixes)
- **Branch:** fix/cor-001-saveconfig-temp-file
  - Findings: saveConfig temp file collision (MEDIUM)
  - Files: src/config.ts
  - Verify: npm test
  - Effort: Trivial

- **Branch:** fix/maint-001-console-error-logger
  - Findings: console.error bypasses structured logger (MEDIUM)
  - Files: src/db/database.ts
  - Verify: npm test
  - Effort: Trivial

- **Branch:** fix/maint-002-dataday-naming
  - Findings: dataDay naming ambiguity (MEDIUM)
  - Files: src/reports/daily.ts, stats.ts, monthly.ts
  - Verify: npm test
  - Effort: Trivial

### Wave 2 (Simple fixes)
- **Branch:** fix/cor-002-combined-report-alerts
  - Findings: Combined report alert processing gap (MEDIUM)
  - Files: src/index.ts, tests/orchestrator/report-orchestrator.unit.test.ts
  - Verify: npm test
  - Effort: Simple
  - Depends on: None

- **Branch:** fix/perf-001-database-dirty-flag
  - Findings: Database auto-save exports WASM blob (MEDIUM)
  - Files: src/db/database.ts
  - Verify: npm test
  - Effort: Simple
  - Depends on: None

- **Branch:** fix/arch-001-unused-db-param
  - Findings: Unused `db` parameter in 6 report generators (MEDIUM)
  - Files: src/reports/daily.ts, weekly.ts, monthly.ts, bottom.ts, stats.ts, tier.ts, registry.ts
  - Verify: npm test
  - Effort: Simple
  - Depends on: None

- **Branch:** fix/arch-002-help-text-hardcoded
  - Findings: Help text admin commands hardcoded (MEDIUM)
  - Files: src/whatsapp/dispatch.ts
  - Verify: npm test
  - Effort: Simple
  - Depends on: None

- **Branch:** fix/arch-003-re-exports-formatDateWIB
  - Findings: reports/format.ts re-exports formatDateWIB (MEDIUM)
  - Files: src/reports/format.ts, src/reports/*.ts
  - Verify: npm test
  - Effort: Simple
  - Depends on: None

- **Branch:** fix/maint-003-identical-toggle-handlers
  - Findings: handleCatchUp and handleAlerts are identical (MEDIUM)
  - Files: src/whatsapp/admin.ts
  - Verify: npm test
  - Effort: Simple
  - Depends on: None

### Wave 3 (Moderate fixes)
- **Branch:** fix/arch-004-monthly-prefetch-duplication
  - Findings: Monthly pre-fetch logic duplicated (MEDIUM)
  - Files: src/index.ts, src/orchestrator/report-orchestrator.ts, src/whatsapp/dispatch.ts
  - Verify: npm test
  - Effort: Moderate
  - Depends on: None

### Wave 4 (Tests)
- **Branch:** fix/test-001-combined-report-alert-test
  - Findings: No test for combined report alert gap (MEDIUM)
  - Files: tests/orchestrator/report-orchestrator.unit.test.ts
  - Verify: npm test
  - Effort: Simple
  - Depends on: fix/cor-002-combined-report-alerts

- **Branch:** fix/test-002-saveconfig-temp-file-test
  - Findings: No test for saveConfig temp file collision (MEDIUM)
  - Files: tests/config.unit.test.ts
  - Verify: npm test
  - Effort: Simple
  - Depends on: fix/cor-001-saveconfig-temp-file

## Execution Order

```
Wave 1 (Trivial) ──► Wave 2 (Simple) ──► Wave 3 (Moderate) ──► Wave 4 (Tests)
```

## Verification

After each wave:
1. Run `npm run lint:check` — type check
2. Run `npm test` — all tests pass
3. Manual review of changed files

After all waves:
1. Run full test suite
2. Check for regressions
3. Update documentation if needed