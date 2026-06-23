# Fix Execution Schedule

## Branch Strategy
- No branching — all fixes applied directly to working tree (single-developer project)
- Verify after each wave with `npm run lint:check && npm test`

## Execution Waves

### Wave 1 (Quick Wins — Trivial + Simple)
1. **Fix 7: Console.error monkey-patch** — `src/whatsapp/client.ts` (Trivial, ~3 lines)
2. **Fix 8: Dockerfile config exposure** — `Dockerfile` (Trivial, 1 line)
3. **Fix 3: API auth + error leak** — `src/api/server.ts` (Simple, ~30 lines)

### Wave 2 (Moderate — cross-cutting fixes)
4. **Fix 1: Monthly pipeline** — `src/utils/timezone.ts`, `src/whatsapp/dispatch.ts`, `src/reports/monthly.ts`, `src/index.ts`, `src/orchestrator/report-orchestrator.ts` (Moderate)
5. **Fix 2: Catch-up alerts** — `src/orchestrator/report-orchestrator.ts`, `src/index.ts`, `src/alerts/alerts.ts` (Moderate)
6. **Fix 4: Reversed dependency** — `src/data/snapshot.ts`, `src/orchestrator/report-orchestrator.ts` (Moderate)
7. **Fix 5: Dispatch registry** — new `src/reports/registry.ts`, `src/whatsapp/dispatch.ts`, `src/orchestrator/report-orchestrator.ts`, `src/reports/compute.ts`, `src/alerts/alerts.ts`, `src/reports/tier.ts` (Moderate)

### Verification
- After Wave 1: `npm run lint:check && npm test`
- After Wave 2: `npm run lint:check && npm test`
