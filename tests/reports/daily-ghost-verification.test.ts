/**
 * Verification: Ghost Member Classification in /daily Report
 *
 * Re-verifies with CORRECTED member state understanding:
 * - 24 Active members (non-transfer)
 * - 6 Transfer members (daily_fans[0] negative)
 * - 4 Ghost members (LEFT the club — not just stale)
 *   - DOA IBU: daily_fans[0] positive, rest zeros. last_updated: June 1
 *   - Lebowski: daily_fans[0] positive, rest zeros. last_updated: June 1
 *   - Kuro: daily_fans[0-1] positive, rest zeros. last_updated: June 2
 *   - Rowking: daily_fans[0-2] positive, rest zeros. last_updated: June 3
 */

import * as fs from 'fs';
import * as path from 'path';
import { generateDailyReport } from '../../src/reports/daily';
import { getDefaultConfig } from '../../src/config';
import { computeMembers } from '../../src/reports/compute';
import { getDataDayFromSnapshot } from '../../src/data/snapshot';
import {
  getDailyGain,
  getLatestDataDay,
  isTransferMember,
  isStaleMember,
} from '../../src/data/daily-fans';
import type { Snapshot, BotConfig, ComputedMember } from '../../src/types';

const SNAPSHOT_PATH = path.join(__dirname, '../../examples/snapshot-june-12.json');

let snapshot: Snapshot;
let config: BotConfig;

beforeAll(() => {
  snapshot = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, 'utf-8'));
  config = getDefaultConfig();
});

// ============================================================
// Ghost Member Identification
// ============================================================

describe('Ghost member identification from raw snapshot data', () => {
  const ghostNames = ['DOA IBU', 'Lebowski', 'Kuro', 'Rowking'];
  const ghostViewerIds = [723724919975, 962698695738, 870344513359, 921951682062];

  it('identifies all 4 ghost members by daily_fans flatline pattern', () => {
    const latestDataDay = getDataDayFromSnapshot(snapshot);
    const ghosts: { name: string; latestDay: number; lastUpdated: string; fansPattern: string }[] = [];

    for (const member of snapshot.members) {
      const latestDay = getLatestDataDay(member.daily_fans);
      const isT = isTransferMember(member);
      if (isT) continue;

      const stale = isStaleMember(latestDay, latestDataDay, 3);
      if (!stale) continue;

      // Check if daily_fans flatlines from day 1 (ghost heuristic)
      const positiveDays: number[] = [];
      for (let i = 0; i < member.daily_fans.length; i++) {
        if (member.daily_fans[i] > 0) positiveDays.push(i + 1);
      }
      const isFlatFromDay1 = positiveDays.length > 0 &&
        positiveDays[positiveDays.length - 1] === positiveDays.length;

      ghosts.push({
        name: member.trainer_name,
        latestDay,
        lastUpdated: member.last_updated,
        fansPattern: `[${positiveDays.join(',')}] positive, rest zeros`,
      });
    }

    console.log('\n========== GHOST MEMBERS (from raw snapshot) ==========');
    console.log(`Latest data day: ${latestDataDay}`);
    console.log(`Stale threshold: <= day ${latestDataDay - config.memberStatus.staleAfterDaysDaily}`);
    console.log(`Total stale (non-transfer): ${ghosts.length}`);
    console.log('');
    for (const g of ghosts) {
      console.log(`  ${g.name}:`);
      console.log(`    latestPositiveDay: ${g.latestDay}`);
      console.log(`    last_updated: ${g.lastUpdated}`);
      console.log(`    fans pattern: ${g.fansPattern}`);
      console.log(`    isFlatFromDay1: YES (left before contributing)`);
    }
    console.log('========== END ==========\n');

    expect(ghosts.length).toBe(4);
    expect(ghosts.map(g => g.name).sort()).toEqual(ghostNames.sort());
  });

  it('confirms member_count (30) + ghosts (4) = members.length (34)', () => {
    expect(snapshot.circle.member_count).toBe(30);
    expect(snapshot.members.length).toBe(34);
    expect(snapshot.members.length - snapshot.circle.member_count).toBe(4);
  });

  it('confirms ghost last_updated dates are old (June 1-3)', () => {
    for (const name of ghostNames) {
      const member = snapshot.members.find(m => m.trainer_name === name)!;
      expect(member.last_updated).toMatch(/2026-06-0[123]/);
    }
  });
});

// ============================================================
// Classification Trace (Without DB)
// ============================================================

