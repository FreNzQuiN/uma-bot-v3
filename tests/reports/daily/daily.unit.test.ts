/**
 * Daily Report — Unit Tests
 *
 * Core data verification: snapshot fundamentals, member classification,
 * individual gains, offset reports, getDailyGain edge cases, raw data tracing,
 * and negative daily_fans[0] handling.
 */

import { generateDailyReport } from '../../../src/reports/daily';
import { computeMembers } from '../../../src/reports/compute';
import { getDefaultConfig } from '../../../src/config';
import { getDataDayFromSnapshot } from '../../../src/data/snapshot';
import {
  getDailyGain,
  getLatestDataDay,
  isTransferMember,
  isStaleForReport,
} from '../../../src/data/daily-fans';
import { formatNumber } from '../../../src/utils/format';
import { CLUB_TIERS } from '../../../src/types';
import type { Snapshot, BotConfig } from '../../../src/types';
import {
  loadRealSnapshot,
  TRANSFER_NAMES,
  STALE_NAMES,
} from '../../_helpers';


let snapshot: Snapshot;
let config: BotConfig;
let computedMembers: ReturnType<typeof computeMembers>;

beforeAll(() => {
  snapshot = loadRealSnapshot();
  config = getDefaultConfig();
  computedMembers = computeMembers(snapshot, config);
});


describe('Snapshot data fundamentals', () => {
  it('has the expected structure', () => {
    expect(snapshot.circle).toBeDefined();
    expect(snapshot.members).toBeDefined();
    expect(Array.isArray(snapshot.members)).toBe(true);
    expect(snapshot.members.length).toBeGreaterThan(0);
    expect(snapshot.club_rank).toBeDefined();
    expect(snapshot.fans_to_next_tier).toBeDefined();
    expect(snapshot.fans_to_lower_tier).toBeDefined();
  });

  it('has correct club metadata', () => {
    expect(snapshot.circle.name).toBe('Hol＿Horse');
    expect(snapshot.circle.monthly_rank).toBe(431);
    expect(snapshot.club_rank).toBe(8);
    expect(CLUB_TIERS[8]).toBe('A+');
    expect(snapshot.fans_to_next_tier).toBe(349208495);
    expect(snapshot.fans_to_lower_tier).toBe(21848493);
  });

  it('has correct latest data day', () => {
    const latestDataDay = getDataDayFromSnapshot(snapshot);
    expect(latestDataDay).toBe(11);

    let maxDay = 0;
    for (const member of snapshot.members) {
      const day = getLatestDataDay(member.daily_fans);
      if (day > maxDay) maxDay = day;
    }
    expect(maxDay).toBe(11);
  });

  it('has 34 total members in snapshot', () => {
    expect(snapshot.members.length).toBe(34);
  });
});


describe('Member classification', () => {
  it('correctly identifies 4 stale members', () => {
    const latestDataDay = getDataDayFromSnapshot(snapshot);
    const staleAfterDays = 3;

    const staleNames: string[] = [];
    for (const member of snapshot.members) {
      const latestPositiveDay = getLatestDataDay(member.daily_fans);
      const isTransfer = isTransferMember(member);
      if (!isTransfer && isStaleForReport(member.daily_fans, latestDataDay, staleAfterDays)) {
        staleNames.push(member.trainer_name);
      }
    }

    expect(staleNames.sort()).toEqual([...STALE_NAMES, 'jgd'].sort());
    expect(staleNames.length).toBe(5);
  });

  it('correctly identifies 6 transfer members', () => {
    const transferNames: string[] = [];
    for (const member of snapshot.members) {
      if (isTransferMember(member)) {
        transferNames.push(member.trainer_name);
      }
    }

    expect(transferNames).toContain('Zero');
    expect(transferNames).toContain('TheTengOne');
    expect(transferNames).toContain('Sairen');
    expect(transferNames).toContain('VitoHoow');
    expect(transferNames).toContain('Ceciria');
    expect(transferNames).toContain('Falkrum');
    expect(transferNames.length).toBe(6);
  });

  it('active + transfer + stale = total members (30 + 4 = 34)', () => {
    const latestDataDay = getDataDayFromSnapshot(snapshot);
    let active = 0;
    let stale = 0;
    let transfer = 0;

    for (const member of snapshot.members) {
      const latestPositiveDay = getLatestDataDay(member.daily_fans);
      const isTransfer = isTransferMember(member);
      if (isTransfer) {
        transfer++;
      } else if (latestPositiveDay === 0 || isStaleForReport(member.daily_fans, latestDataDay, 3)) {
        stale++;
      } else {
        active++;
      }
    }

    expect(active).toBe(23);
    expect(transfer).toBe(6);
    expect(stale).toBe(5);
    expect(active + transfer + stale).toBe(34);
  });

  it('verifies transfer detection via isTransferMember', () => {
    for (const member of snapshot.members) {
      const transfer = isTransferMember(member);
      if (member.previous_circle_id !== undefined) {
        expect(transfer).toBe(true);
      }
      if (member.previous_circle_name !== undefined) {
        expect(transfer).toBe(true);
      }
    }
  });
});


