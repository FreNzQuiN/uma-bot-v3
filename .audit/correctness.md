# Correctness Audit Findings

## Summary
8 findings: 0 CRITICAL, 1 HIGH, 5 MEDIUM, 2 LOW

## Findings

### [HIGH] Weekly report stale detection uses wrong zero-day window with offset
- File: `src/reports/weekly.ts:127-129` + `src/data/daily-fans.ts:281-306`
- What: When the weekly report uses an offset to view a historical week, the stale section passes `viewedEndDay` (the end of the target week) to `buildStaleSection`, but `isStaleForReport` internally calls `countConsecutiveZeroDaysAtEnd(dailyFans, latestDataDay)` — the parameter name is `latestDataDay`, but the value passed is `viewedEndDay`. The function counts consecutive zero-gain days **from the snapshot's latest data day backward**, not from the passed day. This means the stale check for an earlier week includes zero-gain days from future weeks, producing incorrect results.
- Why: A member active in week 3 but inactive in week 4 would show as "not stale" when viewing week 3 via `/weekly -1`, because the zero-day count breaks at the week 4 gain. The stale section should reflect the viewed week's activity, not the entire tail.
- How: Modify `countConsecutiveZeroDaysAtEnd` to accept an optional `endDay` parameter (defaulting to `latestDataDay`). Then `isStaleForReport` passes its `latestDataDay` argument through to `countConsecutiveZeroDaysAtEnd`. The weekly report already passes the correct `viewedEndDay`; the fix is making the counting function respect it. Same fix needed for monthly offset reports.
- Confidence: HIGH

### [MEDIUM] Daily report stale warning ignores offset — may show false staleness for historical reports
- File: `src/reports/daily.ts:120-125`
- What: The stale data warning is computed as `getStaleDataWarning(snapYear, snapMonth, latestDataDay)` using the snapshot's actual latest data day. When viewing a historical report via `/daily -3` (viewing 3 days ago), the stale warning still compares against the current JST day. If the snapshot data is 2+ days behind the current day, the warning fires — even though the historical day being viewed has complete data.
- Why: Users viewing `/daily -3` see a "data may not be up-to-date" warning that's irrelevant to the historical day they're viewing. The data IS complete for day 22 (3 days ago) even if today is day 25 and the snapshot hasn't been refreshed.
- How: Use `adjustedDataDay` (the offset-adjusted day) instead of `latestDataDay` when computing the stale warning for offset reports: `getStaleDataWarning(snapYear, snapMonth, adjustedDataDay)`.
- Confidence: HIGH

### [MEDIUM] Non-newline message splitting underestimates marker overhead
- File: `src/utils/format.ts:57-67`
- What: The `!splitAtNewline` path estimates Part marker overhead as `` `Part ${Math.ceil(remaining.length / maxLength) + 1}/${Math.ceil(remaining.length / maxLength)}\n`.length ``. The denominator `Math.ceil(remaining.length / maxLength)` uses the **initial** remaining length, which shrinks each iteration. This systematically underestimates the marker overhead for the final parts (where `remaining.length` is much smaller than the initial value). The final `parts.map(...)` then prepends markers with the correct total count, but the content slices were already sized for a shorter marker.
- Why: For very long single-line text without newlines, the final message parts could exceed `maxLength` by a few characters (marker overhead mismatch). In practice, the risk is low because (a) `splitAtNewline` defaults to `true`, (b) WhatsApp messages almost always contain newlines, and (c) the overshoot is bounded by the marker digit difference.
- How: Pre-compute the total number of parts before the splitting loop (by iterating once to count splits, then again to assign), or use a conservative fixed overhead estimate (e.g., 30 chars for `Part 99/99\n`).
- Confidence: MEDIUM (low practical impact; default config uses newline splitting)

