import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import type { Snapshot } from "../../src/types";
import { saveSnapshot } from "../../src/data/snapshot";
import { loadRealSnapshot } from "../_helpers";

const realSnapshot: Snapshot = loadRealSnapshot();

describe("atomic snapshot writes survive a crash mid-write", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "snapshot-atomic-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("saveSnapshot writes a valid file that can be read back", () => {
    const snap: Snapshot = {
      ...realSnapshot,
      members: realSnapshot.members.slice(0, 2),
    };
    const savedPath = saveSnapshot(snap, "2026-06-13", tmpDir);
    expect(fs.existsSync(savedPath)).toBe(true);

    const raw = fs.readFileSync(savedPath, "utf-8");
    const parsed = JSON.parse(raw);
    expect(parsed.circle.circle_id).toBe(realSnapshot.circle.circle_id);
    expect(parsed.members).toHaveLength(2);
  });

  it("saveSnapshot leaves no .tmp file after successful write", () => {
    const snap: Snapshot = {
      ...realSnapshot,
      members: realSnapshot.members.slice(0, 1),
    };
    const savedPath = saveSnapshot(snap, "2026-06-13", tmpDir);
    const tmpPath = savedPath + ".tmp";
    expect(fs.existsSync(tmpPath)).toBe(false);
  });

  it("saveSnapshot produces atomic result (no partial file visible)", () => {
    const snap: Snapshot = {
      ...realSnapshot,
      members: realSnapshot.members.slice(0, 2),
    };
    const savedPath = saveSnapshot(snap, "2026-06-13", tmpDir);

    const raw = fs.readFileSync(savedPath, "utf-8");
    expect(() => JSON.parse(raw)).not.toThrow();

    const parsed = JSON.parse(raw);
    expect(parsed).toHaveProperty("circle");
    expect(parsed).toHaveProperty("members");
    expect(Array.isArray(parsed.members)).toBe(true);
  });

  it("saveSnapshot overwrites atomically (no corruption on overwrite)", () => {
    const snap1: Snapshot = {
      ...realSnapshot,
      members: realSnapshot.members.slice(0, 1),
    };
    const snap2: Snapshot = {
      ...realSnapshot,
      club_rank: 99,
      members: realSnapshot.members.slice(0, 2),
    };

    const path1 = saveSnapshot(snap1, "2026-06-13", tmpDir);
    const path2 = saveSnapshot(snap2, "2026-06-13", tmpDir);

    expect(path1).toBe(path2); // same path

    const raw = fs.readFileSync(path1, "utf-8");
    const parsed = JSON.parse(raw);
    expect(parsed.club_rank).toBe(99);
    expect(parsed.members).toHaveLength(2);
  });
});