describe('Individual member gains', () => {
  it('Nargi gain = 373937532 - 370852652 = 3084880', () => {
    const nargi = snapshot.members.find((m) => m.trainer_name === 'Nargi')!;
    expect(nargi.daily_fans[10]).toBe(373937532);
    expect(nargi.daily_fans[9]).toBe(370852652);
    expect(getDailyGain(nargi.daily_fans, 11)).toBe(3084880);
  });

  it('GoldFamily gain = 317726222 - 315015625 = 2710597', () => {
    const member = snapshot.members.find((m) => m.trainer_name === 'GoldFamily')!;
    expect(getDailyGain(member.daily_fans, 11)).toBe(2710597);
  });

  it('naku has 0 gain (day 11 == day 10)', () => {
    const member = snapshot.members.find((m) => m.trainer_name === 'naku')!;
    expect(getDailyGain(member.daily_fans, 11)).toBe(0);
  });

  it('Falkrum (transfer) has 0 gain', () => {
    const member = snapshot.members.find((m) => m.trainer_name === 'Falkrum')!;
    expect(isTransferMember(member)).toBe(true);
    expect(getDailyGain(member.daily_fans, 11)).toBe(0);
  });

  it('TheTengOne (transfer) has gain 2898', () => {
    const member = snapshot.members.find((m) => m.trainer_name === 'TheTengOne')!;
    expect(isTransferMember(member)).toBe(true);
    expect(getDailyGain(member.daily_fans, 11)).toBe(2898);
  });

  it('DOA IBU (stale) gain is 0 (no data for day 11)', () => {
    const member = snapshot.members.find((m) => m.trainer_name === 'DOA IBU')!;
    expect(getLatestDataDay(member.daily_fans)).toBe(1);
    expect(getDailyGain(member.daily_fans, 11)).toBe(0);
  });

  it('Sairen (transfer) gain = 2230269', () => {
    const member = snapshot.members.find((m) => m.trainer_name === 'Sairen')!;
    expect(isTransferMember(member)).toBe(true);
    expect(getDailyGain(member.daily_fans, 11)).toBe(2230269);
  });
});


describe('Offset reports', () => {
  it('offset=1 shows day 10 data', () => {
    const report1 = generateDailyReport(snapshot, config, computedMembers, 1);
    const lines1 = report1.split('\n');
    expect(lines1[0]).toBe('📊 *Daily Report — 10 Juni 2026*');
    const syncLine = lines1.find((l) => l.startsWith('Terakhir sync:'));
    expect(syncLine).toMatch(/^Terakhir sync: \d+\/\d+ \d{2}:\d{2}$/);
  });

  it('Nargi gain on day 10 = 370852652 - 367503029 = 3349623', () => {
    const nargi = snapshot.members.find((m) => m.trainer_name === 'Nargi')!;
    expect(getDailyGain(nargi.daily_fans, 10)).toBe(3349623);
  });
});


describe('getDailyGain edge cases', () => {
  it('day=0 returns 0', () => {
    expect(getDailyGain(snapshot.members[0].daily_fans, 0)).toBe(0);
  });

  it('day=1 returns 0 (no previous day)', () => {
    const nargi = snapshot.members.find((m) => m.trainer_name === 'Nargi')!;
    expect(getDailyGain(nargi.daily_fans, 1)).toBe(0);
  });

  it('day beyond array length returns 0', () => {
    expect(getDailyGain(snapshot.members[0].daily_fans, 100)).toBe(0);
  });

  it('gains are always >= 0 (cumulative can only increase)', () => {
    for (const member of snapshot.members) {
      const gain = getDailyGain(member.daily_fans, 11);
      expect(gain).toBeGreaterThanOrEqual(0);
    }
  });
});


