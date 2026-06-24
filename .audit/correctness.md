# Correctness Audit Findings

## Summary
10 findings: 0 CRITICAL, 2 HIGH, 5 MEDIUM, 3 LOW

## Findings

### [HIGH] saveConfig temp file collision after crash prevents all subsequent config saves
- File: src/config.ts:227
- What: `writeFileSync(tmpPath, raw, { encoding: 'utf-8', flag: 'wx' })` uses exclusive-create flag that throws EEXIST if the temp file already exists from a prior crash between write and rename.
- Why: If the process crashes after `writeFileSync` but before `renameSync`, the orphaned `config.yaml.tmp` blocks ALL future `saveConfig` calls — admin commands `/setreq`, `/catchup`, `/alerts` silently fail until the temp file is manually deleted.
- How: Change `flag: 'wx'` to `flag: 'w'` (overwrite). The temp file is unique per call (`config.yaml.tmp`) and `renameSync` on the next line provides atomicity. The `wx` flag adds no value since the rename is the atomic operation. Alternatively, add `try { unlinkSync(tmpPath); } catch {}` before the write.
- Confidence: HIGH

### [HIGH] Scheduled combined reports (collision days) skip alert processing entirely
- File: src/index.ts:279-300
- What: The `onCombinedReport` callback passed to the Scheduler generates and delivers the combined report string but never calls `orchestrator.processAlertsForReport()` for each report type in the combined set.
- Why: When daily+weekly or weekly+monthly collide at the same time, the combined handler fires instead of individual report handlers. Individual handlers call `orchestrator.sendReport()` which includes alert processing. The combined handler does not — so alerts (performance drop, demotion risk, streak break, etc.) are silently lost on collision days.
- How: After delivering the combined report, iterate over the types and call `orchestrator.processAlertsForReport(type, snapshot, config, computedMembers)` for each. This mirrors what `sendCombinedCatchUp` does at report-orchestrator.ts:256-261. The catch-up path already handles this correctly.
- Confidence: HIGH

### [MEDIUM] Monthly report accesses activeSnapshot.members[0] without guarding against empty array
- File: src/reports/monthly.ts:61
- What: `const { year, month } = activeSnapshot.members[0];` — when offset > 0, `activeSnapshot` may be a previous month's snapshot loaded from disk. The guard at line 41 checks `snapshot.members.length` (the original parameter), not `activeSnapshot.members.length`.
- Why: If a previous month's snapshot exists on disk but has an empty members array, this destructuring throws `TypeError: Cannot destructure property 'year' of undefined`. While uma.moe data always has members in practice, malformed or partially-written snapshot files would trigger this.
- How: Move the guard to after the `activeSnapshot` assignment, or add a guard before line 61: `if (activeSnapshot.members.length === 0) return '⚠️ Data bulan ini kosong.';`
- Confidence: MEDIUM

### [MEDIUM] computeTierData projectedOutcome overrides HIGH demotion risk with 'promote'
- File: src/reports/compute.ts:151-154
- What: When `riskLevel` is set to 'HIGH' (buffer < 3 days of pace) at line 141, `projectedOutcome` is set to 'demotion_risk'. But at line 153-154, `projectedOutcome = 'promote'` is set unconditionally if `currentPace >= requiredPace`, overwriting the demotion_risk.
- Why: The tier report displays `${riskEmoji[tier.riskLevel]} Proyeksi: ${outcomeText[tier.projectedOutcome]}` — users see "🚨 Proyeksi: Promosi" which is contradictory. While technically correct (on-pace-to-promote makes buffer irrelevant), the UX is confusing.
- How: Guard the promote assignment: `if (currentPace >= requiredPace && projectedOutcome !== 'demotion_risk')`. If risk is HIGH, keep the outcome as 'demotion_risk' since the buffer is critically thin.
- Confidence: MEDIUM

### [MEDIUM] Database methods declare unused `db` local variable
- File: src/db/database.ts:164,185,206,226,235,243,269,292,318,328,350,368
- What: Multiple methods (`getLastSuccessfulRun`, `recordRun`, `updateRunStatus`, `isAlertAlreadySent`, `recordAlert`, `markAlertSent`, `upsertMember`, `getMembers`, `getMember`, `saveRankHistory`, `getRankHistory`) declare `const db = this.ensureDb()` but never reference the `db` variable — they use `this.execSql()` or `this.runSql()` which internally call `this.ensureDb()` again.
- Why: Each call to `ensureDb()` is trivial (null check + throw), so no performance impact. But it's misleading code that suggests `db` is needed locally when it isn't. Code review confusion.
- How: Remove the unused `const db = this.ensureDb();` lines. The `execSql`/`runSql` methods handle initialization checking internally.
- Confidence: HIGH

### [MEDIUM] stats report computes redundant active member filter
- File: src/reports/stats.ts:117
- What: `const activeMembers = contributing.filter((m) => m.status === 'active')` — `contributing` is already filtered to only active members at line 36-38 (`computedMembers.filter((m) => m.status === 'active')`). This filter always returns the same array.
- Why: No correctness impact — the result is identical. But it's dead logic that could confuse maintainers into thinking `activeMembers` differs from `contributing`.
- How: Replace `activeMembers` with `contributing` at lines 118-124, or remove the `contributing` filter at line 36 and use `computedMembers.filter(...)` once.
- Confidence: HIGH

