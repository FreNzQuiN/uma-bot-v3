# Adversarial Validation

## Summary
- Total findings reviewed: 38
- CONFIRMED (kept as-is): 32
- DOWNGRADED (severity reduced): 1
- REJECTED (false positive): 5
- UNVERIFIABLE (can't confirm or deny): 0

## Rejected Findings (False Positives)

### [HIGH] Weekly report stale detection uses wrong zero-day window with offset
- Original file: `.audit/correctness.md` finding #1 (src/reports/weekly.ts:127-129 + src/data/daily-fans.ts:281-306)
- Original severity: HIGH
- Reason for rejection: The audit claims `countConsecutiveZeroDaysAtEnd` "counts from the snapshot's latest data day backward, not from the passed day." This is factually wrong. The function iterates from `latestDataDay` (its parameter), which receives `viewedEndDay` from the caller. The chain is: `weekly.ts:129` → `buildStaleSection(computedMembers, viewedEndDay, ...)` → `isStaleForReport(m.dailyFans, dataDay, ...)` → `countConsecutiveZeroDaysAtEnd(dailyFans, latestDataDay)`. The parameter name `latestDataDay` in `countConsecutiveZeroDaysAtEnd` is misleading, but the value flowing through is `viewedEndDay` (= `Math.min(block.end, latestDataDay)`). The code correctly counts zero-gain days from the end of the viewed week backward. Both weekly and monthly reports follow the same pattern (compare `weekly.ts:129` with `monthly.ts:148` — both pass their period's effective end day). No bug exists.
- Evidence: `daily-fans.ts:286` — `for (let day = latestDataDay; day >= 2; day--)` iterates from the parameter, which is `viewedEndDay`. The `weekly.ts:127` comment confirms: "rolling window: consecutive zero-gain days at end of target week."

### [MEDIUM] Daily report stale warning ignores offset — may show false staleness for historical reports
- Original file: `.audit/correctness.md` finding #2 (src/reports/daily.ts:120-125)
- Original severity: MEDIUM
- Reason for rejection: The audit suggests using `adjustedDataDay` instead of `latestDataDay`, but the code's existing comment at line 118-119 explicitly states the intent: "Stale data warning: check if the SNAPSHOT is stale, not the viewed day. Use latestDataDay (snapshot's actual latest) instead of offset-adjusted adjustedDataDay." This is a deliberate design choice — the warning indicates whether the snapshot data is current overall, not whether the specific historical day is complete. When a user views `/daily -3` and the snapshot is 2+ days old, the warning correctly tells them the snapshot hasn't been refreshed recently. Suppressing the warning for historical queries would be misleading — users would think data freshness is fine when the snapshot is genuinely stale. This is the same pattern used in `weekly.ts:132` and `monthly.ts:150`, which also pass `latestDataDay` (not the offset-adjusted day) to `getStaleDataWarning`.
- Evidence: `daily.ts:118-119` — explicit comment explaining the design choice. `weekly.ts:132` and `monthly.ts:150` follow the same pattern.

### [HIGH] No regression test for weekly/monthly stale detection offset bug
- Original file: `.audit/testing.md` finding #2
- Original severity: HIGH
- Reason for rejection: This finding depends on the correctness finding #1 (weekly stale offset bug), which is a false positive (see above). Since the code correctly handles the offset case, no regression test is needed. The existing tests in `weekly.stale.test.ts` adequately cover the stale detection behavior. Writing a test for a non-existent bug would be wasted effort.
- Evidence: See rejection of correctness finding #1 above.

### [MEDIUM] No regression test for daily stale warning showing false alarm on offset reports
- Original file: `.audit/testing.md` finding #3
- Original severity: MEDIUM
- Reason for rejection: This finding depends on the correctness finding #2 (daily stale warning offset), which is a false positive (see above). The daily stale warning uses `latestDataDay` by design — it warns about snapshot freshness, not historical data completeness. No "false alarm" exists because the warning is correctly reporting snapshot staleness. Writing a test to assert the audit's preferred behavior would conflict with the intentional design.
- Evidence: See rejection of correctness finding #2 above.

## Downgraded Findings

### Non-newline message splitting underestimates marker overhead
- Original severity: MEDIUM
- New severity: LOW
- Reason: The issue is real but affects only the non-default `splitAtNewline: false` path. The default newline-splitting path uses a fixed 20-char overhead estimate (`FIXED_MARKER_OVERHEAD`) and doesn't have this problem. The maximum overshoot is ~6 characters (marker digit difference). No WhatsApp message is likely to be a single line >4096 chars. The audit itself rates confidence as "MEDIUM (low practical impact; default config uses newline splitting)."

## Confirmed Findings

### Security (3/3 confirmed)
- `src/api/server.ts:123` — MEDIUM: API auth skipped when API_TOKEN unset (documented as accepted, but no startup warning)
- `src/api/server.ts:125` — LOW: Bearer token non-constant-time comparison (localhost mitigates, but best-practice gap)
- `src/whatsapp/admin.ts:40-49` — LOW: /setreq bypasses Zod validation before saveConfig (next hot-reload catches it, but disk corruption possible)

### Correctness (6/8 confirmed, 2 rejected)
- `src/utils/format.ts:57-67` — LOW (downgraded from MEDIUM): Non-newline splitting marker overhead underestimate
- `src/data/daily-fans.ts:335-336` — MEDIUM: computeTierData unguarded `snapshot.members[0]` access (callers guard, but function is unprotected)
- `src/orchestrator/report-orchestrator.ts:107,125` — MEDIUM: alignSnapshotToMonth unguarded `snapshot.members[0]` access (caller guards at line 273)
- `src/reports/stats.ts:87` — LOW: staleCount uses `status === 'stale'` which differs from rolling-window stale definition
- `src/data/daily-fans.ts:259-273` + `src/reports/analyze.ts:39-45` — LOW: countActiveDays includes day 1 baseline as "active"

### Performance (4/4 confirmed)
- `src/data/member-history.ts:30-63` — MEDIUM: N+1 queries in updateMemberHistory (startup-only, but real pattern)
- `src/orchestrator/report-orchestrator.ts:197-214` — MEDIUM: Individual recordAlert + markAlertSent per alert in loop
- `src/data/snapshot.ts:131-162` — LOW: loadMonthSnapshots reads all files when only latest needed
- `src/utils/logger.ts:108-117` — LOW: Intl.DateTimeFormat recreated every log line

### Maintainability (10/10 confirmed)
- `src/reports/registry.ts` + 5 other files — MEDIUM: Report type knowledge scattered across 6+ files
- `src/db/database.ts:389-461` + `src/db/mysql-database.ts:202-447` — MEDIUM: Database adapter row mapping duplicated
- `src/alerts/alerts.ts:35-203` — MEDIUM: detectAlerts 200 lines with repeated structural patterns
- `src/whatsapp/dispatch.ts:54-61,88-96,273-282` — MEDIUM: Parameter threading explosion (7-9 params through 3 levels)
- `src/scheduler/catchup.ts:179-304` — MEDIUM: executeCatchUp 125 lines with 3 divergent paths
- `src/index.ts:59-82` — MEDIUM: configChanged manually compares schedule fields
- `src/orchestrator/report-orchestrator.ts:146-166` — MEDIUM: generateReportString method name shadows imported function
- `src/db/database.ts:105-112` + `src/db/mysql-database.ts:133-140` — LOW: settings table DDL exists with no IDatabase methods
- `src/db/database.ts:464-466` — LOW: Database backward-compat aliases unused
- `src/data/daily-fans.ts:211-220` — LOW: isStaleMember deprecated but still exported

### Testing (6/10 confirmed, 2 rejected, 2 downgraded already counted)
- `tests/api/server.integration.test.ts:251` + `tests/api/server-auth.integration.test.ts:9` — HIGH: Port 18767 collision causes flaky test
- `tests/scheduler/catchup-regression.test.ts:31,68,112` — MEDIUM: Unmocked `new Date()` makes tests date-dependent
- `src/index.ts:132-198` — MEDIUM: Config hot-reload watcher untested (67 lines of branching logic)
- `tests/orchestrator/report-orchestrator.unit.test.ts:353-357` — MEDIUM: Module-level detectAlerts mock masks behavior
- `tests/scheduler/scheduler.unit.test.ts:226,244,331,374,399` — LOW: `as any` casts access private internals
- `src/runtime.ts` — LOW: No dedicated test file for runtime.ts module
- `tests/reports/e2e-output.test.ts:33` — LOW: Depends on config.yaml on disk

## Unverifiable

None. All file:line references verified against actual source code.

## Notes on Over-Correction Filter

The two rejected HIGH/MEDIUM correctness findings (weekly stale offset + daily stale warning) are classic examples of LLM over-correction bias:

1. **Weekly stale offset**: The audit misread the parameter flow. The function `countConsecutiveZeroDaysAtEnd` iterates from its parameter (not from a hardcoded value). The parameter name `latestDataDay` is misleading, but the value flowing through is `viewedEndDay`. An LLM reading the parameter name without tracing the call chain concluded the code was wrong.

2. **Daily stale warning**: The audit proposed a behavioral change (suppress stale warning for historical queries) and framed it as a bug. The code has an explicit comment explaining the design choice. This is a preference difference, not a defect. The 26-73% over-correction rate documented in arXiv 2025 is visible here — the LLM "corrected" intentionally correct code.