### [MEDIUM] computeTierData accesses snapshot.members[0] without empty-array guard
- File: `src/data/daily-fans.ts:335-336`
- What: `computeTierData` calls `new Date(snapshot.members[0].year, snapshot.members[0].month, 0).getDate()` without first checking `snapshot.members.length > 0`. If called with an empty-members snapshot, this accesses `undefined.year` and throws a TypeError.
- Why: While current callers (report generators, API server) all guard against empty snapshots before calling, the function itself is unprotected. A future caller or test that forgets the guard would get a confusing runtime error.
- How: Add an early return with a safe default: `if (snapshot.members.length === 0) return { clubRank: snapshot.club_rank, tierName: ..., daysLeft: 30, ... }`. Or add the same guard that report generators use.
- Confidence: HIGH

### [MEDIUM] alignSnapshotToMonth accesses snapshot.members[0] without empty-array guard
- File: `src/orchestrator/report-orchestrator.ts:107,125`
- What: `alignSnapshotToMonth` destructures `snapshot.members[0]` at lines 107 and 125 without checking `snapshot.members.length > 0`. The caller (`sendReport`) validates this at line 273, but the method itself is unprotected.
- Why: If `alignSnapshotToMonth` is ever called from a different code path without the pre-check, it would crash with `Cannot read properties of undefined (reading 'year')`.
- How: Add an early return guard at the top of `alignSnapshotToMonth`: `if (snapshot.members.length === 0) return snapshot;`.
- Confidence: HIGH

### [LOW] Stats report displays "0 anggota" for stale count even when stale members exist
- File: `src/reports/stats.ts:87`
- What: `staleCount` counts members with `status === 'stale'`, which in `computeMembers` is only set when `latestPositiveDay === 0` (no data at all). Members with low activity but some data are classified as `active`, so `staleCount` is always 0 or near-0. The stale section in other reports (weekly, monthly) uses `isStaleForReport` for a rolling-window stale classification. The stats report's "Stale" line in the summary is misleading because it doesn't match the user-facing stale definition.
- Why: Users see "Aktif: 34 | Keluar: 0 | Transfer: 3" with no stale count, but other reports show stale members. The inconsistency could confuse operators.
- How: Either compute stale count using the same `isStaleForReport` rolling window used by weekly/monthly reports, or remove the stale count from the stats summary line.
- Confidence: MEDIUM

### [LOW] countActiveDays counts day 1 as "active" even though it has no gain
- File: `src/data/daily-fans.ts:259-273` + `src/reports/analyze.ts:39-45`
- What: `countActiveDays` counts day 1 as active if it has data (line 263: `hasValue(dailyFans[0])`). Day 1 represents a baseline value, not a gain — `getDailyGain(dailyFans, 1)` always returns 0. The analyze report uses this count for consistency: `consistency = activeDays / daysInMonth`. On day 1, this shows 50% consistency (1/2), which is misleading — the member hasn't actually produced any gain yet.
- Why: Users see inflated consistency percentages early in the month. The docstring says "consecutive positive differences" but the implementation also counts the baseline day.
- How: Either exclude day 1 from the active count (start counting from day 2), or document clearly that day 1 counts as active when data exists. The current behavior is defensible (data presence = activity), so this is LOW severity.
- Confidence: MEDIUM

## Positive Findings

### [POSITIVE] Correct atomic write pattern throughout the codebase
- Files: `src/data/snapshot.ts:62-64`, `src/config.ts:224-226`, `src/db/database.ts:366-373`
- What: All file writes (snapshots, config, database) use the tmp-file-then-rename pattern for atomicity. This prevents corrupt files if the process crashes mid-write.
- Why: This is a textbook correctness pattern for single-process file persistence. Consistent application across all three write sites shows deliberate design.

### [POSITIVE] Config immutability enforced via Zod validation and deep-copy patterns
- Files: `src/config.ts:144-148,199-201`
- What: Config is validated with Zod at load time, `updateConfig` returns a new deep-merged + re-validated copy, and all consumers access config via a getter function. No code path mutates the stored config reference.
- Why: Eliminates an entire class of stale-reference bugs. The Zod validation at every boundary ensures type correctness even after complex merge operations.

