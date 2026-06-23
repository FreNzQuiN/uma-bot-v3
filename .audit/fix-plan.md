# Fix Plan

## Summary
- Total findings: 27
- Fix clusters: 8
- Estimated effort: 2 Trivial, 3 Simple, 2 Moderate, 1 Complex

## Priority Queue (sorted by Priority Score descending)

### Fix 1: Monthly report pipeline (3 findings)
- Priority Score: 2.10
- Findings resolved: 3
  - `src/whatsapp/dispatch.ts:269` — pre-fetch calculates wrong month (HIGH)
  - `src/reports/monthly.ts:44-60` — silent wrong-month fallback (HIGH)
  - `src/index.ts:279, dispatch.ts:268, report-orchestrator.ts:273` — offset calculation duplicated (MEDIUM)
- Root cause: Monthly offset logic is copy-pasted in 3 locations with inconsistent base dates. `dispatch.ts` uses `snapshot.members[0]` while `monthly.ts` and `report-orchestrator.ts` use `getDataDateComponents()`.
- Fix approach: Extract `getTargetMonth(curYear, curMonth, offset)` utility to `utils/timezone.ts`. Replace all 3 copies. Add warning when fallback triggers in `monthly.ts`.
- Files affected: `src/utils/timezone.ts`, `src/whatsapp/dispatch.ts`, `src/reports/monthly.ts`, `src/index.ts`, `src/orchestrator/report-orchestrator.ts`
- Effort: Moderate (5 files, shared utility extraction)
- Dependencies: None
- Verification: `npm run lint:check && npm test`

### Fix 2: Catch-up alert delivery (3 findings)
- Priority Score: 2.10
- Findings resolved: 3
  - `src/orchestrator/report-orchestrator.ts:231` — alerts never marked 'sent' (HIGH)
  - `src/orchestrator/report-orchestrator.ts:85-104, index.ts:337-353` — alert delivery duplicated (MEDIUM)
  - `src/alerts/alerts.ts:194-211` — quiet hours permanent suppression (MEDIUM)
- Root cause: `markAlertSent()` is inside `if (!options?.collectAlerts)` block, so catch-up alerts stay 'pending' forever. The catch-up path also reimplements delivery instead of calling `orchestrator.deliverAlerts()`.
- Fix approach: After aggregated catch-up alert message is delivered in `index.ts:337-353`, mark all delivered alerts as 'sent'. Refactor catch-up to use `orchestrator.deliverAlerts()`. Change quiet hours to record status `'suppressed'` instead of `'sent'`.
- Files affected: `src/orchestrator/report-orchestrator.ts`, `src/index.ts`, `src/alerts/alerts.ts`, `src/db/database.ts` (add 'suppressed' status)
- Effort: Moderate (4 files, cross-cutting)
- Dependencies: None
- Verification: `npm run lint:check && npm test`

### Fix 3: API authentication + error leak (2 findings)
- Priority Score: 1.20 (auth) + 1.20 (error leak)
- Findings resolved: 2
  - `src/api/server.ts:104-193` — no authentication (HIGH)
  - `src/api/server.ts:227` — error messages leaked (HIGH)
- Root cause: API server was designed for localhost-only use but has no auth. Error handler returns raw error messages.
- Fix approach: Add bearer token auth from `API_TOKEN` env var. Replace error leak with generic message + server-side logging.
- Files affected: `src/api/server.ts`
- Effort: Simple (single file, clear pattern)
- Dependencies: None
- Verification: `npm run lint:check && npm test`

### Fix 4: Reversed dependency data → API (1 finding)
- Priority Score: 0.60
- Findings resolved: 1
  - `src/data/snapshot.ts:13` — data layer imports API layer (HIGH)
