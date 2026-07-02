/**
 * /bottom Command — full Tests
 *
 * Tests the bottom report through unit-level verification.
 * Uses real snapshot (examples/snapshot-june-12.json, 34 members).
 * Uses getDefaultConfig() for deterministic Zod defaults.
 */

import { generateBottomReport } from '../../src/reports/bottom';
import { getDefaultConfig } from '../../src/config';
import { getDataDayFromSnapshot } from '../../src/data/snapshot';
import {
  getMonthlyGain,
  isTransferMember,
} from '../../src/data/daily-fans';
import { formatNumber } from '../../src/utils/format';
import { computeMembers } from '../../src/reports/compute';
import type { Snapshot, BotConfig } from '../../src/types';
import { loadRealSnapshot, STALE_NAMES, WHATSAPP_MAX_LENGTH } from '../_helpers';

let snapshot: Snapshot;
let config: BotConfig;

beforeAll(() => {
  snapshot = loadRealSnapshot();
  config = getDefaultConfig();
});

function makeConfig(overrides: Partial<Omit<BotConfig, 'requirements' | 'memberStatus'> & { requirements?: Partial<BotConfig['requirements']>; memberStatus?: Partial<BotConfig['memberStatus']> }> = {}): BotConfig {
  const base = getDefaultConfig();
  return {
    ...base,
    ...overrides,
    requirements: { ...base.requirements, ...(overrides.requirements ?? {}) },
    memberStatus: { ...base.memberStatus, ...(overrides.memberStatus ?? {}) },
  };
}


describe('Bottom report: full output and basic structure', () => {
  let report: string;

  beforeAll(() => {
    report = generateBottomReport(snapshot, config, computeMembers(snapshot, config));
  });

  it('prints the full report for visual verification', () => {
    expect(report.length).toBeGreaterThan(0);
  });

  it('header structure', () => {
    const lines = report.split('\n');
    expect(lines[0]).toBe('\ud83d\udcc9 *Perlu Perhatian*');
    expect(lines[1]).toBe('');
    expect(lines[2]).toBe('Hol＿Horse | A+ (#431)');
    expect(lines[3]).toBe('Periode data: 11 Juni 2026, 22:00 WIB');
    expect(lines[4]).toBe('');
    expect(lines[5]).toBe(`🎯 Target bulanan: ${formatNumber(config.requirements.monthlyFans)}`);
  });

  it('weeklyFans=0 so no weekly target line', () => {
    expect(config.requirements.weeklyFans).toBe(0);
    expect(report).not.toContain('Target mingguan');
  });

  it('has exactly 10 numbered member lines', () => {
    const memberLines = report.split('\n').filter((l) => /^\d+\.\s/.test(l));
    expect(memberLines.length).toBe(10);
  });

  it('output length is under WhatsApp 4096 limit', () => {
    expect(report.length).toBeLessThanOrEqual(WHATSAPP_MAX_LENGTH);
  });
});


describe('Bottom report: member classification', () => {
  it('4 left members (ghosts detected via member_count)', () => {
    const members = computeMembers(snapshot, config);
    const leftNames = members
      .filter((m) => m.status === 'left')
      .map((m) => m.trainerName)
      .sort();
    expect(leftNames).toEqual([...STALE_NAMES].sort());
  });

  it('6 transfer members', () => {
    const members = computeMembers(snapshot, config);
    const transferNames = members
      .filter((m) => m.isTransfer)
      .map((m) => m.trainerName)
      .sort();
    expect(transferNames).toEqual(
      ['Ceciria', 'Falkrum', 'Sairen', 'TheTengOne', 'VitoHoow', 'Zero']
    );
  });

  it('30 contributing members (active)', () => {
    const members = computeMembers(snapshot, config);
    const contributing = members.filter(
      (m) => m.status === 'active'
    );
    expect(contributing.length).toBe(30);
  });

  it('left members excluded from bottom list', () => {
    const report = generateBottomReport(snapshot, config, computeMembers(snapshot, config));
    const memberLines = report.split('\n').filter((l) => /^\d+\.\s/.test(l));
    for (const name of STALE_NAMES) {
      for (const line of memberLines) {
        expect(line).not.toContain(name);
      }
    }
  });

  it('no left section in bottom report (left only in /members)', () => {
    const report = generateBottomReport(snapshot, config, computeMembers(snapshot, config));
    expect(report).not.toContain('🚪 Keluar dari klub:');
  });
});


