/**
 * Unit tests for WhatsApp auth directory cleanup.
 *
 * Uses real temp directories (not mocked fs) to test actual file operations.
 * Each test creates an isolated temp dir that's cleaned up after.
 */

import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  getAuthStats,
  pruneStaleLidMappings,
  deleteCorruptedSenderKey,
  runAuthCleanup,
} from "../../src/whatsapp/auth-cleanup";

jest.mock("../../src/utils/logger", () => ({
  log: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

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
    createFile("lid-mapping-old.json", 10 * 24 * 60 * 60 * 1000); // 10 days old
    createFile("lid-mapping-recent.json", 0); // just created
    createFile("creds.json", 10 * 24 * 60 * 60 * 1000); // old but not lid-mapping

    const result = pruneStaleLidMappings(tempDir, 7 * 24 * 60 * 60 * 1000);

    expect(result.deleted).toBe(1);
    expect(result.errors).toBe(0);

    const stats = getAuthStats(tempDir);
    expect(stats.byType["lid-mapping"]).toBe(1); // recent one survives
    expect(stats.byType["creds"]).toBe(1); // untouched
  });

  it("deletes nothing when all files are recent", () => {
    createFile("lid-mapping-new1.json", 0);
    createFile("lid-mapping-new2.json", 0);

    const result = pruneStaleLidMappings(tempDir, 7 * 24 * 60 * 60 * 1000);

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
    createFile("pre-key-old.json", 100 * 24 * 60 * 60 * 1000); // very old
    createFile("session-old.json", 100 * 24 * 60 * 60 * 1000); // very old
    createFile("lid-mapping-old.json", 100 * 24 * 60 * 60 * 1000); // very old

    const result = pruneStaleLidMappings(tempDir, 7 * 24 * 60 * 60 * 1000);

    expect(result.deleted).toBe(1); // only the lid-mapping
    expect(result.errors).toBe(0);

    const stats = getAuthStats(tempDir);
    expect(stats.byType["pre-key"]).toBe(1); // untouched
    expect(stats.byType["session"]).toBe(1); // untouched
  });

  it("handles multiple old lid-mapping files", () => {
    for (let i = 0; i < 10; i++) {
      createFile(`lid-mapping-${i}.json`, 30 * 24 * 60 * 60 * 1000); // 30 days old
    }

    const result = pruneStaleLidMappings(tempDir, 7 * 24 * 60 * 60 * 1000);

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
    createFile("lid-mapping-old.json", 30 * 24 * 60 * 60 * 1000);
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
});