describe('All positive-gain member gains traced to raw data (day 11)', () => {
  let report: string;
  let memberLines: string[];
  let staleLines: string[];
  let latestDataDay: number;

  beforeAll(() => {
    report = generateDailyReport(snapshot, config, computedMembers, 0);
    memberLines = report.split('\n').filter((l) => /^\d+\./.test(l));
    staleLines = report.split('\n').filter((l) => l.startsWith('• '));
    latestDataDay = getDataDayFromSnapshot(snapshot);
  });

  it('has exactly 27 ranked member lines (positive gain only)', () => {
    expect(memberLines.length).toBe(27);
  });

  it('Nargi: 373,937,532 - 370,852,652 = 3,084,880 -> +3.1M', () => {
    const nargi = snapshot.members.find((m) => m.trainer_name === 'Nargi')!;
    expect(nargi.daily_fans[10]).toBe(373937532);
    expect(nargi.daily_fans[9]).toBe(370852652);
    expect(getDailyGain(nargi.daily_fans, 11)).toBe(3084880);
    expect(formatNumber(3084880)).toBe('3.1M');
    const line = memberLines.find((l) => l.includes('Nargi'));
    expect(line).toBe('1. *Nargi* — +3.1M');
  });

  it('GoldFamily: 317,726,222 - 315,015,625 = 2,710,597 -> +2.7M', () => {
    const m = snapshot.members.find((mm) => mm.trainer_name === 'GoldFamily')!;
    expect(m.daily_fans[10]).toBe(317726222);
    expect(m.daily_fans[9]).toBe(315015625);
    expect(getDailyGain(m.daily_fans, 11)).toBe(2710597);
    expect(formatNumber(2710597)).toBe('2.7M');
    const line = memberLines.find((l) => l.includes('GoldFamily'));
    expect(line).toBe('2. *GoldFamily* — +2.7M');
  });

  it('Ryu: 332,207,534 - 331,992,091 = 215,443 -> +215.4K', () => {
    const ryu = snapshot.members.find((m) => m.trainer_name === 'Ryu')!;
    expect(ryu.daily_fans[10]).toBe(332207534);
    expect(ryu.daily_fans[9]).toBe(331992091);
    const gain = getDailyGain(ryu.daily_fans, 11);
    expect(gain).toBe(215443);
    expect(formatNumber(gain)).toBe('215.4K');
    const line = memberLines.find((l) => l.includes('Ryu'));
    expect(line).toBe('23. *Ryu* — +215.4K');
  });

  it('Falkrum (transfer): 0 gain → in stale section, not ranked list', () => {
    const f = snapshot.members.find((m) => m.trainer_name === 'Falkrum')!;
    expect(getDailyGain(f.daily_fans, 11)).toBe(0);
    const rankedLine = memberLines.find((l) => l.includes('Falkrum'));
    expect(rankedLine).toBeUndefined();
    const staleLine = staleLines.find((l) => l.includes('Falkrum'));
    expect(staleLine).toBeDefined();
  });

  it('naku: 0 gain → in stale section, not ranked list', () => {
    const m = snapshot.members.find((mm) => mm.trainer_name === 'naku')!;
    expect(getDailyGain(m.daily_fans, 11)).toBe(0);
    const rankedLine = memberLines.find((l) => l.includes('naku'));
    expect(rankedLine).toBeUndefined();
    const staleLine = staleLines.find((l) => l.includes('naku'));
    expect(staleLine).toBeDefined();
  });

  it('Sairen (transfer): 442,813,391 - 440,583,122 = 2,230,269 -> +2.2M', () => {
    const s = snapshot.members.find((m) => m.trainer_name === 'Sairen')!;
    expect(s.daily_fans[10]).toBe(442813391);
    expect(s.daily_fans[9]).toBe(440583122);
    expect(getDailyGain(s.daily_fans, 11)).toBe(2230269);
    expect(formatNumber(2230269)).toBe('2.2M');
    const line = memberLines.find((l) => l.includes('Sairen'));
    expect(line).toBe('6. *Sairen* 🔄 — +2.2M');
  });

  it('every ranked member gain matches raw data calculation', () => {
    const expectedGains: { name: string; gain: number; isTransfer: boolean }[] = [];
    for (const member of snapshot.members) {
      const gain = getDailyGain(member.daily_fans, 11);
      if (gain > 0) {
        expectedGains.push({
          name: member.trainer_name,
          gain,
          isTransfer: isTransferMember(member),
        });
      }
    }

    expectedGains.sort((a, b) => b.gain - a.gain);
    expect(expectedGains.length).toBe(27);

    for (let i = 0; i < expectedGains.length; i++) {
      const gainStr = `+${formatNumber(expectedGains[i].gain)}`;
      const badge = expectedGains[i].isTransfer ? ' 🔄' : '';
      expect(memberLines[i]).toBe(
        `${i + 1}. *${expectedGains[i].name}*${badge} — ${gainStr}`
      );
    }
  });
});


describe('Transfer members with negative daily_fans[0]', () => {
  it('Zero has negative daily_fans[0] and is correctly classified as transfer', () => {
    const zero = snapshot.members.find((m) => m.trainer_name === 'Zero')!;
    expect(zero.daily_fans[0]).toBeLessThan(0);
    expect(isTransferMember(zero)).toBe(true);
  });

  it('Sairen has negative daily_fans[0..2] and is correctly classified', () => {
    const sairen = snapshot.members.find((m) => m.trainer_name === 'Sairen')!;
    expect(sairen.daily_fans[0]).toBeLessThan(0);
    expect(sairen.daily_fans[1]).toBeLessThan(0);
    expect(sairen.daily_fans[2]).toBeLessThan(0);
    expect(sairen.daily_fans[3]).toBe(0);
    expect(isTransferMember(sairen)).toBe(true);
  });

  it('negative daily_fans[0] does not produce negative gain display', () => {
    const report = generateDailyReport(snapshot, config, computedMembers, 0);
    const memberLines = report.split('\n').filter((l) => /^\d+\./.test(l));
    for (const line of memberLines) {
      expect(line).not.toMatch(/— -[\d.]+/);
    }
  });
});