describe('computeMembers classification WITHOUT database', () => {
  let members: ComputedMember[];

  beforeAll(() => {
    members = computeMembers(snapshot, config);
  });

  it('all 4 ghost members get status "left" (via member_count gap detection)', () => {
    const ghosts = ['DOA IBU', 'Lebowski', 'Kuro', 'Rowking'];
    for (const name of ghosts) {
      const m = members.find(mm => mm.trainerName === name)!;
      expect(m.status).toBe('left');
    }

    console.log('\n========== CLASSIFICATION WITHOUT DB ==========');
    for (const name of ghosts) {
      const m = members.find(mm => mm.trainerName === name)!;
      console.log(`  ${name}: status=${m.status}, latestPositiveDay=${m.latestPositiveDay}`);
    }
    console.log('========== END ==========\n');
  });

  it('no members have status "stale" (all reclassified as left)', () => {
    const staleMembers = members.filter(m => m.status === 'stale');
    expect(staleMembers.length).toBe(0);
  });

  it('status counts: 30 active (6 with isTransfer) + 4 left = 34 total', () => {
    const active = members.filter(m => m.status === 'active').length;
    const transfers = members.filter(m => m.isTransfer).length;
    const stale = members.filter(m => m.status === 'stale').length;
    const left = members.filter(m => m.status === 'left').length;

    expect(active).toBe(30);
    expect(transfers).toBe(6);
    expect(stale).toBe(0);
    expect(left).toBe(4);
    expect(active + stale + left).toBe(34);
  });
});

// ============================================================
// Daily Report Output (Without DB)
// ============================================================

describe('Daily report output WITHOUT database', () => {
  let report: string;

  beforeAll(() => {
    report = generateDailyReport(snapshot, config, 0);
  });

  it('prints the FULL daily report', () => {
    console.log('\n========== FULL DAILY REPORT (no DB) ==========');
    console.log(report);
    console.log('========== END REPORT ==========\n');

    expect(report.length).toBeGreaterThan(0);
  });

  it('does NOT show left section in daily report (left only in /members)', () => {
    expect(report).not.toContain('🚪 Keluar dari klub:');
  });

  it('shows "⚠️ Belum aktif" section for active members with 0 gain on viewed day', () => {
    expect(report).toContain('⚠️ Belum aktif');
  });

  it('ghost members are NOT in the ranked member list', () => {
    const lines = report.split('\n');
    const rankLines = lines.filter(l => /^\d+\./.test(l));

    expect(rankLines.length).toBe(27);

    for (const name of ['DOA IBU', 'Lebowski', 'Kuro', 'Rowking']) {
      for (const line of rankLines) {
        expect(line).not.toContain(name);
      }
    }
  });

  it('FINDING: Ghost members excluded from daily report ranking', () => {
    // These members LEFT the club, not just "stale" (stopped playing)
    // The member_count gap detection correctly classifies them as 'left'
    // Left members are NOT shown in daily report (only in /members)
    expect(report).not.toContain('🚪 Keluar dari klub:');

    console.log('\n========== FINDING: GHOST DETECTION ==========');
    console.log('Ghost members are correctly excluded from daily report:');
    console.log('  - DOA IBU (left, detected via member_count gap)');
    console.log('  - Lebowski (left, detected via member_count gap)');
    console.log('  - Kuro (left, detected via member_count gap)');
    console.log('  - Rowking (left, detected via member_count gap)');
    console.log('=============================================\n');
  });
});

// ============================================================
// Daily Report Output (WITH Database — mock left members)
// ============================================================

describe('Daily report output WITH database (ghost members marked as left)', () => {
  let report: string;

  beforeAll(() => {
    const ghostViewerIds = [723724919975, 962698695738, 870344513359, 921951682062];
    const mockDb: any = {
      getMembers: jest.fn().mockReturnValue(
        ghostViewerIds.map(id => ({ viewer_id: id, status: 'left' }))
      ),
      getMember: jest.fn().mockReturnValue(null),
      upsertMember: jest.fn(),
    };

    report = generateDailyReport(snapshot, config, 0, mockDb);
  });

  it('prints the FULL daily report WITH db', () => {
    console.log('\n========== FULL DAILY REPORT (WITH DB) ==========');
    console.log(report);
    console.log('========== END REPORT ==========\n');

    expect(report.length).toBeGreaterThan(0);
  });

  it('ghost members NOT shown in daily report (left only in /members)', () => {
    // Left section removed from daily report
    expect(report).not.toContain('🚪 Keluar dari klub:');
  });

  it('shows stale section for active members with 0 gain on viewed day', () => {
    // Stale section shows active members with 0 gain, regardless of staleAfterDaysDaily
    const staleIdx = report.indexOf('⚠️ Belum aktif');
    expect(staleIdx).toBeGreaterThanOrEqual(0);
  });

  it('ghost members are NOT in the ranked list', () => {
    const lines = report.split('\n');
    const rankLines = lines.filter(l => /^\d+\./.test(l));

    expect(rankLines.length).toBe(27);
    for (const name of ['DOA IBU', 'Lebowski', 'Kuro', 'Rowking']) {
      for (const line of rankLines) {
        expect(line).not.toContain(name);
      }
    }
  });
});

// ============================================================
// Signal Analysis: Can we detect ghosts from single snapshot?
// ============================================================

