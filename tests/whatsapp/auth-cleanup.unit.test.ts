/**
 * Unit tests for WhatsApp auth directory cleanup.
 *
 * Uses real temp directories (not mocked fs) to test actual file operations.
 * Each test creates an isolated temp dir that's cleaned up after.
 */

import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  mkdirSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  getAuthStats,
  pruneStaleLidMappings,
  deleteCorruptedSenderKey,
  runAuthCleanup,
  backupCreds,
  restoreCredsBackup,
  isCredsUsable,
  getLastConnect,
  writeLastConnect,
  shouldPurgeSignalState,
  resetSignalState,
  pruneStaleSignalState,
  pruneStaleSenderKeys,
  resolveProtectedLids,
} from "../../src/whatsapp/auth-cleanup";

jest.mock("../../src/utils/logger", () => ({
  log: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

const DAY = 24 * 60 * 60 * 1000;

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "auth-cleanup-test-"));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

function createFile(name: string, ageMs: number = 0): void {
  const filePath = join(tempDir, name);
  writeFileSync(filePath, "{}");
  if (ageMs > 0) {
    const past = new Date(Date.now() - ageMs);
    const { utimesSync } = require("node:fs");
    utimesSync(filePath, past, past);
  }
}

function writeCreds(overrides: Record<string, unknown> = {}): void {
  const creds = {
    me: { id: "62812345678@s.whatsapp.net:15" },
    signedIdentityKey: "base64key==",
    ...overrides,
  };
  writeFileSync(join(tempDir, "creds.json"), JSON.stringify(creds));
}

describe("getAuthStats", () => {
  it("returns zero stats for nonexistent directory", () => {
    const stats = getAuthStats("/nonexistent/path");
    expect(stats.total).toBe(0);
    expect(stats.byType).toEqual({});
  });

  it("counts files by type", () => {
    createFile("creds.json");
    createFile("lid-mapping-1000.json");
    createFile("lid-mapping-2000.json");
    createFile("pre-key-1.json");
    createFile("session-abc.json");
    createFile("identity-key-123_1.0.json");

    const stats = getAuthStats(tempDir);
    expect(stats.total).toBe(6);
    expect(stats.byType["creds"]).toBe(1);
    expect(stats.byType["lid-mapping"]).toBe(2);
    expect(stats.byType["pre-key"]).toBe(1);
    expect(stats.byType["session"]).toBe(1);
    expect(stats.byType["identity-key"]).toBe(1);
  });

  it("handles empty directory", () => {
    const stats = getAuthStats(tempDir);
    expect(stats.total).toBe(0);
    expect(stats.byType).toEqual({});
  });

  it("classifies unknown file types as other", () => {
    createFile("some-random-file.json");
    createFile("unknown-type.dat");

    const stats = getAuthStats(tempDir);
    expect(stats.byType["other"]).toBe(2);
  });
});

describe("pruneStaleLidMappings", () => {
  it("deletes lid-mapping files older than maxAgeMs", () => {
    createFile("lid-mapping-old.json", 10 * DAY); // 10 days old
    createFile("lid-mapping-recent.json", 0); // just created
    createFile("creds.json", 10 * DAY); // old but not lid-mapping

    const result = pruneStaleLidMappings(tempDir, 7 * DAY);

    expect(result.deleted).toBe(1);
    expect(result.errors).toBe(0);

    const stats = getAuthStats(tempDir);
    expect(stats.byType["lid-mapping"]).toBe(1); // recent one survives
    expect(stats.byType["creds"]).toBe(1); // untouched
  });

  it("deletes nothing when all files are recent", () => {
    createFile("lid-mapping-new1.json", 0);
    createFile("lid-mapping-new2.json", 0);

    const result = pruneStaleLidMappings(tempDir, 7 * DAY);

    expect(result.deleted).toBe(0);
    expect(result.errors).toBe(0);

    const stats = getAuthStats(tempDir);
    expect(stats.total).toBe(2);
  });

  it("returns zero for nonexistent directory", () => {
    const result = pruneStaleLidMappings("/nonexistent");
    expect(result.deleted).toBe(0);
    expect(result.errors).toBe(0);
  });

  it("only deletes lid-mapping files, not other types", () => {
    createFile("pre-key-old.json", 100 * DAY); // very old
    createFile("session-old.json", 100 * DAY); // very old
    createFile("lid-mapping-old.json", 100 * DAY); // very old

    const result = pruneStaleLidMappings(tempDir, 7 * DAY);

    expect(result.deleted).toBe(1); // only the lid-mapping
    expect(result.errors).toBe(0);

    const stats = getAuthStats(tempDir);
    expect(stats.byType["pre-key"]).toBe(1); // untouched
    expect(stats.byType["session"]).toBe(1); // untouched
  });

  it("handles multiple old lid-mapping files", () => {
    for (let i = 0; i < 10; i++) {
      createFile(`lid-mapping-${i}.json`, 30 * DAY); // 30 days old
    }

    const result = pruneStaleLidMappings(tempDir, 7 * DAY);

    expect(result.deleted).toBe(10);
    expect(result.errors).toBe(0);

    const stats = getAuthStats(tempDir);
    expect(stats.total).toBe(0);
  });
});

describe("deleteCorruptedSenderKey", () => {
  it("deletes sender-key file matching the JID", () => {
    createFile("sender-key-12345@g.us.key.json");
    createFile("creds.json");

    const deleted = deleteCorruptedSenderKey(tempDir, "12345@g.us");

    expect(deleted).toBe(true);

    const stats = getAuthStats(tempDir);
    expect(stats.byType["sender-key"]).toBeUndefined();
    expect(stats.byType["creds"]).toBe(1);
  });

  it("returns false when no matching file found", () => {
    createFile("sender-key-99999@g.us.key.json");

    const deleted = deleteCorruptedSenderKey(tempDir, "12345@g.us");

    expect(deleted).toBe(false);

    const stats = getAuthStats(tempDir);
    expect(stats.byType["sender-key"]).toBe(1); // untouched
  });

  it("returns false for nonexistent directory", () => {
    const deleted = deleteCorruptedSenderKey("/nonexistent", "12345@g.us");
    expect(deleted).toBe(false);
  });

  it("does not delete non-sender-key files", () => {
    createFile("creds.json");
    createFile("session-12345.json");
    createFile("pre-key-1.json");

    const deleted = deleteCorruptedSenderKey(tempDir, "12345@g.us");

    expect(deleted).toBe(false);

    const stats = getAuthStats(tempDir);
    expect(stats.total).toBe(3); // nothing deleted
  });
});

describe("runAuthCleanup", () => {
  it("prunes stale lid-mapping and logs stats", () => {
    createFile("creds.json");
    createFile("lid-mapping-old.json", 30 * DAY);
    createFile("lid-mapping-new.json", 0);
    createFile("pre-key-1.json");

    runAuthCleanup(tempDir);

    const stats = getAuthStats(tempDir);
    expect(stats.total).toBe(3); // creds + new lid-mapping + pre-key
    expect(stats.byType["lid-mapping"]).toBe(1);
  });

  it("does nothing for nonexistent directory", () => {
    expect(() => runAuthCleanup("/nonexistent")).not.toThrow();
  });

  it("handles empty directory", () => {
    expect(() => runAuthCleanup(tempDir)).not.toThrow();

    const stats = getAuthStats(tempDir);
    expect(stats.total).toBe(0);
  });

  it("backs up creds.json when usable", () => {
    writeCreds();

    runAuthCleanup(tempDir);

    expect(existsSync(join(tempDir, "creds.json.bak"))).toBe(true);
  });

  it("does not create a backup when creds are unusable", () => {
    createFile("creds.json"); // "{}" — no me.id / signedIdentityKey

    runAuthCleanup(tempDir);

    expect(existsSync(join(tempDir, "creds.json.bak"))).toBe(false);
  });

  it("never prunes pre-key files", () => {
    writeCreds();
    createFile("pre-key-1.json");
    createFile("pre-key-300.json");

    runAuthCleanup(tempDir);

    const stats = getAuthStats(tempDir);
    expect(stats.byType["pre-key"]).toBe(2); // both survive
  });
});

describe("backupCreds / restoreCredsBackup / isCredsUsable", () => {
  it("roundtrips creds.json through the backup", () => {
    writeCreds();
    expect(backupCreds(tempDir)).toBe(true);
    expect(existsSync(join(tempDir, "creds.json.bak"))).toBe(true);

    writeFileSync(join(tempDir, "creds.json"), "corrupted", "utf-8");
    expect(isCredsUsable(tempDir)).toBe(false);

    expect(restoreCredsBackup(tempDir)).toBe(true);
    expect(isCredsUsable(tempDir)).toBe(true);
  });

  it("returns false for missing dirs and files", () => {
    expect(backupCreds("/nonexistent")).toBe(false);
    expect(restoreCredsBackup("/nonexistent")).toBe(false);
    expect(isCredsUsable("/nonexistent")).toBe(false);

    expect(backupCreds(tempDir)).toBe(false); // no creds.json
    expect(restoreCredsBackup(tempDir)).toBe(false); // no backup
  });

  it("detects corrupt and incomplete creds", () => {
    writeFileSync(join(tempDir, "creds.json"), "not json{{", "utf-8");
    expect(isCredsUsable(tempDir)).toBe(false);

    writeFileSync(join(tempDir, "creds.json"), "{}", "utf-8");
    expect(isCredsUsable(tempDir)).toBe(false);

    writeCreds({ me: { id: "" } });
    expect(isCredsUsable(tempDir)).toBe(false);

    writeCreds({ signedIdentityKey: "" });
    expect(isCredsUsable(tempDir)).toBe(false);
  });
});

describe("last-connect marker / shouldPurgeSignalState", () => {
  const PURGE_DAYS = 14;

  it("writeLastConnect then getLastConnect roundtrip", () => {
    writeLastConnect(tempDir);
    const ts = getLastConnect(tempDir);
    expect(ts).not.toBeNull();
    const TOLERANCE_MS = 60_000;
    expect(Math.abs((ts ?? 0) - Date.now())).toBeLessThan(TOLERANCE_MS);
  });

  it("getLastConnect returns null when marker is missing", () => {
    expect(getLastConnect(tempDir)).toBeNull();
    expect(getLastConnect("/nonexistent")).toBeNull();
  });

  it("shouldPurgeSignalState: no creds → never purge (fresh install)", () => {
    writeLastConnect(tempDir);
    expect(shouldPurgeSignalState(tempDir, PURGE_DAYS)).toBe(false);
  });

  it("shouldPurgeSignalState: creds + missing marker → no purge (first boot after feature lands)", () => {
    // Every existing install has creds but no marker on first boot with this
    // feature — unknown age must mean KEEP, not mass-purge.
    writeCreds();
    expect(shouldPurgeSignalState(tempDir, PURGE_DAYS)).toBe(false);
  });

  it("shouldPurgeSignalState: creds + recent marker → no purge", () => {
    writeCreds();
    writeLastConnect(tempDir);
    expect(shouldPurgeSignalState(tempDir, PURGE_DAYS)).toBe(false);
  });

  it("shouldPurgeSignalState: creds + old marker → purge", () => {
    writeCreds();
    writeLastConnect(tempDir);
    const past = new Date(Date.now() - 20 * DAY);
    const { utimesSync } = require("node:fs");
    utimesSync(join(tempDir, ".last-connect"), past, past);

    expect(shouldPurgeSignalState(tempDir, PURGE_DAYS)).toBe(true);
  });

  it("shouldPurgeSignalState: markers never restart a classic fresh-connect purge once written", () => {
    // Regression: repeated same-day restarts must NOT purge (creds mtime is
    // rewritten every connect, but the marker is written once on open).
    writeCreds();
    writeLastConnect(tempDir);
    expect(shouldPurgeSignalState(tempDir, PURGE_DAYS)).toBe(false);
    expect(shouldPurgeSignalState(tempDir, PURGE_DAYS)).toBe(false);
  });
});

describe("resetSignalState", () => {
  it("deletes only session, sender-key, and identity-key files", () => {
    createFile("session-62811111111_1.json");
    createFile("sender-key-120363238771337472@g.us--1234_1--0.json");
    createFile("identity-key-62822222222_1.json");
    createFile("creds.json");
    createFile("creds.json.bak");
    createFile("app-state-sync-critical-unblock-low.json");
    createFile("device-list-62833333333.json");
    createFile("pre-key-5.json");
    createFile("lid-mapping-62844444444.json");
    createFile("tctoken");

    const result = resetSignalState(tempDir);

    expect(result.deleted).toBe(3);
    expect(result.errors).toBe(0);

    const stats = getAuthStats(tempDir);
    expect(stats.byType["session"]).toBeUndefined();
    expect(stats.byType["sender-key"]).toBeUndefined();
    expect(stats.byType["identity-key"]).toBeUndefined();
    expect(stats.byType["creds"]).toBe(1);
    expect(stats.byType["pre-key"]).toBe(1);
    expect(stats.byType["app-state-sync"]).toBe(1);
    expect(stats.byType["device-list"]).toBe(1);
    expect(stats.byType["lid-mapping"]).toBe(1);
    expect(stats.byType["other"]).toBe(2); // creds.json.bak + tctoken
  });

  it("returns zero for nonexistent directory", () => {
    const result = resetSignalState("/nonexistent");
    expect(result.deleted).toBe(0);
    expect(result.errors).toBe(0);
  });
});

describe("resolveProtectedLids", () => {
  it("returns PNs and resolves LIDs from forward mapping files", () => {
    // Real format: lid-mapping-<pn>.json contains the LID string
    writeFileSync(
      join(tempDir, "lid-mapping-62811111111.json"),
      '"177906353467436"',
      "utf-8",
    );
    writeFileSync(
      join(tempDir, "lid-mapping-62822222222.json"),
      '"233268364476508"',
      "utf-8",
    );

    const result = resolveProtectedLids(tempDir, [
      "62811111111@s.whatsapp.net",
      "62822222222@s.whatsapp.net",
    ]);

    expect(result).toEqual([
      "62811111111",
      "177906353467436",
      "62822222222",
      "233268364476508",
    ]);
  });

  it("skips PNs without a mapping file (best-effort)", () => {
    const result = resolveProtectedLids(tempDir, [
      "62811111111@s.whatsapp.net",
    ]);

    expect(result).toEqual(["62811111111"]);
  });

  it("skips corrupt and non-numeric mapping content", () => {
    writeFileSync(
      join(tempDir, "lid-mapping-62811111111.json"),
      "not json{{",
      "utf-8",
    );
    writeFileSync(
      join(tempDir, "lid-mapping-62822222222.json"),
      '"abc-lid"',
      "utf-8",
    );

    const result = resolveProtectedLids(tempDir, [
      "62811111111@s.whatsapp.net",
      "62822222222@s.whatsapp.net",
    ]);

    expect(result).toEqual(["62811111111", "62822222222"]);
  });

  it("handles empty input and nonexistent directory", () => {
    expect(resolveProtectedLids(tempDir, [])).toEqual([]);
    expect(
      resolveProtectedLids("/nonexistent", ["62811111111@s.whatsapp.net"]),
    ).toEqual(["62811111111"]);
  });
});

describe("pruneStaleSignalState", () => {
  const MAX_AGE = 30 * DAY;
  const protectedJids = new Set(["62811111111", "62822222222"]);
  const protectedGroups = new Set(["120363238771337472@g.us"]);

  it("deletes old unprotected session and identity files by age", () => {
    createFile("session-62833333333_1.json", 40 * DAY); // unprotected, old
    createFile("session-62844444444_1.json", 0); // fresh
    createFile("identity-key-62855555555_1.json", 40 * DAY);

    const result = pruneStaleSignalState(
      tempDir,
      protectedJids,
      protectedGroups,
      MAX_AGE,
    );

    expect(result.deleted).toBe(2);
    expect(result.errors).toBe(0);
    const stats = getAuthStats(tempDir);
    expect(stats.byType["session"]).toBe(1); // fresh survives
    expect(stats.byType["identity-key"]).toBeUndefined();
  });

  it("keeps protected sessions and identities regardless of age", () => {
    createFile("session-62811111111_1.json", 90 * DAY); // protected JID
    createFile("identity-key-62822222222_1.json", 90 * DAY);

    const result = pruneStaleSignalState(
      tempDir,
      protectedJids,
      protectedGroups,
      MAX_AGE,
    );

    expect(result.deleted).toBe(0);
    expect(getAuthStats(tempDir).total).toBe(2);
  });

  it("keeps sender-keys for protected groups, deletes old ones for others", () => {
    createFile("sender-key-120363238771337472@g.us--1234_1--0.json", 90 * DAY);
    createFile("sender-key-999999999@g.us--5678_1--0.json", 40 * DAY);

    const result = pruneStaleSignalState(
      tempDir,
      protectedJids,
      protectedGroups,
      MAX_AGE,
    );

    expect(result.deleted).toBe(1);
    expect(getAuthStats(tempDir).byType["sender-key"]).toBe(1);
  });

  it("keeps unparseable filenames (fail-safe)", () => {
    createFile("session-abc.json", 90 * DAY); // no device index
    createFile("sender-key-12345@g.us.key.json", 90 * DAY); // legacy, no "--"
    createFile("identity-key-old-name.json", 90 * DAY);

    const result = pruneStaleSignalState(
      tempDir,
      protectedJids,
      protectedGroups,
      MAX_AGE,
    );

    expect(result.deleted).toBe(0);
    expect(getAuthStats(tempDir).total).toBe(3);
  });

  it("never touches creds, pre-keys, or app-state files", () => {
    writeCreds();
    createFile("pre-key-1.json", 90 * DAY);
    createFile("app-state-sync-critical.json", 90 * DAY);
    createFile("session-62833333333_1.json", 90 * DAY);

    const result = pruneStaleSignalState(
      tempDir,
      protectedJids,
      protectedGroups,
      MAX_AGE,
    );

    expect(result.deleted).toBe(1); // only the session
    const stats = getAuthStats(tempDir);
    expect(stats.byType["creds"]).toBe(1);
    expect(stats.byType["pre-key"]).toBe(1);
    expect(stats.byType["app-state-sync"]).toBe(1);
  });

  it("returns zero for nonexistent directory", () => {
    const result = pruneStaleSignalState(
      "/nonexistent",
      protectedJids,
      protectedGroups,
      MAX_AGE,
    );
    expect(result.deleted).toBe(0);
    expect(result.errors).toBe(0);
  });
});

describe("pruneStaleSenderKeys", () => {
  const MAX_AGE = 30 * DAY;

  it("deletes old sender-keys for non-protected groups only", () => {
    createFile("sender-key-120363238771337472@g.us--1234_1--0.json", 90 * DAY);
    createFile("sender-key-999999999@g.us--5678_1--0.json", 40 * DAY);
    createFile("sender-key-weird-format.json", 40 * DAY); // unparseable

    const result = pruneStaleSenderKeys(
      tempDir,
      new Set(["120363238771337472@g.us"]),
      MAX_AGE,
    );

    expect(result.deleted).toBe(1);
    expect(result.errors).toBe(0);
    expect(getAuthStats(tempDir).byType["sender-key"]).toBe(2);
  });
});