describe('Bottom report: sort order', () => {
  it('members sorted by monthlyGain ascending (lowest first)', () => {
    const report = generateBottomReport(snapshot, config, computeMembers(snapshot, config));
    const memberLines = report.split('\n').filter((l) => /^\d+\.\s/.test(l));

    const members = computeMembers(snapshot, config);
    const contributing = members
      .filter((m) => m.status === 'active')
      .sort((a, b) => a.monthlyGain - b.monthlyGain)
      .slice(0, 10);

    for (let i = 0; i < 10; i++) {
      expect(memberLines[i]).toContain(contributing[i].trainerName);
    }
  });

  it('each member gain >= previous in list', () => {
    const members = computeMembers(snapshot, config);
    const contributing = members
      .filter((m) => m.status === 'active')
      .sort((a, b) => a.monthlyGain - b.monthlyGain)
      .slice(0, 10);
    for (let i = 1; i < contributing.length; i++) {
      expect(contributing[i].monthlyGain).toBeGreaterThanOrEqual(
        contributing[i - 1].monthlyGain
      );
    }
  });
});


describe('Bottom report: individual member calculations', () => {
  let report: string;
  let memberLines: string[];
  const dataDay = 11;
  const daysInMonth = 30;

  beforeAll(() => {
    report = generateBottomReport(snapshot, config, computeMembers(snapshot, config));
    memberLines = report.split('\n').filter((l) => /^\d+\.\s/.test(l));
  });

  function verifyMember(
    rank: number,
    name: string,
    expectedGain: number,
    isTransfer: boolean
  ) {
    const line = memberLines[rank - 1];
    const expectedGainStr = formatNumber(expectedGain);
    const monthlyTarget = config.requirements.monthlyFans;
    const deficit = monthlyTarget - expectedGain;
    const proj = Math.round((expectedGain / dataDay) * daysInMonth);
    const badge = isTransfer ? ' \ud83d\udd04' : '';
    const deficitStr =
      deficit > 0 ? ` (kurang ${formatNumber(deficit)})` : ' \u2705';
    const projStr =
      proj < monthlyTarget ? ` \u2192 ~${formatNumber(proj)}` : '';
    const expected = `${rank}. *${name}*${badge} \u2014 +${expectedGainStr}${deficitStr}${projStr}`;
    expect(line).toBe(expected);
  }

  it('1. Yukil: gain=4,567,387 -> 4.6M', () => {
    const m = snapshot.members.find((mm) => mm.trainer_name === 'Yukil')!;
    expect(getMonthlyGain(m.daily_fans)).toBe(4567387);
    verifyMember(1, 'Yukil', 4567387, false);
  });

  it('2. Amanda: gain=5,315,166 -> 5.3M', () => {
    const m = snapshot.members.find((mm) => mm.trainer_name === 'Amanda')!;
    expect(getMonthlyGain(m.daily_fans)).toBe(5315166);
    verifyMember(2, 'Amanda', 5315166, false);
  });

  it('3. naku: gain=6,133,718 -> 6.1M', () => {
    const m = snapshot.members.find((mm) => mm.trainer_name === 'naku')!;
    expect(getMonthlyGain(m.daily_fans)).toBe(6133718);
    verifyMember(3, 'naku', 6133718, false);
  });

  it('4. TheTengOne (transfer): gain=6,334,792 -> 6.3M', () => {
    const m = snapshot.members.find((mm) => mm.trainer_name === 'TheTengOne')!;
    expect(getMonthlyGain(m.daily_fans)).toBe(6334792);
    expect(isTransferMember(m)).toBe(true);
    verifyMember(4, 'TheTengOne', 6334792, true);
  });

  it('5. VitoHoow (transfer): gain=6,449,643 -> 6.4M', () => {
    const m = snapshot.members.find((mm) => mm.trainer_name === 'VitoHoow')!;
    expect(getMonthlyGain(m.daily_fans)).toBe(6449643);
    expect(isTransferMember(m)).toBe(true);
    verifyMember(5, 'VitoHoow', 6449643, true);
  });

  it('6. Ignis: gain=6,534,747 -> 6.5M', () => {
    const m = snapshot.members.find((mm) => mm.trainer_name === 'Ignis')!;
    expect(getMonthlyGain(m.daily_fans)).toBe(6534747);
    verifyMember(6, 'Ignis', 6534747, false);
  });

  it('7. ursa: gain=6,565,016 -> 6.6M', () => {
    const m = snapshot.members.find((mm) => mm.trainer_name === 'ursa')!;
    expect(getMonthlyGain(m.daily_fans)).toBe(6565016);
    verifyMember(7, 'ursa', 6565016, false);
  });

  it('8. Ernstormen: gain=6,696,062 -> 6.7M', () => {
    const m = snapshot.members.find((mm) => mm.trainer_name === 'Ernstormen')!;
    expect(getMonthlyGain(m.daily_fans)).toBe(6696062);
    verifyMember(8, 'Ernstormen', 6696062, false);
  });

  it('9. FreNzQuiN: gain=6,696,949 -> 6.7M', () => {
    const m = snapshot.members.find((mm) => mm.trainer_name === 'FreNzQuiN')!;
    expect(getMonthlyGain(m.daily_fans)).toBe(6696949);
    verifyMember(9, 'FreNzQuiN', 6696949, false);
  });

  it('10. jgd: gain=7,491,831 -> 7.5M', () => {
    const m = snapshot.members.find((mm) => mm.trainer_name === 'jgd')!;
    expect(getMonthlyGain(m.daily_fans)).toBe(7491831);
    verifyMember(10, 'jgd', 7491831, false);
  });

  it('all 10 have deficit (monthlyGain < target)', () => {
    const members = computeMembers(snapshot, config);
    const contributing = members
      .filter((m) => m.status === 'active')
      .sort((a, b) => a.monthlyGain - b.monthlyGain)
      .slice(0, 10);
    for (const m of contributing) {
      expect(m.monthlyGain).toBeLessThan(config.requirements.monthlyFans);
    }
  });
});


