/**
 * Structured logger for Uma Club Bot v3.
 *
 * Features:
 * - Configurable log levels (debug, info, warn, error)
 * - Timestamps with configurable timezone
 * - Tag-based source identification ([Bot], [Scheduler], [WhatsApp], etc.)
 * - Console output with optional color
 * - File output with rotation (max size + max files)
 * - Zero external dependencies
 */

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
} from "fs";
import { join, dirname } from "path";

export type LogLevel = "debug" | "info" | "warn" | "error";

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export interface LoggerConfig {
  level: LogLevel;
  logFile: string;
  maxSizeMB: number;
  maxFiles: number;
  console: boolean;
  /** IANA timezone for log timestamps (default: 'Asia/Jakarta'). */
  timezone: string;
  /** Write to log file. Auto-disabled in test environment (JEST_WORKER_ID set). */
  fileOutput: boolean;
}

const DEFAULT_CONFIG: LoggerConfig = {
  level: "info",
  logFile: "data/logs/bot.log",
  maxSizeMB: 5,
  maxFiles: 3,
  console: true,
  timezone: "Asia/Jakarta",
  // Jest sets JEST_WORKER_ID for each test worker. Disable file output
  // automatically so tests don't pollute the real bot.log.
  fileOutput: !process.env.JEST_WORKER_ID,
};

class Logger {
  private config: LoggerConfig;
  private initialized = false;
  private cachedFormatter: Intl.DateTimeFormat | null = null;

  constructor() {
    this.config = { ...DEFAULT_CONFIG };
  }

  /**
   * Update logger configuration at runtime (called on config reload).
   */
  configure(config: Partial<LoggerConfig>): void {
    if (config.logFile && config.logFile !== this.config.logFile) {
      this.initialized = false;
    }
    if (config.timezone && config.timezone !== this.config.timezone) {
      this.cachedFormatter = null;
    }
    this.config = { ...this.config, ...config };
    this.ensureLogDir();
  }

  /**
   * Get current config for external callers.
   */
  getConfig(): LoggerConfig {
    return { ...this.config };
  }

  private ensureLogDir(): void {
    if (this.initialized) return;
    try {
      const dir = dirname(this.config.logFile);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      this.initialized = true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[Logger] Failed to create log directory: ${msg}\n`);
      // File logging disabled, console output still works
    }
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[this.config.level];
  }

  /**
   * Format a log line.
   *
   * Format: [timestamp] [LEVEL] [Tag] message
   * Timestamp uses the configured timezone (default: Asia/Jakarta).
   */
  private formatLine(level: LogLevel, tag: string, message: string): string {
    const now = new Date();
    if (!this.cachedFormatter) {
      this.cachedFormatter = new Intl.DateTimeFormat("sv-SE", {
        timeZone: this.config.timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
      });
    }
    const ts = this.cachedFormatter.format(now);
    const ms = String(now.getMilliseconds()).padStart(3, "0");
    const sanitized = message.replace(/[\r\n]+/g, " ");
    const tagStr = tag ? ` [${tag}]` : "";
    return `[${ts}.${ms}] [${level.toUpperCase()}]${tagStr} ${sanitized}`;
  }

  private getColor(level: LogLevel): string {
    switch (level) {
      case "debug":
        return "\x1b[90m"; // gray
      case "info":
        return "\x1b[36m"; // cyan
      case "warn":
        return "\x1b[33m"; // yellow
      case "error":
        return "\x1b[31m"; // red
    }
  }

  /**
   * Write a log line to console and/or file.
   *
   * For error-level logs, the stack trace is written to the file only —
   * console output shows just the message to keep production logs clean.
   */
  private write(level: LogLevel, tag: string, message: string): void {
    if (!this.shouldLog(level)) return;

    if (this.config.console) {
      const consoleMsg =
        level === "error" || level === "warn"
          ? this.stripStackTrace(message)
          : message;
      const consoleLine = this.formatLine(level, tag, consoleMsg);
      const color = this.getColor(level);
      const reset = "\x1b[0m";

      console.log(`${color}${consoleLine}${reset}`);
    }

    const fileLine = this.formatLine(level, tag, message);
    this.writeToFile(fileLine, level);
  }

  /**
   * Strip stack trace from an error message.
   * "Error: foo\n    at bar\n    at baz" → "Error: foo"
   */
  private stripStackTrace(message: string): string {
    const newlineIdx = message.indexOf("\n");
    return newlineIdx >= 0 ? message.slice(0, newlineIdx) : message;
  }

  private writeToFile(line: string, level: LogLevel): void {
    if (!this.config.fileOutput) return;

    this.ensureLogDir();

    try {
      const filePath = this.config.logFile;
      const fileMsg =
        level === "error" || level === "warn"
          ? this.stripStackTrace(line)
          : line;

      if (existsSync(filePath) && this.config.maxFiles > 0) {
        const stat = statSync(filePath);
        const sizeMB = stat.size / (1024 * 1024);
        if (sizeMB >= this.config.maxSizeMB) {
          appendFileSync(filePath, fileMsg + "\n", "utf-8");
          setImmediate(() => this.rotate(filePath));
          return;
        }
      }

      appendFileSync(filePath, fileMsg + "\n", "utf-8");
    } catch (err) {
      this.initialized = false;
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[Logger] Write failed: ${msg}\n`);
    }
  }

  /**
   * Rotate log files: shift existing files and create new one.
   *
   * bot.log → bot-1.log
   * bot-1.log → bot-2.log
   * bot-2.log → deleted (if exceeds maxFiles)
   */
  private rotate(filePath: string): void {
    try {
      const dir = dirname(filePath);
      const ext = ".log";
      const base = filePath.endsWith(ext)
        ? filePath.slice(0, -ext.length)
        : filePath;

      const oldestFile = `${base}-${this.config.maxFiles}${ext}`;
      if (existsSync(oldestFile)) {
        unlinkSync(oldestFile);
      }

      // Shift files: N-1 → N, N-2 → N-1, ..., 1 → 2
      for (let i = this.config.maxFiles - 1; i >= 1; i--) {
        const from = `${base}-${i}${ext}`;
        const to = `${base}-${i + 1}${ext}`;
        if (existsSync(from)) {
          renameSync(from, to);
        }
      }

      renameSync(filePath, `${base}-1${ext}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[Logger] Rotation failed: ${msg}\n`);
    }
  }

  private formatErr(err: unknown): string {
    return err instanceof Error
      ? `: ${err.stack}`
      : err
        ? `: ${String(err)}`
        : "";
  }

  debug(tag: string, message: string, err?: unknown): void {
    this.write("debug", tag, message + this.formatErr(err));
  }

  info(tag: string, message: string, err?: unknown): void {
    this.write("info", tag, message + this.formatErr(err));
  }

  warn(tag: string, message: string, err?: unknown): void {
    this.write("warn", tag, message + this.formatErr(err));
  }

  error(tag: string, message: string, err?: unknown): void {
    this.write("error", tag, message + this.formatErr(err));
  }
}

export const log = new Logger();