### [LOW] isStaleMember exported from daily-fans.ts but never called in production code
- File: src/data/daily-fans.ts:220-226
- What: `isStaleMember` is defined and exported but only used in test files. Production code uses `isStaleForReport` (line 306) instead, which uses a different algorithm (consecutive zero-gain days vs. day gap).
- Why: Two stale-detection functions with different semantics (`isStaleMember` = gap-based, `isStaleForReport` = consecutive-zero-based) can confuse developers into using the wrong one. The exported function is tested but dead in production.
- How: If `isStaleMember` is intentionally kept for test compatibility, add a JSDoc note: `@deprecated Use isStaleForReport for production stale detection`. If not needed, remove it.
- Confidence: HIGH

### [LOW] snapshot.ts saveSnapshot does not protect against orphaned temp files
- File: src/data/snapshot.ts:65-67
- What: `fs.writeFileSync(tmpPath, ...)` uses default `flag: 'w'` (overwrite). If the process crashes between write and rename, the orphaned `.tmp` file persists. Unlike config.ts (which uses `flag: 'wx'` and would throw), this silently overwrites on next call.
- Why: In practice this is benign — the overwrite recovers cleanly. But the behavior is inconsistent with `config.ts` and there's no explicit cleanup. If multiple snapshots are being saved concurrently (unlikely but possible), the temp file could be overwritten by a different snapshot.
- How: Add explicit cleanup before write: `try { unlinkSync(tmpPath); } catch {}` to be consistent with defensive patterns elsewhere. Or leave as-is since the overwrite behavior is actually correct recovery.
- Confidence: LOW

### [LOW] Database auto-save timer not cleaned up on partial initialization failure
- File: src/db/database.ts:46-49
- What: `initialize()` sets up an auto-save interval at lines 47-49 after `createTables()`. If the method is called but `initialize()` throws partway through (e.g., after tables are created but before the timer), the timer isn't set — but this is actually fine since the throw prevents the timer from being needed. The real concern is if `close()` is called when `saveTimer` was never set: it correctly checks `if (this.saveTimer)` at line 392.
- Why: No actual issue — the error propagation is correct. But there's no explicit cleanup path if `createTables()` throws after the timer is set (which can't happen since timer is set after tables). The code is correct but the ordering could be made more defensive.
- How: Move `saveTimer` setup to be the very last line of `initialize()` (it already is). No change needed.
- Confidence: LOW

## Modules Reviewed
- **src/types/**: clean
- **src/config.ts**: 1 finding (HIGH — saveConfig temp file collision)
- **src/runtime.ts**: clean
- **src/index.ts**: 1 finding (HIGH — combined report alerts)
- **src/data/daily-fans.ts**: 1 finding (LOW — unused isStaleMember)
- **src/data/snapshot.ts**: 1 finding (LOW — temp file handling inconsistency)
- **src/data/ensure-snapshot.ts**: clean
- **src/data/member-history.ts**: clean
- **src/db/database.ts**: 2 findings (MEDIUM — unused variables, LOW — timer cleanup)
- **src/api/uma-moe.ts**: clean
- **src/api/server.ts**: clean
- **src/reports/compute.ts**: 1 finding (MEDIUM — projectedOutcome override)
- **src/reports/registry.ts**: clean
- **src/reports/format.ts**: clean
- **src/reports/daily.ts**: clean
- **src/reports/weekly.ts**: clean
- **src/reports/monthly.ts**: 1 finding (MEDIUM — empty members guard)
- **src/reports/ranks.ts**: clean
- **src/reports/bottom.ts**: clean
- **src/reports/stats.ts**: 1 finding (MEDIUM — redundant filter)
- **src/reports/members.ts**: clean
- **src/reports/tier.ts**: clean
- **src/reports/compare.ts**: clean
- **src/reports/analyze.ts**: clean
- **src/reports/combined.ts**: clean
- **src/orchestrator/report-orchestrator.ts**: clean
- **src/scheduler/scheduler.ts**: clean
- **src/scheduler/catchup.ts**: clean
- **src/scheduler/helpers.ts**: clean
- **src/whatsapp/client.ts**: clean
- **src/whatsapp/dispatch.ts**: clean
- **src/whatsapp/commands.ts**: clean
- **src/whatsapp/admin.ts**: clean
- **src/whatsapp/access.ts**: clean
- **src/alerts/alerts.ts**: clean
- **src/utils/format.ts**: clean
- **src/utils/timezone.ts**: clean
- **src/utils/logger.ts**: clean
- **src/utils/index.ts**: clean

## Low-Confidence Notes

- [index.ts:306] The `waClient.connect().then().catch()` chain runs catch-up concurrently with scheduler/API startup. This is intentional (bot is "ready" before WA connects), but if catch-up and scheduled reports overlap during startup, the same report could be generated twice. The dedup via `getLastSuccessfulRun` in the scheduler should prevent this, but the timing window is tight.

- [scheduler.ts:37] When `onReport` is not provided, it defaults to `async () => {}` — a no-op. If this path were ever hit, the scheduler would mark reports as 'sent' without actually sending them. In practice, the scheduler is always constructed with an onReport callback from index.ts, so this is theoretical.

- [compute.ts:90-104] Ghost detection reclassifies the bottom N members by monthlyGain as 'left'. If all members have equal gain (e.g., all zero), the sort is stable but the reclassification is arbitrary. The documented edge case (ghostCount > zero-gain + stale) doesn't manifest with real data.