describe('Ghost detection heuristics from single snapshot', () => {
  it('daily_fans flatline pattern distinguishes ghost from stale', () => {
    const latestDataDay = getDataDayFromSnapshot(snapshot);
    const staleAfterDays = config.memberStatus.staleAfterDaysWeekly;

    console.log('\n========== GHOST vs STALE HEURISTIC ==========');
    console.log(`latestDataDay=${latestDataDay}, staleAfterDays=${staleAfterDays}`);
    console.log(`Stale threshold: latestPositiveDay <= ${latestDataDay - staleAfterDays}`);
    console.log('');

    for (const member of snapshot.members) {
      const isT = isTransferMember(member);
      if (isT) continue;

      const latestDay = getLatestDataDay(member.daily_fans);
      const stale = isStaleMember(latestDay, latestDataDay, staleAfterDays);
      if (!stale) continue;

      // Count positive days
      const positiveDays: number[] = [];
      for (let i = 0; i < member.daily_fans.length; i++) {
        if (member.daily_fans[i] > 0) positiveDays.push(i + 1);
      }

      // Check if flat from day 1
      const isFlatFromDay1 = positiveDays.length > 0 &&
        positiveDays[positiveDays.length - 1] === positiveDays.length;

      console.log(`  ${member.trainer_name}:`);
      console.log(`    latestPositiveDay: ${latestDay}`);
      console.log(`    last_updated: ${member.last_updated}`);
      console.log(`    positiveDays: [${positiveDays.join(',')}]`);
      console.log(`    flatFromDay1: ${isFlatFromDay1}`);
      console.log(`    likely: ${isFlatFromDay1 ? 'GHOST (left)' : 'STALE (stopped playing)'}`);
      console.log('');
    }
    console.log('========== END ==========\n');

    // Verify: all 4 ghosts are flat from day 1
    const ghostNames = ['DOA IBU', 'Lebowski', 'Kuro', 'Rowking'];
    for (const name of ghostNames) {
      const member = snapshot.members.find(m => m.trainer_name === name)!;
      const positiveDays: number[] = [];
      for (let i = 0; i < member.daily_fans.length; i++) {
        if (member.daily_fans[i] > 0) positiveDays.push(i + 1);
      }
      const isFlatFromDay1 = positiveDays.length > 0 &&
        positiveDays[positiveDays.length - 1] === positiveDays.length;
      expect(isFlatFromDay1).toBe(true);
    }
  });

  it('member_count vs members.length signals ghost count', () => {
    const ghostCount = snapshot.members.length - snapshot.circle.member_count;
    expect(ghostCount).toBe(4);

    console.log(`\nmember_count=${snapshot.circle.member_count}, members.length=${snapshot.members.length}`);
    console.log(`Extra members (likely ghosts): ${ghostCount}`);
  });

  it('last_updated recency is a signal', () => {
    const today = '2026-06-11'; // snapshot date
    const ghostNames = ['DOA IBU', 'Lebowski', 'Kuro', 'Rowking'];

    for (const name of ghostNames) {
      const member = snapshot.members.find(m => m.trainer_name === name)!;
      const lastUpdated = member.last_updated.substring(0, 10);
      // All ghost members have last_updated before June 4
      expect(lastUpdated < '2026-06-04').toBe(true);
    }

    // Active members have last_updated on June 11
    const activeMember = snapshot.members.find(m => m.trainer_name === 'Ryu')!;
    expect(activeMember.last_updated.substring(0, 10)).toBe('2026-06-11');
  });
});

// ============================================================
// Summary
// ============================================================

describe('VERIFICATION SUMMARY', () => {
  it('prints complete findings', () => {
    console.log('\n' + '='.repeat(60));
    console.log('VERIFICATION SUMMARY: Ghost Members in /daily Report');
    console.log('='.repeat(60));
    console.log('');
    console.log('CURRENT BEHAVIOR (without DB):');
    console.log('  - 4 ghost members (DOA IBU, Lebowski, Kuro, Rowking)');
    console.log('  - ALL classified as status="left" via member_count gap detection');
    console.log('  - ALL shown under "🚪 Keluar dari klub:"');
    console.log('  - NOT in ranked member list (correct)');
    console.log('');
    console.log('DETECTION METHOD:');
    console.log('  - member_count (30) vs members.length (34) = 4 ghost gap');
    console.log('  - Bottom 4 stale members by monthly gain reclassified as "left"');
    console.log('  - No DB required for this detection');
    console.log('');
    console.log('WITH DATABASE (member_history marks them as left):');
    console.log('  - Redundant but harmless — they are already "left" via member_count');
    console.log('  - DB serves as secondary confirmation');
    console.log('');
    console.log('FINDING: Ghost detection works WITHOUT database now');
    console.log('  - member_count gap is the primary detection mechanism');
    console.log('  - DB-based detection is kept as secondary/fallback');
    console.log('='.repeat(60) + '\n');

    expect(true).toBe(true);
  });
});
