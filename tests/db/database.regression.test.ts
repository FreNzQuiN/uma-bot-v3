import { SqliteDatabase } from "../../src/db/database";

describe("recordAlert returns correct ID", () => {
  let db: SqliteDatabase;

  beforeEach(async () => {
    db = new SqliteDatabase(":memory:");
    await db.initialize();
  });

  afterEach(async () => {
    await db.close();
  });

  it("returns correct ID when inserting a new alert", async () => {
    const id1 = await db.recordAlert({
      alert_type: "performance_drop",
      event_key: "perf:2026-06-12:11111",
      member_viewer_id: "11111",
      report_date: "2026-06-12",
      created_at: "2026-06-12T15:05:00Z",
      message: "Alert 1",
    });

    const id2 = await db.recordAlert({
      alert_type: "performance_drop",
      event_key: "perf:2026-06-12:22222",
      member_viewer_id: "22222",
      report_date: "2026-06-12",
      created_at: "2026-06-12T15:05:00Z",
      message: "Alert 2",
    });

    expect(id1).toBeGreaterThan(0);
    expect(id2).toBe(id1 + 1);
  });

  it("returns existing ID when duplicate event_key inserted", async () => {
    const id1 = await db.recordAlert({
      alert_type: "performance_drop",
      event_key: "perf:2026-06-12:33333",
      member_viewer_id: "33333",
      report_date: "2026-06-12",
      created_at: "2026-06-12T15:05:00Z",
      message: "First",
    });

    const id2 = await db.recordAlert({
      alert_type: "performance_drop",
      event_key: "perf:2026-06-12:33333",
      member_viewer_id: "33333",
      report_date: "2026-06-12",
      created_at: "2026-06-12T15:06:00Z",
      message: "Duplicate",
    });

    expect(id1).toBeGreaterThan(0);
    // Same ID so the caller can mark the original as sent
    expect(id2).toBe(id1);
  });

  it("markAlertSent on duplicate alert marks the original as sent", async () => {
    const id1 = await db.recordAlert({
      alert_type: "performance_drop",
      event_key: "perf:2026-06-12:44444",
      member_viewer_id: "44444",
      report_date: "2026-06-12",
      created_at: "2026-06-12T15:05:00Z",
      message: "Original",
    });

    const id2 = await db.recordAlert({
      alert_type: "performance_drop",
      event_key: "perf:2026-06-12:44444",
      member_viewer_id: "44444",
      report_date: "2026-06-12",
      created_at: "2026-06-12T15:06:00Z",
      message: "Duplicate",
    });

    expect(id2).toBe(id1);
    await expect(db.markAlertSent(id2)).resolves.not.toThrow();
    const keys = await db.getExistingAlertKeys(["perf:2026-06-12:44444"]);
    expect(keys.has("perf:2026-06-12:44444")).toBe(true);
  });
});
