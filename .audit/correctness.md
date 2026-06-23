# Correctness Audit Findings

## Summary
10 findings: 0 CRITICAL, 5 HIGH, 4 MEDIUM, 1 LOW

## Findings

### [HIGH] Catch-up alerts never marked as 'sent' — causes duplicate delivery
- File: src/orchestrator/report-orchestrator.ts:231-236
- What: When `collectAlerts=true` (catch-up path), alerts are recorded in the DB with status `'pending'` but never updated to `'sent'`. The caller aggregates and delivers them, but the DB still says pending.
- Why: On the next report for the same day (e.g., a manual `/daily` command or next scheduler run), `isAlertAlreadySent()` checks for `status='sent'`, finds `'pending'`, returns false. The same alerts are detected again, recorded (idempotent — returns existing ID), delivered a second time, and only then marked `'sent'`. Users see duplicate alert messages.
- How: After the aggregated catch-up alert message is successfully delivered (src/index.ts ~line 347), iterate over `allCatchUpAlerts` and call `db.recordAlert()` with `status: 'sent'` for each (or call `markAlertSent` on the existing IDs). Alternatively, change `processAlertsForReport` to accept a `markAsSent` callback that the caller invokes after aggregation delivery.
- Confidence: HIGH

### [HIGH] dispatch.ts monthly pre-fetch calculates wrong target month when snapshot is stale
- File: src/whatsapp/dispatch.ts:269-275
- What: The pre-fetch for `/monthly` with offset uses `snapshot.members[0]` year/month to compute the target month, but `monthly.ts:47` uses `getDataDateComponents()` (current JST date). When the snapshot is from a previous month, these disagree.
- Why: Example: It's June, snapshot is from May, user runs `/monthly 1`. Dispatch pre-fetches month 4 (April, based on snapshot month 5). Monthly report loads month 5 (May, based on current month 6). The pre-fetch is wasted — it fetched the wrong month entirely. If May isn't already on disk, the report silently falls back to the current snapshot (showing June data for a "last month" report).
- How: Change line 269 to use `getDataDateComponents()` instead of `snapshot.members[0]`:
  ```typescript
  const { year: curYear, month: curMonth } = getDataDateComponents();
  let targetMonth = curMonth - absOffset;
  let targetYear = curYear;
  ```
  This matches what `monthly.ts` and `report-orchestrator.ts:275` already do.
- Confidence: HIGH

### [HIGH] Monthly report silently shows wrong month when target snapshot unavailable
- File: src/reports/monthly.ts:44-60
- What: When offset > 0 and no previous-month snapshot exists on disk, the report falls back to the current snapshot with no warning. The comment on line 59 says "graceful fallback" but the user receives a report labeled "Mei 2026" that actually contains June data.
- Why: The user asked for last month's report and gets current month data with no indication anything went wrong. This is worse than showing an error — incorrect data presented confidently.
- How: When the fallback triggers and the loaded snapshot's month/year doesn't match the target month/year, prepend a warning line like `'⚠️ Data bulan ${targetMonth}-${targetYear} belum tersedia, menampilkan data terkini.'`. Or return an error string instead of falling back silently.
- Confidence: HIGH

### [HIGH] computeRollingAverage inflates averages by excluding zero-gain days
- File: src/data/daily-fans.ts:244-258
- What: `computeRollingAverage` only includes days where `gain > 0` in the average calculation (line 249). Zero-gain days are excluded from both numerator and denominator.
- Why: For a member active 3 out of 7 days (each gaining 1000), the reported average is 1000 instead of the true 428. This inflates the baseline used by `performance_drop` alerts (alerts.ts:67-76: `todayGain < avg7d * threshold`), causing false-positive alerts for members whose normal pattern includes zero-gain days (e.g., weekend-inactive players). It also misleads users in `/analyze` and `/compare` reports where "Rata-rata 7 Hari" is displayed.
- How: Either include zero-gain days in the average (change `if (gain > 0)` to `gains.push(gain)`), or rename the function to `computeActiveDayAverage` and document the behavior prominently. If zero-gain days should not lower the average, the threshold in performance_drop alerts should be adjusted to account for activity frequency.
- Confidence: HIGH

### [HIGH] Ghost detection can misclassify transfer members as 'left'
- File: src/reports/compute.ts:90-104
- What: Ghost detection sorts ALL members (including transfer members) by monthlyGain and reclassifies the bottom N as `'left'`. Transfer members who joined mid-month may have low monthlyGain and be incorrectly classified.
- Why: A transfer member who joined on day 20 might have monthlyGain of only 500, while the ghostCount is 3 and there are 3 members with 0 gain. But if there are also 2 stale members with 0 gain (who are real ghosts), the bottom 5 would include the 3 ghosts + 2 stale + the transfer member with 500. Wait — stale members have 0 gain, which is lower than 500. So the transfer member would NOT be in the bottom 5 if there are >= 5 members with lower gain. However, if ghostCount exceeds the number of true zero-gain members, transfer members with low gain become candidates. Example: member_count says 32 but snapshot has 35 (ghostCount=3), and only 1 member has zero gain — the bottom 3 would include 1 ghost + 2 legitimate low-gain members (possibly transfers).
- How: Exclude transfer members from ghost detection candidates. Add a filter before sorting:
  ```typescript
  const candidates = [...membersWithGain]
    .filter(m => !m.isTransfer)  // ghosts are members who LEFT, not transfers who JOINED
    .sort((a, b) => a.monthlyGain - b.monthlyGain);
  ```
  Adjust ghostCount accordingly: `Math.max(0, snapshot.members.length - nonTransferCount - snapshot.circle.member_count)`.
- Confidence: MEDIUM

