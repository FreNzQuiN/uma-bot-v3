/**
 * Golden-file inline snapshot tests for all report types.
 *
 * Uses the real June 12 snapshot fixture to generate each report type
 * and captures exact output via Jest's toMatchInlineSnapshot().
 *
 * First run: npx jest tests/reports/golden-inline.test.ts -u --no-coverage
 * Verify:    npx jest tests/reports/golden-inline.test.ts --no-coverage
 */

import { loadRealSnapshot, makeConfig } from '../_helpers';
import { computeMembers } from '../../src/reports/compute';
import { generateDailyReport } from '../../src/reports/daily';
import { generateWeeklyReport } from '../../src/reports/weekly';
import { generateMonthlyReport } from '../../src/reports/monthly';
import { generateRanksReport } from '../../src/reports/ranks';
import { generateBottomReport } from '../../src/reports/bottom';
import { generateStatsReport } from '../../src/reports/stats';
import { generateMembersReport } from '../../src/reports/members';
import { generateTierReport } from '../../src/reports/tier';

let snapshot: ReturnType<typeof loadRealSnapshot>;
let config: ReturnType<typeof makeConfig>;
let members: ReturnType<typeof computeMembers>;

beforeAll(() => {
  snapshot = loadRealSnapshot();
  config = makeConfig();
  members = computeMembers(snapshot, config);
});

describe('Golden-file: Daily Report', () => {
  it('matches expected output for offset=0', () => {
    const report = generateDailyReport(snapshot, config, members, 0);
    expect(report).toMatchInlineSnapshot(`
"📊 *Daily Report — 11 Juni 2026*

Hol＿Horse | A+ (#431)
Periode data: 11 Juni 2026, 22:00 WIB
Promosi: 349.2M fans lagi | Degradasi: buffer 21.8M

👥 27 kontribusi dari 30 anggota | Total: 32.3M

1. *Nargi* — +3.1M
2. *GoldFamily* — +2.7M
3. *Nico* — +2.7M
4. *Aditya* — +2.6M
5. *Azurarch* — +2.4M
6. *Sairen* 🔄 — +2.2M
7. *Zero* 🔄 — +2.0M
8. *Dyy”* — +2.0M
9. *Luck99* — +1.9M
10. *RngF* — +1.8M
11. *DzFx* — +1.7M
12. *VitoHoow* 🔄 — +1.2M
13. *sirsokban* — +1.0M
14. *Seterako* — +886.9K
15. *Saki* — +719.6K
16. *Anshu* — +675.8K
17. *Suzuka Kopling* — +576.8K
18. *FreNzQuiN* — +568.6K
19. *Amanda* — +403.7K
20. *Yukil* — +332.0K
21. *Lihking* — +301.0K
22. *ursa* — +276.4K
23. *Ryu* — +215.4K
24. *Ceciria* 🔄 — +78.5K
25. *Ignis* — +10.5K
26. *TheTengOne* 🔄 — +2.9K
27. *Ernstormen* — +2.4K

*⚠️ Belum aktif hari ini:*
• naku
• jgd
• Falkrum

⚠️ Data klub mungkin tidak terbaru (update terakhir: 11 Juni 2026)

⸻
Terakhir sync: 11/6 22:00"
`);
  });
});

describe('Golden-file: Weekly Report', () => {
  it('matches expected output for offset=0', () => {
    const report = generateWeeklyReport(snapshot, config, members, 0);
    expect(report).toMatchInlineSnapshot(`
"📈 *Weekly Report — Minggu 2*

Hol＿Horse | A+ (#431)
Periode data: 11 Juni 2026, 22:00 WIB
Periode: Hari 8-14
Promosi: 349.2M fans lagi
Degradasi: buffer 21.8M

👥 30 kontribusi dari 30 anggota | Total: 144.5M

1. *Sairen* 🔄 — +14.3M
2. *GoldFamily* — +10.8M
3. *Luck99* — +8.8M
4. *Aditya* — +8.7M
5. *Nargi* — +7.1M
6. *sirsokban* — +7.0M
7. *RngF* — +7.0M
8. *DzFx* — +6.9M
9. *Seterako* — +6.8M
10. *Zero* 🔄 — +6.1M
11. *Nico* — +5.3M
12. *Dyy”* — +4.7M
13. *Ceciria* 🔄 — +4.6M
14. *Anshu* — +4.5M
15. *Lihking* — +4.4M
16. *Suzuka Kopling* — +4.0M
17. *Falkrum* 🔄 — +3.7M
18. *Saki* — +3.6M
19. *VitoHoow* 🔄 — +3.4M
20. *FreNzQuiN* — +3.0M
21. *TheTengOne* 🔄 — +2.7M
22. *Ignis* — +2.6M
23. *naku* — +2.5M
24. *Azurarch* — +2.4M
25. *Ryu* — +2.3M
26. *Ernstormen* — +2.0M
27. *Amanda* — +2.0M
28. *Yukil* — +1.4M
29. *jgd* — +938.6K
30. *ursa* — +875.7K

*⚠️ Belum aktif minggu ini:*
• jgd

⚠️ Data klub mungkin tidak terbaru (update terakhir: 11 Juni 2026)

⸻
Terakhir sync: 11/6 22:00"
`);
  });
});

