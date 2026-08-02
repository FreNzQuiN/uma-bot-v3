import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { log, LogLevel, LoggerConfig } from "../../src/utils/logger";

let tmpDir: string;

function createTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "logger-test-"));
}

function waitImmediate(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function readFileLines(filePath: string): string[] {
  const content = fs.readFileSync(filePath, "utf-8");
  return content.split("\n").filter((line) => line.length > 0);
}

const TINY_LOG_SIZE = 0.00001;

async function waitForRotation(): Promise<void> {
  // Rotation is scheduled via setImmediate; double flush guards against flakiness
  await waitImmediate();
  await waitImmediate();
}

beforeEach(() => {
  tmpDir = createTmpDir();
  // Disable console output during tests, but enable file output (pointed at tmp dirs)
  log.configure({ console: false, fileOutput: true });
});

afterEach(() => {
  // Reset logger to safe defaults (console off, file output off, pointing to non-test path)
  log.configure({
    level: "info",
    logFile: "data/logs/bot.log",
    maxSizeMB: 5,
    maxFiles: 3,
    console: false,
    fileOutput: false,
  });

  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // ignore cleanup errors
  }
});

describe("Logger configure()", () => {
  test("updates config values", () => {
    log.configure({ level: "warn", maxSizeMB: 10 });

    const config = log.getConfig();
    expect(config.level).toBe("warn");
    expect(config.maxSizeMB).toBe(10);
  });

  test("partial update preserves other values", () => {
    log.configure({ maxFiles: 7 });

    const config = log.getConfig();
    expect(config.maxFiles).toBe(7);
    expect(config.level).toBe("info");
    expect(config.maxSizeMB).toBe(5);
  });

  test("default config has correct values", () => {
    // NOTE: beforeEach already set console=false and fileOutput=true,
    // so we test the remaining defaults.
    const config = log.getConfig();
    expect(config.level).toBe("info");
    expect(config.logFile).toBe("data/logs/bot.log");
    expect(config.maxSizeMB).toBe(5);
    expect(config.maxFiles).toBe(3);
  });

  test("changing logFile resets initialized flag so next write creates new dir", () => {
    const logFile1 = path.join(tmpDir, "sub1", "first.log");
    const logFile2 = path.join(tmpDir, "sub2", "second.log");

    log.configure({ logFile: logFile1 });
    log.info("Test", "first");
    expect(fs.existsSync(path.join(tmpDir, "sub1"))).toBe(true);

    log.configure({ logFile: logFile2 });
    log.info("Test", "second");
    expect(fs.existsSync(path.join(tmpDir, "sub2"))).toBe(true);

    expect(fs.existsSync(logFile1)).toBe(true);
    expect(fs.existsSync(logFile2)).toBe(true);
  });
});

describe("Logger getConfig()", () => {
  test("returns a copy — mutation does not affect internal state", () => {
    const config1 = log.getConfig();
    config1.level = "error";
    config1.maxSizeMB = 999;

    const config2 = log.getConfig();
    expect(config2.level).not.toBe("error");
    expect(config2.maxSizeMB).not.toBe(999);
  });
});

describe("Logger level filtering", () => {
  test("debug() writes nothing when level is info", () => {
    const logFile = path.join(tmpDir, "test.log");
    log.configure({ level: "info", logFile });

    log.debug("Tag", "should not appear");

    expect(fs.existsSync(logFile)).toBe(false);
  });

  test("info() writes when level is info", () => {
    const logFile = path.join(tmpDir, "test.log");
    log.configure({ level: "info", logFile });

    log.info("Tag", "hello");

    expect(fs.existsSync(logFile)).toBe(true);
    const lines = readFileLines(logFile);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("hello");
  });

  test("warn() writes when level is info", () => {
    const logFile = path.join(tmpDir, "test.log");
    log.configure({ level: "info", logFile });

    log.warn("Tag", "warning");

    expect(fs.existsSync(logFile)).toBe(true);
    const lines = readFileLines(logFile);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("warning");
  });

  test("error() writes when level is info", () => {
    const logFile = path.join(tmpDir, "test.log");
    log.configure({ level: "info", logFile });

    log.error("Tag", "error msg");

    expect(fs.existsSync(logFile)).toBe(true);
    const lines = readFileLines(logFile);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("error msg");
  });

  test("info() writes nothing when level is error", () => {
    const logFile = path.join(tmpDir, "test.log");
    log.configure({ level: "error", logFile });

    log.info("Tag", "should not appear");
    log.warn("Tag", "should not appear either");

    expect(fs.existsSync(logFile)).toBe(false);
  });

  test("error() writes when level is error", () => {
    const logFile = path.join(tmpDir, "test.log");
    log.configure({ level: "error", logFile });

    log.error("Tag", "this appears");

    expect(fs.existsSync(logFile)).toBe(true);
    const lines = readFileLines(logFile);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("this appears");
  });

  test("debug() writes when level is debug", () => {
    const logFile = path.join(tmpDir, "test.log");
    log.configure({ level: "debug", logFile });

    log.debug("Tag", "debug msg");

    expect(fs.existsSync(logFile)).toBe(true);
    const lines = readFileLines(logFile);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("debug msg");
  });

  test("warn() with level debug writes", () => {
    const logFile = path.join(tmpDir, "test.log");
    log.configure({ level: "debug", logFile });

    log.warn("Tag", "warn msg");

    expect(fs.existsSync(logFile)).toBe(true);
    const lines = readFileLines(logFile);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("warn msg");
  });
});

