# Adversarial Validation

## Summary
- Total findings reviewed: 61 (across 6 audit files; ~10 are cross-file duplicates)
- Unique findings: ~36
- CONFIRMED (kept as-is): 16
- DOWNGRADED (severity reduced): 15
- REJECTED (false positive): 5
- UNVERIFIABLE: 0

## Rejected Findings (False Positives)

### Config YAML deserialization lacks prototype pollution guard
- Original file: `.audit/security.md` (MEDIUM)
- Original severity: MEDIUM
- Reason for rejection: The attack path requires an attacker to write `__proto__` keys into `config.yaml`. The `parseYaml()` output is immediately fed to `validateConfig()` via Zod schema at `config.ts:157`, which only passes through known keys — `__proto__` would be stripped by Zod validation before `deepMerge` is ever called on untrusted input. In `updateConfig()` (`config.ts:198-201`), `deepMerge` runs before `validateConfig`, but the only callers construct config objects programmatically (admin handlers), not from untrusted YAML. The Zod schema at `config.ts:26-122` is the actual trust boundary, and it correctly rejects unknown keys.
- Evidence: `config.ts:156-157` — `parseYaml` output goes directly to `validateConfig(parsed)` which uses Zod `ConfigSchema.parse()`. Zod rejects unknown keys by default.

### computeTierData projectedOutcome overrides HIGH demotion risk with 'promote'
- Original file: `.audit/correctness.md` (MEDIUM)
- Original severity: MEDIUM
- Reason for rejection: The audit claims line 153 overwrites `demotion_risk` unconditionally. Reading the actual code at `compute.ts:152-157`, the guard at line 155 (`else if (projectedOutcome !== 'demotion_risk')`) prevents overwriting demotion_risk with 'stay'. The audit's concern is that line 153 (`projectedOutcome = 'promote'`) overwrites demotion_risk — but this is **intentional design**: if the member is on pace to promote (`currentPace >= requiredPace`), showing "Promote" is the correct projection regardless of buffer risk. The riskLevel ('HIGH') is displayed separately via the risk emoji at `tier.ts:72`. The tier report shows BOTH the risk level AND the outcome — they are independent axes, not contradictory.
- Evidence: `compute.ts:152-157` — line 155 explicitly guards against overwriting demotion_risk with 'stay'. The 'promote' outcome at line 153 is intentional: pace-to-promote supersedes buffer risk. `tier.ts:72` shows `${riskEmoji[tier.riskLevel]} Proyeksi: ${outcomeText[tier.projectedOutcome]}` — both are displayed.

### Help text admin command list diverges from ADMIN_COMMANDS set
- Original file: `.audit/maintainability.md` (HIGH)
- Original severity: HIGH
- Reason for rejection: The audit claims `schedule` is in help text but not in `ADMIN_COMMANDS`. Verifying `access.ts:16-25`, `ADMIN_COMMANDS` includes: setreq, config, status, catchup, alerts, **schedule**, debug, admin. The `schedule` command IS in `ADMIN_COMMANDS`. The help text at `dispatch.ts:197` and admin reference at `dispatch.ts:218` list `/schedule` which IS in `ADMIN_COMMANDS`. The `handleAdminCommand` function at `dispatch.ts:393-465` handles `schedule` at line 429-430. There is NO actual divergence — all listed commands exist in `ADMIN_COMMANDS` and all are handled by `processAdminCommand`. While hardcoded help text could drift in the future, it hasn't — the audit's specific claim of divergence is factually incorrect.
- Evidence: `access.ts:16-25` — ADMIN_COMMANDS includes 'schedule'. `dispatch.ts:218` — help text lists `/schedule`. `dispatch.ts:429` — `case 'schedule'` is handled.

### `runtime.ts` (93 LOC, 11 exports) has zero dedicated test coverage
- Original file: `.audit/testing.md` (HIGH)
- Original severity: HIGH
- Reason for rejection: `runtime.ts` contains 11 trivial functions: counter increments (`stats.reconnectCount++`), timestamp recording (`Date.now()`), array copying (`[...stats.lastConfigChangeFields]`), and `getRuntimeStats()` which returns a shallow copy. These are exercised extensively through `tests/whatsapp/client.test.ts` (mocking and verifying call counts), `tests/scheduler/scheduler.unit.test.ts`, and `tests/whatsapp/dispatch.test.ts`. The functions are single-line operations with no branching logic. Writing dedicated tests for `stats.reconnectCount++` adds no meaningful coverage. The module is 93 lines of simple state management with no edge cases.
- Evidence: `runtime.ts:45-47` — `recordReconnect` is `stats.reconnectCount++; stats.lastReconnectTime = Date.now()`. `runtime.ts:41-42` — `getRuntimeStats` returns a shallow copy. No branches, no edge cases.