describe('Golden-file: Monthly Report', () => {
  it('matches expected output for offset=0', () => {
    const report = generateMonthlyReport(snapshot, config, members, 0);
    expect(report).toMatchInlineSnapshot(`
"📅 *Monthly Report — Juni 2026*

Hol＿Horse | A+ (#431)
Periode data: 11 Juni 2026, 22:00 WIB
Promosi: 349.2M fans lagi | Degradasi: buffer 21.8M

👥 30 kontribusi dari 30 anggota | Total: 347.0M
Proyeksi akhir bulan: ~946.4M

1. *GoldFamily* — +27.7M
2. *RngF* — +19.2M
3. *Aditya* — +18.6M
4. *DzFx* — +18.2M
5. *Sairen* 🔄 — +17.9M
6. *sirsokban* — +17.1M
7. *Luck99* — +16.8M
8. *Anshu* — +16.1M
9. *Ryu* — +15.4M
10. *Seterako* — +15.3M
11. *Zero* 🔄 — +14.1M
12. *Dyy”* — +13.1M
13. *Nargi* — +10.3M
14. *Azurarch* — +9.8M
15. *Ceciria* 🔄 — +9.7M
16. *Lihking* — +9.7M
17. *Suzuka Kopling* — +9.0M
18. *Saki* — +9.0M
19. *Nico* — +8.9M
20. *Falkrum* 🔄 — +8.4M
21. *jgd* — +7.5M
22. *FreNzQuiN* — +6.7M
23. *Ernstormen* — +6.7M
24. *ursa* — +6.6M
25. *Ignis* — +6.5M
26. *VitoHoow* 🔄 — +6.4M
27. *TheTengOne* 🔄 — +6.3M
28. *naku* — +6.1M
29. *Amanda* — +5.3M
30. *Yukil* — +4.6M

*🎯 Requirement: 20.0M/bulan*
✅ 1 pass | ❌ 29 kurang
❌ *Ryu* — kurang 4.6M
❌ *Seterako* — kurang 4.7M
❌ *Luck99* — kurang 3.2M
❌ *Azurarch* — kurang 10.2M
❌ *DzFx* — kurang 1.8M
❌ *RngF* — kurang 755.8K
❌ *Lihking* — kurang 10.3M
❌ *Zero* 🔄 — kurang 5.9M
❌ *Nico* — kurang 11.1M
❌ *Anshu* — kurang 3.9M
❌ *Amanda* — kurang 14.7M
❌ *naku* — kurang 13.9M
❌ *Nargi* — kurang 9.7M
❌ *TheTengOne* 🔄 — kurang 13.7M
❌ *jgd* — kurang 12.5M
❌ *Ignis* — kurang 13.5M
❌ *Sairen* 🔄 — kurang 2.1M
❌ *VitoHoow* 🔄 — kurang 13.6M
❌ *Yukil* — kurang 15.4M
❌ *Saki* — kurang 11.0M
❌ *Aditya* — kurang 1.4M
❌ *Ceciria* 🔄 — kurang 10.3M
❌ *Dyy”* — kurang 6.9M
❌ *ursa* — kurang 13.4M
❌ *sirsokban* — kurang 2.9M
❌ *Falkrum* 🔄 — kurang 11.6M
❌ *Ernstormen* — kurang 13.3M
❌ *Suzuka Kopling* — kurang 11.0M
❌ *FreNzQuiN* — kurang 13.3M

⚠️ Data klub mungkin tidak terbaru (update terakhir: 11 Juni 2026)

⸻
Terakhir sync: 11/6 22:00"
`);
  });
});

describe('Golden-file: Ranks Report', () => {
  it('matches expected output', () => {
    const report = generateRanksReport(snapshot, config, members);
    expect(report).toMatchInlineSnapshot(`
"🏆 *Peringkat Bulanan*

Hol＿Horse | A+ (#431)
Periode data: 11 Juni 2026, 22:00 WIB

🥇 *GoldFamily* — +27.7M
🥈 *RngF* — +19.2M
🥉 *Aditya* — +18.6M
4. *DzFx* — +18.2M
5. *Sairen* 🔄 — +17.9M
6. *sirsokban* — +17.1M
7. *Luck99* — +16.8M
8. *Anshu* — +16.1M
9. *Ryu* — +15.4M
10. *Seterako* — +15.3M

⸻
Terakhir sync: 11/6 22:00"
`);
  });
});

