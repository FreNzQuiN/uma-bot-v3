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

import { appendFileSync, existsSync, mkdirSync, readdirSync, renameSync, statSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';

// ============================================================
// Log levels
// ============================================================

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

// ============================================================
// Configuration
// ============================================================

export interface LoggerConfig {
  level: LogLevel;
  logFile: string;
  maxSizeMB: number;
  maxFiles: number;
  console: boolean;
  /** Write to log file. Auto-disabled in test environment (JEST_WORKER_ID set). */
  fileOutput: boolean;
}

const DEFAULT_CONFIG: LoggerConfig = {
  level: 'info',
  logFile: 'data/logs/bot.log',
  maxSizeMB: 5,
  maxFiles: 3,
  console: true,
  // Jest sets JEST_WORKER_ID for each test worker. Disable file output
  // automatically so tests don't pollute the real bot.log.
  fileOutput: !process.env.JEST_WORKER_ID,
};

// ============================================================
// Logger class
// ============================================================

class Logger {
  private config: LoggerConfig;
  private initialized = false;

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
    this.config = { ...this.config, ...config };
    this.ensureLogDir();
  }

  /**
   * Get current config for external callers.
   */
  getConfig(): LoggerConfig {
    return { ...this.config };
  }

  /**
   * Ensure the log directory exists.
   */
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

  /**
   * Check if a given level should be logged.
   */
  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[this.config.level];
  }

  /**
   * Format a log line.
   *
   * Format: [timestamp] [LEVEL] [Tag] message
   */
  private formatLine(level: LogLevel, tag: string, message: string): string {
    const ts = new Date().toISOString();
    const tagStr = tag ? ` [${tag}]` : '';
    return `[${ts}] [${level.toUpperCase()}]${tagStr} ${message}`;
  }

  /**
   * Get ANSI color code for console output.
   */
  private getColor(level: LogLevel): string {
    switch (level) {
      case 'debug': return '\x1b[90m';  // gray
      case 'info':  return '\x1b[36m';  // cyan
      case 'warn':  return '\x1b[33m';  // yellow
      case 'error': return '\x1b[31m';  // red
    }
  }

  /**
   * Write a log line to console and/or file.
   */
  private write(level: LogLevel, tag: string, message: string): void {
    if (!this.shouldLog(level)) return;

    const line = this.formatLine(level, tag, message);

    // Console output
    if (this.config.console) {
      const color = this.getColor(level);
      const reset = '\x1b[0m';
      // eslint-disable-next-line no-console
      console.log(`${color}${line}${reset}`);
    }

    // File output
    this.writeToFile(line);
  }

  /**
   * Write a line to the log file with rotation.
   */
  private writeToFile(line: string): void {
    if (!this.config.fileOutput) return;

    this.ensureLogDir();

    try {
      const filePath = this.config.logFile;

      // Rotate if file exceeds max size
      if (existsSync(filePath) && this.config.maxFiles > 0) {
        const stat = statSync(filePath);
        const sizeMB = stat.size / (1024 * 1024);
        if (sizeMB >= this.config.maxSizeMB) {
          appendFileSync(filePath, line + '\n', 'utf-8');
          setImmediate(() => this.rotate(filePath));
          return;
        }
      }

      appendFileSync(filePath, line + '\n', 'utf-8');
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
      const ext = '.log';
      const base = filePath.endsWith(ext) ? filePath.slice(0, -ext.length) : filePath;

      // Delete oldest file if it exceeds maxFiles
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

      // Rename current → 1
      renameSync(filePath, `${base}-1${ext}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[Logger] Rotation failed: ${msg}\n`);
    }
  }

  // ============================================================
  // Public API
  // ============================================================

  debug(tag: string, message: string, err?: unknown): void {
    const suffix = err instanceof Error ? `: ${err.stack}` : err ? `: ${String(err)}` : '';
    this.write('debug', tag, message + suffix);
  }

  info(tag: string, message: string, err?: unknown): void {
    const suffix = err instanceof Error ? `: ${err.stack}` : err ? `: ${String(err)}` : '';
    this.write('info', tag, message + suffix);
  }

  warn(tag: string, message: string, err?: unknown): void {
    const suffix = err instanceof Error ? `: ${err.stack}` : err ? `: ${String(err)}` : '';
    this.write('warn', tag, message + suffix);
  }

  error(tag: string, message: string, err?: unknown): void {
    const suffix = err instanceof Error ? `: ${err.stack}` : err ? `: ${String(err)}` : '';
    this.write('error', tag, message + suffix);
  }
}

// ============================================================
// Singleton instance
// ============================================================

export const log = new Logger();