### [MEDIUM] Quiet hours permanently suppress alerts with no retry mechanism
- File: src/alerts/alerts.ts:194-211
- What: During quiet hours, detected alerts are recorded as `'sent'` in the DB (line 204), making `isAlertAlreadySent()` return true forever. These alerts are never delivered.
- Why: The architecture doc notes this is intentional ("don't re-fire after quiet hours end"), but it means a demotion_risk or performance_drop alert that occurs at 23:01 (quiet hours start at 23:00) is permanently silenced. Users may not realize they missed a critical alert.
- How: Record suppressed alerts with status `'suppressed'` instead of `'sent'`. Add a post-quiet-hours check in the scheduler that delivers any suppressed alerts when quiet hours end. Or at minimum, log the suppressed alert details so admins can check.
- Confidence: HIGH

### [MEDIUM] catchup.ts combined report has persistence gap between combined and individual records
- File: src/scheduler/catchup.ts:217-230
- What: After sending a combined catch-up report, the combined run record is saved (line 218), then individual type records are written (lines 220-229), then saved again (line 230). A crash between line 218 and line 230 leaves individual types without 'sent' records.
- Why: On next restart, `isReportMissed` checks `getLastSuccessfulRun` for each individual type. Since individual records weren't persisted, daily/weekly/monthly are detected as missed again and re-sent as separate reports — duplicating the combined report that was already delivered.
- How: Move the individual `recordRun` calls and the final `db.save()` before the `sent++` / success logging, or combine all records into a single transaction with one `db.save()`.
- Confidence: HIGH

### [MEDIUM] Database save() uses writeFileSync, blocking event loop during catch-up
- File: src/db/database.ts:384-389
- What: `save()` calls `writeFileSync` which blocks the Node.js event loop. During catch-up, `save()` is called after each report (catchup.ts lines 193, 218, 230, 254), causing blocking I/O pauses between report sends.
- Why: With a 482-line sql.js DB, each export+write takes measurable time. During catch-up of 3+ reports, the blocking writes delay WhatsApp message delivery and heartbeat responses, potentially triggering reconnection timeouts.
- How: Replace `writeFileSync` with `writeFile` (async) or batch the catch-up saves into a single `save()` call at the end of `executeCatchUp` instead of after each individual report. The scheduler already relies on the 30-second auto-save for non-catch-up runs.
- Confidence: MEDIUM

### [LOW] isStaleMember function is dead code
- File: src/data/daily-fans.ts:220-226
- What: `isStaleMember()` is exported but never imported or called by any source file. Reports use `isStaleForReport()` instead (which uses consecutive zero-gain days rather than distance-from-latest-day).
- Why: Dead code increases maintenance surface and could confuse future contributors who might use it thinking it's the active stale-detection method. The two functions have different semantics — `isStaleMember` uses a simple distance check while `isStaleForReport` counts consecutive zero-gain days.
- How: Remove `isStaleMember` or mark it `@deprecated` with a pointer to `isStaleForReport`.
- Confidence: HIGH

## Modules Reviewed
- src/reports/compute.ts: 1 finding (ghost detection)
- src/data/daily-fans.ts: 2 findings (rolling average, dead code)
- src/scheduler/catchup.ts: 1 finding (persistence gap)
- src/alerts/alerts.ts: 1 finding (quiet hours)
- src/reports/combined.ts: clean
- src/reports/monthly.ts: 1 finding (silent fallback)
- src/data/snapshot.ts: clean
- src/whatsapp/dispatch.ts: 1 finding (pre-fetch month mismatch)
- src/config.ts: clean
- src/db/database.ts: 1 finding (blocking save)
- src/orchestrator/report-orchestrator.ts: 1 finding (alert marking)
- src/scheduler/scheduler.ts: clean (collision detection correct)
- src/scheduler/helpers.ts: clean
- src/whatsapp/client.ts: clean
- src/whatsapp/commands.ts: clean
- src/whatsapp/admin.ts: clean
- src/whatsapp/access.ts: clean
- src/reports/daily.ts: clean
- src/reports/weekly.ts: clean
- src/reports/ranks.ts: clean
- src/reports/bottom.ts: clean
- src/reports/stats.ts: clean
- src/reports/members.ts: clean
- src/reports/tier.ts: clean
- src/reports/compare.ts: clean
- src/reports/analyze.ts: clean
- src/reports/format.ts: clean
- src/api/server.ts: clean
- src/api/uma-moe.ts: clean
- src/utils/timezone.ts: clean
- src/utils/format.ts: clean
- src/utils/logger.ts: clean
- src/runtime.ts: clean
- src/types/index.ts: clean
- src/index.ts: clean (composition root, config watcher, catch-up aggregation all correct)
- src/utils/index.ts: clean

## Low-Confidence Notes
- [src/reports/compute.ts:93] Ghost detection sorts ALL members including already-'stale' ones. Stale members have 0 gain, which means they fill the bottom of the sort before transfer members. This mitigates the transfer misclassification in most cases, but the edge case where ghostCount > (zero-gain members + stale members) still exists.
- [src/data/daily-fans.ts:249] `computeRollingAverage` filtering `gain > 0` may be intentional design to measure "average when active" rather than "average over time." The alert threshold and user-facing labels should be re-evaluated if this behavior changes.
- [src/scheduler/catchup.ts:220-229] Individual record persistence gap only matters when process crashes mid-catch-up. In practice, catch-up completes in seconds, making the window very small. The 30s auto-save would also persist pending records if the crash is after the next auto-save tick.
- [src/alerts/alerts.ts:181] The `!` assertion on `displayParts.find((p) => p.type === 'hour')` is safe because `Intl.DateTimeFormat` with `hour: '2d'` always includes an hour part, but it would throw at runtime if the Intl implementation is non-standard.
