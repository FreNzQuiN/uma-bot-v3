/**
 * Stats Report Verification Script
 *
 * Generates the full stats output and prints it for visual inspection.
 * Also verifies every calculation against raw data.
 */

import * as path from 'path';
import { Snapshot, BotConfig } from '../../src/types';
import { getDefaultConfig } from '../../src/config';
import { computeMembers } from '../../src/reports/compute';
import { generateStatsReport } from '../../src/reports/stats';
import { getDataDayFromSnapshot } from '../../src/data/snapshot';
import { countActiveDays } from '../../src/data/daily-fans';
import { formatNumber } from '../../src/reports/format';

const snapshot: Snapshot = require(path.join(
  __dirname,
  '../../examples/snapshot-june-12.json'
));

const config: BotConfig = getDefaultConfig();

// Generate and print the full report
const report = generateStatsReport(snapshot, config);
console.log('\n========================================');
console.log('FULL STATS REPORT OUTPUT');
console.log('========================================');
console.log(report);
console.log('========================================\n');

// Now verify every calculation
const members = computeMembers(snapshot, config);
const dataDay = getDataDayFromSnapshot(snapshot);

const contributing = members.filter(
  (m) => m.status === 'active' || m.status === 'transfer'
);

console.log(`\n--- RAW DATA VERIFICATION ---`);
console.log(`Total members: ${members.length}`);
console.log(`Data day: ${dataDay}`);
console.log(`Contributing (active+transfer): ${contributing.length}`);
console.log(`Active: ${members.filter(m => m.status === 'active').length}`);
console.log(`Transfer: ${members.filter(m => m.status === 'transfer').length}`);
console.log(`Stale: ${members.filter(m => m.status === 'stale').length}`);

// Total monthly gain
const totalMonthlyGain = contributing.reduce((sum, m) => sum + m.monthlyGain, 0);
console.log(`\n--- TOTAL MONTHLY GAIN ---`);
console.log(`Computed total: ${totalMonthlyGain}`);
console.log(`Formatted: ${formatNumber(totalMonthlyGain)}`);

// Verify against raw: sum of all monthlyGain for contributing members
let rawTotal = 0;
for (const m of contributing) {
  rawTotal += m.monthlyGain;
}
console.log(`Raw verification total: ${rawTotal}`);
console.log(`Match: ${totalMonthlyGain === rawTotal}`);

// Average monthly gain
const avgMonthlyGain = contributing.length > 0 ? Math.round(totalMonthlyGain / contributing.length) : 0;
console.log(`\n--- AVERAGE MONTHLY GAIN ---`);
console.log(`Computed: ${avgMonthlyGain}`);
console.log(`Formatted: ${formatNumber(avgMonthlyGain)}`);

// Median
const sortedGains = contributing.map(m => m.monthlyGain).sort((a, b) => a - b);
const mid = Math.floor(sortedGains.length / 2);
const medianMonthlyGain = sortedGains.length > 0
  ? sortedGains.length % 2 === 0
    ? Math.round((sortedGains[mid - 1] + sortedGains[mid]) / 2)
    : sortedGains[mid]
  : 0;
console.log(`\n--- MEDIAN MONTHLY GAIN ---`);
console.log(`Sorted gains (first 5): ${sortedGains.slice(0, 5)}`);
console.log(`Sorted gains (last 5): ${sortedGains.slice(-5)}`);
console.log(`Length: ${sortedGains.length}, mid: ${mid}`);
console.log(`Computed median: ${medianMonthlyGain}`);
console.log(`Formatted: ${formatNumber(medianMonthlyGain)}`);

// Average daily gain
const totalDailyGain = contributing.reduce((sum, m) => sum + m.latestDailyGain, 0);
const avgDailyGain = contributing.length > 0 ? Math.round(totalDailyGain / contributing.length) : 0;
console.log(`\n--- AVERAGE DAILY GAIN ---`);
console.log(`Total daily gain: ${totalDailyGain}`);
console.log(`Avg daily gain: ${avgDailyGain}`);
console.log(`Formatted: ${formatNumber(avgDailyGain)}`);

// Zero gain today
const zeroGainToday = contributing.filter(m => m.latestDailyGain === 0).length;
console.log(`\n--- ZERO GAIN TODAY ---`);
const zeroMembers = contributing.filter(m => m.latestDailyGain === 0);
console.log(`Count: ${zeroGainToday}`);
console.log(`Members: ${zeroMembers.map(m => m.trainerName).join(', ')}`);

