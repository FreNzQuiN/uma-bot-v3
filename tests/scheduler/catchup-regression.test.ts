import { CatchUpManager } from "../../src/scheduler/catchup";
import { SqliteDatabase } from "../../src/db/database";
import { makeConfig, mockCurrentDate, restoreDateMocks } from "../_helpers";

describe("Bug 1: Catch-up detects missed reports across days", () => {
  let db: SqliteDatabase;

  beforeEach(async () => {
    mockCurrentDate(2026, 6, 15);
    db = new SqliteDatabase(":memory:");
    await db.initialize();
  });

  afterEach(() => {
    db.close();
    restoreDateMocks();
  });

  it("detects missed weekly from day 7 when bot restarts on day 8", async () => {
    // Weekly scheduled on days [7, 14, 21, 28]
    // Mocked date: June 15, 2026 (day 15)
    // Last successful weekly was on day 7 of previous month
    // Weekly from day 7 or day 14 should be caught
    const config = makeConfig({
      catchUp: { enabled: true, maxReportsPerStartup: 10 },
      schedule: {
        daily: { enabled: true, time: "22:05" },
        weekly: { enabled: true, days: [7, 14, 21, 28], time: "22:05" },
        monthly: { enabled: true, day: 1, time: "22:12" },
      },
    });

    // Last weekly run was from previous month (May 2026)
    const lastMonthStr = "2026-05-07";

    await db.recordRun({
      report_type: "weekly",
      report_date: lastMonthStr,
      scheduled_at: `${lastMonthStr}T22:05:00.000Z`,
      sent_at: `${lastMonthStr}T22:05:01.000Z`,
      status: "sent",
      is_catch_up: false,
      target_jid: "test@g.us",
    });

    const catchUp = new CatchUpManager(db, () => config);
    const missed = await catchUp.detectMissedReports();

    // Weekly should be detected as missed since we haven't run it this month
    expect(missed).toContain("weekly");
  });

  it("does not double-detect weekly when already sent on most recent scheduled day", async () => {
    const config = makeConfig({
      catchUp: { enabled: true, maxReportsPerStartup: 10 },
      schedule: {
        daily: { enabled: true, time: "22:05" },
        weekly: { enabled: true, days: [7, 14, 21, 28], time: "22:05" },
        monthly: { enabled: true, day: 1, time: "22:12" },
      },
    });

    // Mocked date: June 15, 2026
    // Weekly scheduled on [7, 14, 21, 28]
    // Most recent scheduled day <= 15 is day 14
    const scheduledDate = "2026-06-14";

    await db.recordRun({
      report_type: "weekly",
      report_date: scheduledDate,
      scheduled_at: `${scheduledDate}T22:05:00.000Z`,
      sent_at: `${scheduledDate}T22:05:01.000Z`,
      status: "sent",
      is_catch_up: false,
      target_jid: "test@g.us",
    });

    const catchUp = new CatchUpManager(db, () => config);
    const missed = await catchUp.detectMissedReports();
    expect(missed).not.toContain("weekly");
  });

  it("detects missed monthly when bot restarts after monthly day has passed", async () => {
    const config = makeConfig({
      catchUp: { enabled: true, maxReportsPerStartup: 10 },
      schedule: {
        daily: { enabled: true, time: "22:05" },
        weekly: { enabled: true, days: [7, 14, 21, 28], time: "22:05" },
        monthly: { enabled: true, day: 1, time: "22:12" },
      },
    });

    // Mocked date: June 15, 2026 — well past monthly day (day 1)
    // Record last monthly from previous month (May 2026)
    const lastMonthStr = "2026-05-01";

    await db.recordRun({
      report_type: "monthly",
      report_date: lastMonthStr,
      scheduled_at: `${lastMonthStr}T22:12:00.000Z`,
      sent_at: `${lastMonthStr}T22:12:01.000Z`,
      status: "sent",
      is_catch_up: false,
      target_jid: "test@g.us",
    });

    // Monthly should always be detected since we're past day 1
    const catchUp = new CatchUpManager(db, () => config);
    const missed = await catchUp.detectMissedReports();
    expect(missed).toContain("monthly");
  });

  it("passes offset=-1 for monthly catch-up reports", async () => {
    const config = makeConfig({
      catchUp: { enabled: true, maxReportsPerStartup: 10 },
      groups: { command: [], announcement: ["test@g.us"], alertAdmin: [] },
      schedule: {
        daily: { enabled: false, time: "22:05" },
        weekly: { enabled: false, days: [], time: "22:05" },
        monthly: { enabled: true, day: 1, time: "22:12" },
      },
    });

    const lastMonthStr = "2026-05-01";
    await db.recordRun({
      report_type: "monthly",
      report_date: lastMonthStr,
      scheduled_at: `${lastMonthStr}T22:12:00.000Z`,
      sent_at: `${lastMonthStr}T22:12:01.000Z`,
      status: "sent",
      is_catch_up: false,
      target_jid: "test@g.us",
    });

    const catchUp = new CatchUpManager(db, () => config);
    const sendReport = jest.fn().mockResolvedValue(undefined);

    await catchUp.executeCatchUp(sendReport);

    const monthlyCall = sendReport.mock.calls.find(
      (c: unknown[]) => c[0] === "monthly",
    );
    expect(monthlyCall).toBeDefined();
    expect(monthlyCall[1]).toEqual({ isCatchUp: true, offset: -1 });
  });
});