- Root cause: `ensureMonthSnapshot` in `snapshot.ts` takes `UmaMoeClient` as parameter, creating a data→API dependency.
- Fix approach: Move `ensureMonthSnapshot` to `orchestrator/report-orchestrator.ts` or a new `data/ensure-snapshot.ts` service. `snapshot.ts` keeps only file I/O.
- Files affected: `src/data/snapshot.ts`, `src/orchestrator/report-orchestrator.ts` (or new file), `src/index.ts`
- Effort: Moderate (move function, update callers)
- Dependencies: None
- Verification: `npm run lint:check && npm test`

### Fix 5: Report dispatch registry (2 findings)
- Priority Score: 1.40
- Findings resolved: 2
  - `src/whatsapp/dispatch.ts:360-411, src/orchestrator/report-orchestrator.ts:168-178` — duplicated dispatch (MEDIUM)
  - `src/alerts/alerts.ts:11` — alerts → reports/tier coupling (MEDIUM)
- Root cause: Report type → generator mapping exists in 2 switch statements. `computeTierData` lives in reports/tier but is used by alerts.
- Fix approach: Create `reports/registry.ts` mapping type strings to generators. Move `computeTierData` to `reports/compute.ts`.
- Files affected: `src/reports/registry.ts` (new), `src/whatsapp/dispatch.ts`, `src/orchestrator/report-orchestrator.ts`, `src/reports/compute.ts`, `src/alerts/alerts.ts`, `src/reports/tier.ts`
- Effort: Moderate (new file + refactor)
- Dependencies: None
- Verification: `npm run lint:check && npm test`

### Fix 6: Error leak in /groups (1 finding)
- Priority Score: 1.20
- Findings resolved: 1 (included in Fix 3 above, but listed separately for tracking)
- Note: Merged with Fix 3 (API auth)

### Fix 7: Console.error monkey-patch (1 finding)
- Priority Score: 0.70
- Findings resolved: 1
  - `src/whatsapp/client.ts:52-68` — suppresses security-relevant errors (MEDIUM)
- Root cause: Global monkey-patch permanently drops libsignal errors.
- Fix approach: Route suppressed messages through `log.debug()` instead of dropping entirely.
- Files affected: `src/whatsapp/client.ts`
- Effort: Trivial (3-line change)
- Dependencies: None
- Verification: `npm run lint:check && npm test`

### Fix 8: Dockerfile config exposure (1 finding)
- Priority Score: 0.70
- Findings resolved: 1
  - `Dockerfile:38` — config.yaml baked into image layer (MEDIUM)
- Root cause: `COPY config.yaml ./` embeds admin JIDs in permanent image layer.
- Fix approach: Remove `COPY config.yaml ./`. Document runtime mount in README.
- Files affected: `Dockerfile`
- Effort: Trivial (1-line removal)
- Dependencies: None
- Verification: `docker build` succeeds without config.yaml in image

## Dependency Graph

```
Fix 1 (monthly pipeline) ─── no dependencies ──→ can start immediately
Fix 2 (catch-up alerts)  ─── no dependencies ──→ can start immediately
Fix 3 (API auth)         ─── no dependencies ──→ can start immediately
Fix 4 (reversed dep)     ─── no dependencies ──→ can start immediately
Fix 5 (dispatch registry) ── no dependencies ──→ can start immediately
Fix 7 (console.error)    ─── no dependencies ──→ can start immediately
Fix 8 (Dockerfile)       ─── no dependencies ──→ can start immediately

All fixes are independent — no blocking dependencies between them.
```

## Effort Summary

| Fix | Findings | Effort | Files |
|-----|----------|--------|-------|
| Fix 1: Monthly pipeline | 3 | Moderate | 5 |
| Fix 2: Catch-up alerts | 3 | Moderate | 4 |
| Fix 3: API auth + error leak | 2 | Simple | 1 |
| Fix 4: Reversed dependency | 1 | Moderate | 3 |
| Fix 5: Dispatch registry | 2 | Moderate | 6 |
| Fix 7: Console.error | 1 | Trivial | 1 |
| Fix 8: Dockerfile | 1 | Trivial | 1 |
| **Total** | **13** | | **~15 files** |