describe("Logger file writing", () => {
  test("configure() + info() creates log directory and file", () => {
    const logDir = path.join(tmpDir, "deeply", "nested", "logs");
    const logFile = path.join(logDir, "bot.log");
    log.configure({ logFile });

    // configure() already calls ensureLogDir() which creates the directory
    expect(fs.existsSync(logDir)).toBe(true);

    log.info("Test", "creating file");
    expect(fs.existsSync(logFile)).toBe(true);
  });

  test("log line format matches [ISO timestamp] [LEVEL] [Tag] message", () => {
    const logFile = path.join(tmpDir, "test.log");
    log.configure({ logFile });

    log.info("Bot", "server started");

    const lines = readFileLines(logFile);
    expect(lines).toHaveLength(1);

    // Match: [2026-06-23 03:51:21.653] [INFO] [Bot] server started
    const pattern =
      /^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}\] \[INFO\] \[Bot\] server started$/;
    expect(lines[0]).toMatch(pattern);
  });

  test("error level line uses uppercase ERROR", () => {
    const logFile = path.join(tmpDir, "test.log");
    log.configure({ logFile });

    log.error("Scheduler", "cron failed");

    const lines = readFileLines(logFile);
    expect(lines[0]).toContain("[ERROR]");
    expect(lines[0]).not.toContain("[error]");
  });

  test("multiple writes append to same file", () => {
    const logFile = path.join(tmpDir, "test.log");
    log.configure({ logFile });

    log.info("Tag", "line one");
    log.info("Tag", "line two");
    log.warn("Tag", "line three");

    const lines = readFileLines(logFile);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain("line one");
    expect(lines[1]).toContain("line two");
    expect(lines[2]).toContain("line three");
  });
});

describe("Logger rotation", () => {
  test("rotation triggers when file exceeds maxSizeMB and creates rotated file", async () => {
    const logFile = path.join(tmpDir, "bot.log");
    // Set maxSizeMB very small (~10 bytes) so a single log line triggers rotation
    log.configure({ logFile, maxSizeMB: TINY_LOG_SIZE, maxFiles: 3 });

    // First write: file doesn't exist yet, so no rotation check
    log.info("Tag", "first write");
    expect(fs.existsSync(logFile)).toBe(true);

    log.info("Tag", "second write triggers rotation");

    await waitForRotation();

    // The original file was renamed to bot-1.log
    const rotatedFile = path.join(tmpDir, "bot-1.log");
    expect(fs.existsSync(rotatedFile)).toBe(true);

    // bot-1.log should contain both lines (they were written before rotation)
    const rotatedLines = readFileLines(rotatedFile);
    expect(rotatedLines.length).toBeGreaterThanOrEqual(2);
    expect(rotatedLines[0]).toContain("first write");
    expect(rotatedLines[1]).toContain("second write triggers rotation");
  });

  test("after rotation, current log entry is not lost", async () => {
    const logFile = path.join(tmpDir, "bot.log");
    const uniqueMessage = `unique-${Date.now()}-payload`;
    log.configure({ logFile, maxSizeMB: TINY_LOG_SIZE, maxFiles: 3 });

    log.info("Tag", "filler");

    // Second write triggers rotation — the unique message is appended THEN rotated
    log.info("Tag", uniqueMessage);

    await waitForRotation();

    const rotatedFile = path.join(tmpDir, "bot-1.log");
    expect(fs.existsSync(rotatedFile)).toBe(true);
    const rotatedContent = fs.readFileSync(rotatedFile, "utf-8");
    expect(rotatedContent).toContain(uniqueMessage);
  });

  test("rotation respects maxFiles limit by deleting oldest", async () => {
    const logFile = path.join(tmpDir, "bot.log");
    // maxFiles=2 means: bot.log + bot-1.log + bot-2.log
    // When bot-2.log exists, it gets deleted before shifting
    log.configure({ logFile, maxSizeMB: TINY_LOG_SIZE, maxFiles: 2 });

    log.info("Tag", "round 1");
    log.info("Tag", "round 1 rotate");
    await waitForRotation();

    expect(fs.existsSync(path.join(tmpDir, "bot-1.log"))).toBe(true);

    log.info("Tag", "round 2");
    log.info("Tag", "round 2 rotate");
    await waitForRotation();

    expect(fs.existsSync(path.join(tmpDir, "bot-2.log"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, "bot-1.log"))).toBe(true);
  });

  test("rotation does not happen when maxFiles is 0", async () => {
    const logFile = path.join(tmpDir, "bot.log");
    log.configure({ logFile, maxSizeMB: TINY_LOG_SIZE, maxFiles: 0 });

    log.info("Tag", "line 1");
    log.info("Tag", "line 2");
    log.info("Tag", "line 3");

    await waitImmediate();

    const rotatedFile = path.join(tmpDir, "bot-1.log");
    expect(fs.existsSync(rotatedFile)).toBe(false);

    const lines = readFileLines(logFile);
    expect(lines).toHaveLength(3);
  });
});