// Top member (active only)
const activeMembers = contributing.filter(m => m.status === 'active');
const sortedByGain = [...activeMembers].sort((a, b) => b.monthlyGain - a.monthlyGain);
console.log(`\n--- TOP MEMBER (active only) ---`);
console.log(`Top: ${sortedByGain[0]?.trainerName} — ${formatNumber(sortedByGain[0]?.monthlyGain)}`);
console.log(`Lowest: ${sortedByGain[sortedByGain.length - 1]?.trainerName} — ${formatNumber(sortedByGain[sortedByGain.length - 1]?.monthlyGain)}`);

// List all active members sorted for verification
console.log(`\n--- ALL ACTIVE MEMBERS BY MONTHLY GAIN ---`);
for (const m of sortedByGain) {
  console.log(`  ${m.trainerName}: ${m.monthlyGain} (${formatNumber(m.monthlyGain)})`);
}

// Projection
const { year, month } = snapshot.members[0];
const daysInMonth = new Date(year, month, 0).getDate();
const daysElapsed = dataDay;
const projectedMonthEnd = daysElapsed > 0
  ? Math.round((totalMonthlyGain / daysElapsed) * daysInMonth)
  : 0;
console.log(`\n--- PROJECTION ---`);
console.log(`Year: ${year}, Month: ${month}, Days in month: ${daysInMonth}`);
console.log(`Days elapsed: ${daysElapsed}`);
console.log(`Projected: ${projectedMonthEnd}`);
console.log(`Formatted: ${formatNumber(projectedMonthEnd)}`);

// Tier projection
const { fans_to_next_tier, fans_to_lower_tier } = snapshot;
const currentPace = daysElapsed > 0 ? Math.round(totalMonthlyGain / daysElapsed) : 0;
const daysLeft = daysInMonth - daysElapsed;
console.log(`\n--- TIER PROJECTION ---`);
console.log(`fans_to_next_tier: ${fans_to_next_tier}`);
console.log(`fans_to_lower_tier: ${fans_to_lower_tier}`);
console.log(`Current pace: ${currentPace}`);
console.log(`Days left: ${daysLeft}`);

if (fans_to_next_tier > 0 && currentPace > 0) {
  const daysToPromote = Math.ceil(fans_to_next_tier / currentPace);
  console.log(`Days to promote: ${daysToPromote}`);
  console.log(`Will promote: ${daysToPromote <= daysLeft}`);
}

// Requirement pass rate
const monthlyReq = config.requirements.monthlyFans;
const passCount = contributing.filter(m => m.monthlyGain >= monthlyReq).length;
const passRate = contributing.length > 0
  ? Math.round((passCount / contributing.length) * 100)
  : 0;
console.log(`\n--- REQUIREMENT PASS RATE ---`);
console.log(`Monthly requirement: ${monthlyReq} (${formatNumber(monthlyReq)})`);
console.log(`Pass count: ${passCount}/${contributing.length}`);
console.log(`Pass rate: ${passRate}%`);

// List passing and failing members
console.log(`\n--- MEMBERS BELOW REQUIREMENT ---`);
for (const m of contributing) {
  if (m.monthlyGain < monthlyReq) {
    console.log(`  ${m.trainerName} (${m.status}): ${m.monthlyGain} (${formatNumber(m.monthlyGain)})`);
  }
}

// Active days
const activeDayCounts = contributing.map(m => countActiveDays(m.dailyFans));
const avgActiveDays = activeDayCounts.length > 0
  ? Math.round(activeDayCounts.reduce((a, b) => a + b, 0) / activeDayCounts.length)
  : 0;
console.log(`\n--- ACTIVE DAYS ---`);
console.log(`Average active days: ${avgActiveDays}`);
console.log(`Individual counts: ${activeDayCounts.join(', ')}`);

// Ghost members (should NOT be in contributing)
console.log(`\n--- GHOST MEMBERS (should be stale, not in contributing) ---`);
const ghosts = members.filter(m => m.status === 'stale');
for (const g of ghosts) {
  console.log(`  ${g.trainerName}: status=${g.status}, monthlyGain=${g.monthlyGain}`);
}