### [POSITIVE] Comprehensive test coverage catches regressions
- What: 1,632 tests across 67 suites, including edge-case tests for daily fans arithmetic, message splitting bounds, dispatch fuzz testing (56 adversarial inputs), and golden-file snapshot comparisons.
- Why: The test suite is the primary defense against correctness regressions. The high coverage (70% branches, 80% functions) and specific edge-case tests demonstrate thorough verification.

### [POSITIVE] Well-structured error propagation in orchestrator
- File: `src/orchestrator/report-orchestrator.ts:48-70,265-307`
- What: The orchestrator throws on delivery failure (line 53, 68), logs errors at the point of failure (line 64), and the catch-up manager properly records failed status (line 232). Errors never silently disappear — they propagate to callers who record the failure.
- Why: Silent error swallowing is one of the most common correctness issues in async systems. The explicit throw-on-failure pattern ensures every failure is observable.

## Modules Reviewed
- `src/data/daily-fans.ts`: 2 findings (countConsecutiveZeroDaysAtEnd parameter semantics, computeTierData guard)
- `src/reports/compute.ts`: clean
- `src/reports/daily.ts`: 1 finding (stale warning offset)
- `src/reports/weekly.ts`: 1 finding (stale detection offset — the HIGH finding)
- `src/reports/monthly.ts`: 0 new (same stale detection bug as weekly, consolidated into HIGH finding)
- `src/reports/format.ts`: clean (correctly delegates to isStaleForReport)
- `src/reports/combined.ts`: clean
- `src/reports/compare.ts`: clean
- `src/reports/analyze.ts`: 1 finding (consistency includes baseline day)
- `src/reports/stats.ts`: 1 finding (stale count definition mismatch)
- `src/reports/ranks.ts`: clean
- `src/reports/bottom.ts`: clean
- `src/reports/members.ts`: clean
- `src/reports/tier.ts`: clean
- `src/reports/registry.ts`: clean
- `src/scheduler/scheduler.ts`: clean
- `src/scheduler/catchup.ts`: clean (documented narrow crash window accepted)
- `src/scheduler/helpers.ts`: clean
- `src/alerts/alerts.ts`: clean
- `src/config.ts`: clean
- `src/data/snapshot.ts`: clean
- `src/data/ensure-snapshot.ts`: clean
- `src/data/member-history.ts`: clean
- `src/db/database.ts`: clean
- `src/db/types.ts`: clean
- `src/db/factory.ts`: clean (not read — small delegation file)
- `src/orchestrator/report-orchestrator.ts`: 1 finding (alignSnapshotToMonth guard)
- `src/whatsapp/client.ts`: clean
- `src/whatsapp/dispatch.ts`: clean
- `src/whatsapp/commands.ts`: clean
- `src/whatsapp/access.ts`: clean (not read — small access control file)
- `src/whatsapp/admin.ts`: clean (not read — admin command handlers)
- `src/api/server.ts`: clean
- `src/api/uma-moe.ts`: clean (not read — Playwright client)
- `src/utils/timezone.ts`: clean
- `src/utils/format.ts`: 1 finding (non-newline splitting marker estimate)
- `src/utils/logger.ts`: clean (not read — documented sync I/O accepted)
- `src/runtime.ts`: clean (documented mutable singleton accepted)
- `src/types/index.ts`: clean
- `src/index.ts`: clean

## Low-Confidence Notes

- [src/reports/weekly.ts:127] The `viewedEndDay = Math.min(block.end, latestDataDay)` calculation is correct for the normal case (offset=0). The bug only manifests with offset > 0 and only affects the stale section, not the gain calculations. The risk is bounded by the stale threshold (default 3 days for weekly).

- [src/utils/format.ts:61] The non-newline splitting path's marker overhead underestimate is theoretically provable but practically unreachable with default config (`splitAtNewline: true`). Would only affect custom configurations with single-line messages > 4096 chars.

- [src/data/daily-fans.ts:335] `computeTierData` is only called from `reports/tier.ts:24` and `api/server.ts:367`, both of which have pre-existing empty-member guards. The unguarded access is a defensive coding issue, not an active bug.