### API `/health` endpoint leaks operational details without authentication
- Original file: `.audit/security.md` (LOW — already low, but rejected)
- Original severity: LOW
- Reason for rejection: The API binds to `127.0.0.1` only (`server.ts:89`). The Dockerfile health check only uses the `success` field. The architecture docs at `architecture.md:618` document minimal security headers as an accepted risk for localhost-only APIs. An attacker who can reach loopback already has local process access — operational details are the least of the concerns. The audit itself acknowledges this is "mitigated by localhost-only binding." Not worth flagging.
- Evidence: `server.ts:89` — `this.server.listen(this.port, '127.0.0.1', ...)`. `architecture.md:618` — "Security headers are minimal... Omitted because API serves only JSON, binds to localhost."

## Downgraded Findings

### Bearer token comparison vulnerable to timing side-channel
- Original severity: MEDIUM
- New severity: LOW
- Reason: The API binds exclusively to `127.0.0.1` (`server.ts:89`). A timing attack requires network-level measurement precision that is meaningless over loopback — the attacker already has local access. The architecture docs at `architecture.md:611` explicitly document the localhost binding as the security boundary. This is defense-in-depth against a threat that doesn't exist in the deployment model.

### saveConfig temp file collision after crash prevents all subsequent config saves
- Original severity: HIGH (in correctness)
- New severity: MEDIUM
- Reason: This IS a real bug — `flag: 'wx'` at `config.ts:227` throws EEXIST if `.tmp` exists from a prior crash. However, the blast radius is limited to admin commands (`/setreq`, `/catchup`, `/alerts`) which are infrequent and operator-controlled. The error IS caught by the dispatch handler (won't crash the process). Manual deletion of `config.yaml.tmp` recovers immediately. MEDIUM is appropriate for "rare but real reliability issue with simple workaround."

### Admin command `/setreq` accepts unbounded numeric values
- Original severity: MEDIUM
- New severity: LOW
- Reason: Requires admin access. `formatNumber` in `utils/format.ts:20-32` handles large numbers gracefully (displays "9007.2B" for `Number.MAX_SAFE_INTEGER`). No integer overflow occurs because JavaScript numbers are IEEE 754 doubles. Downstream calculations use the value for comparisons (`m.monthlyGain >= monthlyReq`), not arithmetic that could overflow. The practical impact of setting a very high requirement is "all members fail" which is recoverable by running `/setreq monthly <lower>`.

### Monthly report accesses activeSnapshot.members[0] without guarding against empty array
- Original severity: MEDIUM
- New severity: LOW
- Reason: The guard at line 41 checks `snapshot.members.length === 0` which covers the primary input. For the `activeSnapshot` reassignment path (line 46-58), the loaded previous-month snapshot comes from uma.moe data which always has members. A partially-written snapshot file would need to be valid JSON with a `members: []` array — but `saveSnapshot` at `snapshot.ts:66` always writes complete snapshot data. The risk requires a corrupted file on disk that happens to have the right structure but empty members. While defensive programming would add a guard, the practical risk is negligible.

### dispatch.ts bypasses orchestrator and registry for compare/analyze
- Original severity: HIGH
- New severity: MEDIUM
- Reason: This is a deliberate design choice. `compare` and `analyze` require member name resolution (fuzzy matching via Levenshtein distance at `commands.ts`) BEFORE report generation. The registry's `generateReportString` signature doesn't include member resolution. Routing through the registry would require either: (a) adding member resolution to every report type's signature, or (b) adding a special path in the registry for these two types — both more complex than the current approach. The current pattern (registry for standard types, dispatch for interactive types) is clear and intentional.

### dispatch.ts is 466 lines mixing routing, business logic, and presentation
- Original severity: HIGH
- New severity: MEDIUM
- Reason: The file is well-organized with clear section separators and extracted helper functions (`handlePingCommand`, `handleHelpCommand`, `handleReportCommand`, `handleAdminCommand`, `generateReport`, `processAdminCommand`). Most "business logic" (report generation, member resolution) is delegated to specialized modules. The remaining logic in dispatch.ts IS routing and presentation (loading messages, help text, uptime formatting) — which is what a dispatch module should contain. The 466 lines include significant whitespace, comments, and JSDoc. Extracting further would create more files without clear ownership boundaries. MEDIUM because the file is large but not problematic.

### Unused `db` parameter in 6 of 7 report generators creates unnecessary coupling
- Original severity: MEDIUM
- New severity: MEDIUM (confirmed, not downgraded)
- Reason: Verified by reading daily.ts:29, weekly.ts:51, monthly.ts:38, bottom.ts:27, stats.ts:27, tier.ts:24 — all declare `db?: Database` but never reference it in their function body. Only `members.ts` uses it for `getLeftMembers`. The registry at `registry.ts:33-40` threads `db` through to all generators even when they don't need it.

### alerts module depends on reports module for tier data computation
- Original severity: MEDIUM
- New severity: LOW
- Reason: `computeTierData` at `reports/compute.ts:112` is pure computation on snapshot data. While it lives in `reports/compute.ts`, it has no report-specific dependencies — it uses only `types` and `data/snapshot`. The cross-layer import (`alerts → reports`) is mildly misleading but doesn't create a circular dependency or testing difficulty. The function could move to `data/daily-fans.ts` but the improvement is marginal — alerts and reports legitimately share computation.

### Config getter pattern is inconsistent across modules
- Original severity: MEDIUM
- New severity: LOW (downgraded because it's intentional)
- Reason: The `BotConfig | (() => BotConfig)` dual-type at `dispatch.ts:70` and `server.ts:63` is intentional: some entry points receive a static config (for testing), while runtime entry points receive a getter (for hot-reload). The composition root at `index.ts:121` passes `getConfig` (getter), while tests pass static objects. This is a pragmatic API design, not inconsistency.

### orchestrator mixes snapshot freshness management with report delivery
- Original severity: MEDIUM
- New severity: LOW
- Reason: `alignSnapshotToMonth` at `report-orchestrator.ts:104-143` runs as a pre-step before report generation. The orchestrator's purpose IS to coordinate the full pipeline: fetch → compute → generate → deliver → alerts. Snapshot freshness is part of this pipeline — "ensure data is current before generating." Extracting it would add an extra call site without reducing coupling, since the orchestrator still needs to know WHEN to fetch (before which report types).

### `console.error` in database.ts bypasses structured logger
- Original severity: MEDIUM
- New severity: MEDIUM (confirmed)
- Reason: `database.ts:65,75` uses `console.error` instead of `log.error` from `utils/logger.ts`. Every other module (14 consumers) uses the structured logger. Database errors won't appear in `data/logs/bot.log`, won't have timestamps, won't have the `[DB]` tag. This is a genuine observability gap.

### `formatUptime` utility lives in dispatch.ts instead of utils/
- Original severity: MEDIUM
- New severity: LOW
- Reason: `formatUptime` at `dispatch.ts:49-54` is a 5-line pure function used in two places within dispatch.ts (`handlePingCommand` and `processAdminCommand`). Moving it to `utils/format.ts` would make it available to other modules, but no other module currently needs it. The function is simple and self-contained. YAGNI — move it when another consumer appears.

### api/server.ts recomputes `computeMembers` for every request
- Original severity: MEDIUM
- New severity: LOW
- Reason: Three endpoints (`handleReport:268`, `handleMembers:298`, `handleMemberDetail:325`) each call `computeMembers`. For 34 members, this takes ~1-2ms per call. The API is localhost-only with optional bearer auth — it's not a high-traffic endpoint. A client hitting all three endpoints in sequence pays ~3-6ms total. The snapshot is immutable, so caching is possible but the complexity isn't justified at current scale. The maintainability audit also flagged this at MEDIUM; both are valid observations but LOW practical impact.

### Logger calls `statSync` on every log line to check file size
- Original severity: MEDIUM
- New severity: LOW
- Reason: At ~100 log lines per report cycle (documented scale), this adds ~100 extra `statSync` calls per cycle. Each `statSync` is a synchronous syscall, but on modern Linux/NTFS it completes in microseconds. The logger is already synchronous (`appendFileSync` at line 189). The `statSync` is part of the existing sync I/O pattern that is documented as an accepted risk (`architecture.md:623`). The optimization suggested by the audit (byte tracking) is valid but the practical improvement is negligible.

### Logger creates a new `Intl.DateTimeFormat` instance on every log line
- Original severity: MEDIUM
- New severity: LOW
- Reason: V8 may cache `Intl.DateTimeFormat` internally (spec allows it). At ~100 lines per cycle, the overhead is measurable but negligible compared to the synchronous file I/O that dominates each log write. The caching fix is a one-line improvement with no risk, but the impact at current scale is minimal.

### `configChanged` serializes every config section to JSON for deep comparison
- Original severity: MEDIUM
- New severity: LOW
- Reason: Config changes are infrequent (manual file edits). The config watcher polls every 5s (`index.ts:129`), and `deepEqual` is only called when mtime or content changes. The config object is small (~2KB YAML). The total cost per change detection is negligible. Zod-validated config objects have consistent key ordering, so `JSON.stringify` comparison works correctly.

### Monthly pre-fetch logic duplicated in 4 locations
- Original severity: HIGH
- New severity: MEDIUM
- Reason: Verified all 4 locations: `index.ts:287-295`, `report-orchestrator.ts:242-250`, `report-orchestrator.ts:290-301`, `dispatch.ts:261-269`. The duplication IS real — the same pattern of `getTargetMonth → ensureMonthSnapshot → catch error` appears in all four. However, the risk of drift is MEDIUM (not HIGH) because: (a) the logic is simple and unlikely to change, (b) the pattern is copy-pasted consistently, and (c) the orchestrator's `sendCombinedCatchUp` already handles this correctly. Extracting a helper is a clean-up, not a bug fix.

### `console.error` in database.ts bypasses structured logger
- Original severity: MEDIUM
- New severity: MEDIUM (confirmed, listed in both correctness and maintainability)
- Reason: Both audits independently flagged this. `database.ts:65` and `database.ts:75` use `console.error` for SQL error logging. All 14 other modules use the structured `log` from `utils/logger.ts`. Database errors will not appear in the log file, won't have timestamps, and won't respect the configured log level. This is a genuine observability gap.

## Confirmed Findings

### Correctness
1. **saveConfig temp file collision after crash** — `src/config.ts:227` — `flag: 'wx'` throws EEXIST if `.tmp` exists from prior crash. Downgraded to MEDIUM (see above) but the bug IS real.
2. **Combined report alert processing gap** — `src/index.ts:279-300` — `onCombinedReport` callback calls `orchestrator.deliverReport()` but never `processAlertsForReport()`. The catch-up path at `report-orchestrator.ts:256-261` correctly calls `processAlertsForReport` for each type. This is a genuine correctness gap on collision days.

### Architecture
3. **Unused `db` parameter in 6 of 7 report generators** — `daily.ts:29, weekly.ts:51, monthly.ts:38, bottom.ts:27, stats.ts:27, tier.ts:24` — Verified by reading each file. Dead parameter creating false dependency graph.
4. **`reports/format.ts` re-exports formatDateWIB creating dual import paths** — `reports/format.ts:13` — `export { formatDateWIB }` re-exports from `utils/timezone`. Creates confusion about canonical source.
5. **`utils/index.ts` barrel file is unused dead code** — `utils/index.ts:1` — Re-exports `./timezone` but nothing imports from it.
6. **Help text admin command list is hardcoded** — `dispatch.ts:190-199, 210-219` — Help text diverges from `ADMIN_COMMANDS` set when new commands are added (the specific divergence claim was false, but the structural issue is real).

### Maintainability
7. **`console.error` bypasses structured logger in database.ts** — `database.ts:65,75` — Two locations use `console.error` instead of `log.error`.
8. **handleCatchUp and handleAlerts are structurally identical** — `admin.ts:157-193 vs 199-234` — Copy-paste pattern with identical toggle logic. A generic toggle helper would reduce duplication.

### Performance
9. **Database auto-save exports entire WASM blob every 30s regardless of changes** — `database.ts:47-49,384-389` — No dirty flag. `db.export()` runs even when no writes occurred. For current scale this is acceptable, but the dirty flag optimization is straightforward.

### Testing
10. **No test for combined report alert processing gap** — `index.ts:279-300` — Regression test should verify that `processAlertsForReport` is called for each type when `onCombinedReport` fires.
11. **No test for saveConfig temp file collision** — `config.ts:226-228` — No test creates an orphaned `.tmp` file and verifies `saveConfig` recovers.
12. **`scheduler.unit.test.ts` tests use `getDataDate()` which depends on real time** — `scheduler.unit.test.ts:322,349,391` — Tests could fail across JST midnight boundary. Should use `jest.useFakeTimers()`.

### Low severity (confirmed but not urgent)
13. **`isStaleMember` exported but never called in production** — `daily-fans.ts:220-226` — Only used in tests. Production uses `isStaleForReport` (line 306). Two stale-detection functions with different semantics.
14. **Monthly pre-fetch logic duplicated in 4 locations** — `index.ts:287, orchestrator.ts:242/290, dispatch.ts:261` — Same pattern repeated. Extraction into helper recommended.
15. **`dataDay` naming ambiguity across files** — `daily.ts:38, stats.ts:34, monthly.ts:93` — Same variable name holds different semantic values (adjusted vs actual).
16. **`configChanged` uses `JSON.stringify` for deep comparison** — `index.ts:47-48` — Works due to Zod key ordering but fragile to future changes.
17. **`status` parameter is large inline object type** — `admin.ts:106` — 8 optional fields defined inline at call site. Should be extracted to `types/index.ts`.
18. **`ensure-snapshot.ts` has no dedicated test** — `ensure-snapshot.ts:1-66` — 66-line module with no dedicated tests.
19. **Weak dispatch test assertions** — `dispatch.test.ts:163-252` — Tests verify `sendOrEdit` was called but not report content correctness (golden-inline tests cover this gap).

## Unverifiable
None — all findings were verified against the actual source code.