describe('Bottom report: transfer badges', () => {
  it('transfer members in bottom list show badge', () => {
    const report = generateBottomReport(snapshot, config, computeMembers(snapshot, config));
    expect(report).toContain('*TheTengOne* \ud83d\udd04');
    expect(report).toContain('*VitoHoow* \ud83d\udd04');
  });

  it('non-transfer members have no badge', () => {
    const report = generateBottomReport(snapshot, config, computeMembers(snapshot, config));
    const memberLines = report.split('\n').filter((l) => /^\d+\.\s/.test(l));
    for (const line of memberLines) {
      if (!line.includes('TheTengOne') && !line.includes('VitoHoow')) {
        expect(line).not.toContain('\ud83d\udd04');
      }
    }
  });
});


describe('Bottom report: WhatsApp formatting', () => {
  let report: string;

  beforeAll(() => {
    report = generateBottomReport(snapshot, config, computeMembers(snapshot, config));
  });

  it('no Markdown bold (**text**)', () => {
    expect(report).not.toMatch(/\*\*[^*]+\*\*/);
  });

  it('no Markdown headers', () => {
    for (const line of report.split('\n')) {
      expect(line).not.toMatch(/^#{1,6}\s/);
    }
  });

  it('uses numbered format for member list', () => {
    expect(report).toContain('1. *Yukil*');
  });

  it('uses Indonesian labels', () => {
    expect(report).toContain('Target bulanan');
    expect(report).toContain('kurang');
  });

  it('no English month names', () => {
    expect(report).not.toContain('June');
  });
});


describe('Bottom report: edge cases', () => {
  it('empty members array returns warning', () => {
    const emptySnap: Snapshot = { ...snapshot, members: [] };
    const result = generateBottomReport(emptySnap, config, computeMembers(emptySnap, config));
    expect(result).toBe(
      'ℹ️ *Perlu Perhatian*\nData anggota belum tersedia untuk analisis.'
    );
  });

  it('all members meet requirement -> all show checkmark', () => {
    const cfg = makeConfig({
      requirements: { monthlyFans: 1, weeklyFans: 0, weeksInMonthEquivalent: 4.2857 },
    });
    const report = generateBottomReport(snapshot, cfg, computeMembers(snapshot, cfg));
    const memberLines = report.split('\n').filter((l) => /^\d+\.\s/.test(l));
    for (const line of memberLines) {
      expect(line).toContain('\u2705');
      expect(line).not.toContain('kurang');
      expect(line).not.toContain('\u2192');
    }
  });

  it('monthlyFans=0 -> all show checkmark', () => {
    const cfg = makeConfig({
      requirements: { monthlyFans: 0, weeklyFans: 0, weeksInMonthEquivalent: 4.2857 },
    });
    const report = generateBottomReport(snapshot, cfg, computeMembers(snapshot, cfg));
    const memberLines = report.split('\n').filter((l) => /^\d+\.\s/.test(l));
    for (const line of memberLines) {
      expect(line).toContain('\u2705');
    }
  });

  it('weeklyFans > 0 shows both targets', () => {
    const cfg = makeConfig({
      requirements: { monthlyFans: 25000000, weeklyFans: 5000000, weeksInMonthEquivalent: 4.2857 },
    });
    const report = generateBottomReport(snapshot, cfg, computeMembers(snapshot, cfg));
    expect(report).toContain('Target bulanan: 25.0M');
    expect(report).toContain('Target mingguan: 5.0M');
  });

  it('single member snapshot', () => {
    const singleSnap: Snapshot = { ...snapshot, members: [snapshot.members[0]] };
    const report = generateBottomReport(singleSnap, config, computeMembers(singleSnap, config));
    expect(report).toContain('Hol＿Horse');
    const memberLines = report.split('\n').filter((l) => /^\d+\.\s/.test(l));
    expect(memberLines.length).toBe(1);
    expect(memberLines[0]).toContain('Ryu');
  });

  it('fewer than 10 contributing members -> shows all', () => {
    const limitedSnap: Snapshot = {
      ...snapshot,
      members: snapshot.members.filter(
        (m) => m.trainer_name === 'Yukil' || m.trainer_name === 'Amanda'
      ),
    };
    const report = generateBottomReport(limitedSnap, config, computeMembers(limitedSnap, config));
    const memberLines = report.split('\n').filter((l) => /^\d+\.\s/.test(l));
    expect(memberLines.length).toBe(2);
    expect(memberLines[0]).toContain('Yukil');
    expect(memberLines[1]).toContain('Amanda');
  });

  it('projection hidden when projected >= target', () => {
    const cfg = makeConfig({
      requirements: { monthlyFans: 1, weeklyFans: 0, weeksInMonthEquivalent: 4.2857 },
    });
    const report = generateBottomReport(snapshot, cfg, computeMembers(snapshot, cfg));
    const memberLines = report.split('\n').filter((l) => /^\d+\.\s/.test(l));
    for (const line of memberLines) {
      expect(line).not.toContain('\u2192');
    }
  });

  it('uses source data day (11), not an offset', () => {
    expect(getDataDayFromSnapshot(snapshot)).toBe(11);
    const report = generateBottomReport(snapshot, config, computeMembers(snapshot, config));
    expect(report).toContain('Perlu Perhatian');
  });

  it('daysInMonth=30 for June', () => {
    const { year, month } = snapshot.members[0];
    expect(year).toBe(2026);
    expect(month).toBe(6);
    expect(new Date(year, month, 0).getDate()).toBe(30);
  });
});
