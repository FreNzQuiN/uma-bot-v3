# Wave Plan

## Codebase Metrics
- **Size:** Small (40 files, 7,883 LOC)
- **Modules:** 10 (core, data, api, reports, scheduler, whatsapp, alerts, db, utils, types)
- **Deterministic findings:** Clean (0 type errors, 1571 tests passing, no lint warnings)

## Wave 1: Architecture + Security + Correctness (COMPLETE)
**Results:**
- Architecture: 10 findings (2 HIGH, 5 MEDIUM, 3 LOW)
- Security: 6 findings (3 MEDIUM, 3 LOW)
- Correctness: 10 findings (2 HIGH, 5 MEDIUM, 3 LOW)
- **Total: 26 findings**

## Wave 2: Performance + Maintainability + Testing
**Scope:** Quality dimensions, narrowed by Wave 1 findings
- Performance: N+1 queries, unbounded ops, blocking I/O, resource leaks
- Maintainability: Duplication, function size, complexity, dead code
- Testing: Coverage gaps, test isolation, mock boundaries

## Risk Map (Updated after Wave 1)
- **HIGH risk:** config.ts, index.ts, dispatch.ts (multiple findings)
- **MEDIUM risk:** reports/compute.ts, reports/monthly.ts, reports/stats.ts, api/server.ts, db/database.ts, alerts/alerts.ts
- **LOW risk:** utils/*, types/*, runtime.ts, scheduler/*, whatsapp/client.ts, whatsapp/commands.ts, whatsapp/access.ts, data/daily-fans.ts, data/snapshot.ts, data/ensure-snapshot.ts, data/member-history.ts

## Dispatch Strategy
- Wave 2: 3 parallel dispatches (performance, maintainability, testing)
- Max 3 total dispatches in Wave 2

## Gate Check
- After Wave 2: Read all dimension files, proceed to Phase 2.5