describe("Logger error parameter", () => {
  test("error() with Error object logs the message and stack", () => {
    const logFile = path.join(tmpDir, "test.log");
    log.configure({ logFile });

    const err = new Error("connection refused");
    log.error("WhatsApp", "failed to connect", err);

    // err.stack contains newlines, so use raw content instead of splitting
    const content = fs.readFileSync(logFile, "utf-8");
    expect(content).toContain("failed to connect");
    expect(content).toContain("connection refused");
    expect(content).toContain("Error");
    expect(content).toContain("[ERROR]");
    // File output keeps the full stack (console strips it, file does not).
    // Newlines are flattened to spaces by formatLine's message sanitization.
    expect(content).toContain("    at ");
  });

  test("error() with string logs the string", () => {
    const logFile = path.join(tmpDir, "test.log");
    log.configure({ logFile });

    log.error("DB", "write failed", "disk full");

    const lines = readFileLines(logFile);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("write failed");
    expect(lines[0]).toContain("disk full");
  });

  test("error() with unknown value logs String(value)", () => {
    const logFile = path.join(tmpDir, "test.log");
    log.configure({ logFile });

    log.error("Scheduler", "unexpected", 42);

    const lines = readFileLines(logFile);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("unexpected");
    expect(lines[0]).toContain("42");
  });

  test("info() also accepts err parameter", () => {
    const logFile = path.join(tmpDir, "test.log");
    log.configure({ logFile });

    const err = new Error("timeout");
    log.info("API", "request slow", err);

    const content = fs.readFileSync(logFile, "utf-8");
    expect(content).toContain("request slow");
    expect(content).toContain("timeout");
    expect(content).toContain("[INFO]");
  });

  test("error() with null err logs only message", () => {
    const logFile = path.join(tmpDir, "test.log");
    log.configure({ logFile });

    log.error("Tag", "message only", null);

    const lines = readFileLines(logFile);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("message only");
    // Should not have any suffix separator
    const msgPart = lines[0].split("] ").slice(3).join("] ");
    expect(msgPart).toBe("message only");
  });

  test("error() with no err parameter logs only message", () => {
    const logFile = path.join(tmpDir, "test.log");
    log.configure({ logFile });

    log.error("Tag", "message only");

    const lines = readFileLines(logFile);
    expect(lines).toHaveLength(1);
    const msgPart = lines[0].split("] ").slice(3).join("] ");
    expect(msgPart).toBe("message only");
  });
});

describe("Logger tags", () => {
  test("empty tag omits tag brackets", () => {
    const logFile = path.join(tmpDir, "test.log");
    log.configure({ logFile });

    log.info("", "no tag");

    const lines = readFileLines(logFile);
    // Empty string is falsy → tagStr = '' → format: [ts] [INFO] no tag
    expect(lines[0]).toMatch(
      /^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}\] \[INFO\] no tag$/,
    );
  });

  test("tag is included in brackets", () => {
    const logFile = path.join(tmpDir, "test.log");
    log.configure({ logFile });

    log.info("Scheduler", "tick");

    const lines = readFileLines(logFile);
    expect(lines[0]).toContain("[Scheduler]");
  });
});