describe('Golden-file: Bottom Report', () => {
  it('matches expected output', () => {
    const report = generateBottomReport(snapshot, config, members);
    expect(report).toMatchInlineSnapshot(`
"📉 *Perlu Perhatian*

Hol＿Horse | A+ (#431)
Periode data: 11 Juni 2026, 22:00 WIB

🎯 Target bulanan: 20.0M

1. *Yukil* — +4.6M (kurang 15.4M) → ~12.5M
2. *Amanda* — +5.3M (kurang 14.7M) → ~14.5M
3. *naku* — +6.1M (kurang 13.9M) → ~16.7M
4. *TheTengOne* 🔄 — +6.3M (kurang 13.7M) → ~17.3M
5. *VitoHoow* 🔄 — +6.4M (kurang 13.6M) → ~17.6M
6. *Ignis* — +6.5M (kurang 13.5M) → ~17.8M
7. *ursa* — +6.6M (kurang 13.4M) → ~17.9M
8. *Ernstormen* — +6.7M (kurang 13.3M) → ~18.3M
9. *FreNzQuiN* — +6.7M (kurang 13.3M) → ~18.3M
10. *jgd* — +7.5M (kurang 12.5M)

⸻
Terakhir sync: 11/6 22:00"
`);
  });
});

describe('Golden-file: Stats Report', () => {
  it('matches expected output', () => {
    const report = generateStatsReport(snapshot, config, members);
    expect(report).toMatchInlineSnapshot(`
"📊 *Stats Overview*

Hol＿Horse | A+ (#431)
Periode data: 11 Juni 2026, 22:00 WIB

Total anggota: 34
Aktif: 30 | Keluar: 4 | Transfer: 6

📈 Gain rata-rata bulanan: 11.6M
📈 Gain median bulanan: 9.7M
📈 Gain rata-rata harian: 1.1M
📅 Rata-rata hari aktif: 9 hari
🎯 Zero gain hari ini: 3 orang

🏆 Top: GoldFamily — 27.7M
📉 Lowest aktif: Yukil — 4.6M

📅 Proyeksi akhir bulan: ~946.4M
🎯 Promosi: kemungkinan besar jika pace bertahan

🎯 Requirement pass rate: 3% (1/30)
🎯 Total gain bulanan: 347.0M
Promosi: 349.2M | Degradasi: 21.8M

⚠️ Data klub mungkin tidak terbaru (update terakhir: 11 Juni 2026)

⸻
Terakhir sync: 11/6 22:00"
`);
  });
});

describe('Golden-file: Members Report', () => {
  it('matches expected output without db', () => {
    const report = generateMembersReport(snapshot, config, members);
    expect(report).toMatchInlineSnapshot(`
"👥 *Daftar Anggota*

Hol＿Horse | A+ (#431)

• *GoldFamily* — 27.7M
• *RngF* — 19.2M
• *Aditya* — 18.6M
• *DzFx* — 18.2M
• *Sairen* 🔄 — 17.9M (dari Zxyden)
• *sirsokban* — 17.1M
• *Luck99* — 16.8M
• *Anshu* — 16.1M
• *Ryu* — 15.4M
• *Seterako* — 15.3M
• *Zero* 🔄 — 14.1M (dari Advent)
• *Dyy”* — 13.1M
• *Nargi* — 10.3M
• *Azurarch* — 9.8M
• *Ceciria* 🔄 — 9.7M (dari MejiroStan)
• *Lihking* — 9.7M
• *Suzuka Kopling* — 9.0M
• *Saki* — 9.0M
• *Nico* — 8.9M
• *Falkrum* 🔄 — 8.4M (dari KemekMuda)
• *jgd* — 7.5M
• *FreNzQuiN* — 6.7M
• *Ernstormen* — 6.7M
• *ursa* — 6.6M
• *Ignis* — 6.5M
• *VitoHoow* 🔄 — 6.4M (dari Madafakars)
• *TheTengOne* 🔄 — 6.3M (dari Garuda3)
• *naku* — 6.1M
• *Amanda* — 5.3M
• *Yukil* — 4.6M
• *DOA IBU* 🚪 — 0
• *Kuro* 🚪 — 0
• *Rowking* 🚪 — 0
• *Lebowski* 🚪 — 0

⸻
Terakhir sync: 11/6 22:00"
`);
  });
});

describe('Golden-file: Tier Report', () => {
  it('matches expected output', () => {
    const report = generateTierReport(snapshot, config, members);
    expect(report).toMatchInlineSnapshot(`
"🏆 *Tier Intelligence*

Hol＿Horse | A+ (#431)
Periode data: 11 Juni 2026, 22:00 WIB

Promosi: 349.2M fans lagi
Degradasi: buffer 21.8M

Pace saat ini: 31.7M/hari
Pace butuh: 18.4M/hari

Sisa hari: 19
🚨 Proyeksi: Promosi 🎉

⸻
Terakhir sync: 11/6 22:00"
`);
  });
});
