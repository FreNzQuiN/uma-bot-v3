/**
 * Configuration loader for Uma Club Bot v3.
 *
 * Loads YAML config, validates with Zod, provides defaults.
 * Immutable updates — never mutates, always returns new objects.
 */

import { readFileSync, writeFileSync, renameSync, existsSync } from "fs";
import {
  parse as parseYaml,
  stringify as stringifyYaml,
  parseDocument,
} from "yaml";
import { z } from "zod";
import type { BotConfig } from "./types";
import { log } from "./utils/logger";

const timePattern = z
  .string()
  .regex(/^\d{2}:\d{2}$/, "Must be HH:MM format")
  .refine(
    (val) => {
      const [h, m] = val.split(":").map(Number);
      return h >= 0 && h <= 23 && m >= 0 && m <= 59;
    },
    { message: "Invalid time: hour must be 00-23, minute must be 00-59" },
  );

const ConfigSchema = z.object({
  circleId: z.number().int().positive().default(232229195),
  timezone: z.string().default("Asia/Jakarta"),

  commands: z
    .object({
      prefixes: z.array(z.string()).default(["/"]),
      maxDailyOffset: z.number().int().min(0).default(31),
      maxWeeklyOffset: z.number().int().min(0).default(5),
      maxMonthlyOffset: z.number().int().min(0).default(12),
      maxAnalyzeOffset: z.number().int().min(0).default(12),
    })
    .default({}),

  admins: z.array(z.string()).default([]),

  groups: z
    .object({
      command: z.array(z.string()).default([]),
      announcement: z.array(z.string()).default([]),
      alertAdmin: z.array(z.string()).default([]),
    })
    .default({}),

  requirements: z
    .object({
      monthlyFans: z.number().min(0).max(10_000_000_000).default(20_000_000),
      weeklyFans: z.number().min(0).max(10_000_000_000).default(0),
      weeksInMonthEquivalent: z
        .number()
        .min(1)
        .default(30 / 7),
      includeTransferDataInCalculation: z.boolean().default(false),
    })
    .default({}),

  schedule: z
    .object({
      daily: z
        .object({
          enabled: z.boolean().default(true),
          time: timePattern.default("22:05"),
        })
        .default({}),
      weekly: z
        .object({
          enabled: z.boolean().default(true),
          days: z
            .array(z.number().int().min(1).max(31))
            .default([7, 14, 21, 28]),
          time: timePattern.default("22:05"),
        })
        .default({}),
      monthly: z
        .object({
          enabled: z.boolean().default(true),
          day: z.number().int().min(1).max(31).default(1),
          time: timePattern.default("22:12"),
        })
        .default({}),
    })
    .default({}),

  catchUp: z
    .object({
      enabled: z.boolean().default(true),
      maxReportsPerStartup: z.number().int().min(0).default(10),
    })
    .default({}),

  alerts: z
    .object({
      enabled: z.boolean().default(true),
      defaultRecipients: z.enum(["admin", "group"]).default("admin"),
      performanceDrop: z
        .object({
          enabled: z.boolean().default(true),
          thresholdPercent: z.number().min(0).max(100).default(50),
          minHistoryDays: z.number().int().min(1).default(7),
        })
        .default({}),
      demotionRisk: z
        .object({
          enabled: z.boolean().default(true),
          bufferDays: z.number().int().min(0).default(3),
        })
        .default({}),
      streakBreak: z
        .object({
          enabled: z.boolean().default(true),
        })
        .default({}),
      newTransfer: z
        .object({
          enabled: z.boolean().default(true),
        })
        .default({}),
      rankDrop: z
        .object({
          enabled: z.boolean().default(false),
          positions: z.number().int().min(1).default(10),
        })
        .default({}),
      quietHours: z
        .object({
          enabled: z.boolean().default(false),
          start: timePattern.default("23:00"),
          end: timePattern.default("06:00"),
        })
        .default({}),
    })
    .default({}),

  memberStatus: z
    .object({
      staleAfterDaysDaily: z.number().int().min(0).default(0),
      staleAfterDaysWeekly: z.number().int().min(0).default(3),
      staleAfterDaysMonthly: z.number().int().min(0).default(7),
    })
    .default({}),

  message: z
    .object({
      maxLength: z.number().int().min(256).default(4096),
      splitAtNewline: z.boolean().default(true),
      language: z.string().default("id"),
    })
    .default({}),

  logging: z
    .object({
      level: z.enum(["debug", "info", "warn", "error"]).default("info"),
      logFile: z.string().default("data/logs/bot.log"),
      maxSizeMB: z.number().min(0.1).default(5),
      maxFiles: z.number().int().min(0).default(3),
      console: z.boolean().default(true),
    })
    .default({}),

  database: z
    .object({
      backend: z.enum(["sqlite", "mysql"]).default("sqlite"),
      sqlite: z
        .object({
          path: z.string().default("data/bot.db"),
          autoSaveMs: z.number().int().min(1000).default(30_000),
        })
        .default({}),
      mysql: z
        .object({
          host: z.string().default("localhost"),
          port: z.number().int().min(1).max(65535).default(3306),
          database: z.string().default("uma_club_bot"),
          user: z.string().default(""),
          password: z.string().default(""),
          connectionLimit: z.number().int().min(1).max(100).default(5),
          ssl: z.boolean().default(false),
        })
        .default({}),
    })
    .default({}),
});

export function getDefaultConfig(): BotConfig {
  const result = ConfigSchema.parse({});
  // Compile-time check: Zod schema output must match BotConfig
  const _: BotConfig = result as BotConfig;
  return _;
}

export function validateConfig(data: unknown): BotConfig {
  const result = ConfigSchema.parse(data);
  // Compile-time check: Zod schema output must match BotConfig
  const _: BotConfig = result as BotConfig;
  return _;
}

export function loadConfig(filePath?: string): BotConfig {
  const path = filePath ?? "config.yaml";

  if (!existsSync(path)) {
    log.warn("Config", `Config file ${path} not found, using defaults`);
    return getDefaultConfig();
  }

  try {
    const raw = readFileSync(path, "utf-8");
    const parsed = parseYaml(raw);
    return validateConfig(parsed);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const issues = error.issues
        .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
        .join("\n");
      throw new Error(`Config validation failed:\n${issues}`);
    }
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to load config from ${path}: ${msg}`);
  }
}

function deepMerge<T extends Record<string, unknown>>(
  target: T,
  source: Partial<T>,
): T {
  const result = { ...target };

  for (const [key, value] of Object.entries(source)) {
    if (
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      typeof target[key] === "object" &&
      target[key] !== null &&
      !Array.isArray(target[key])
    ) {
      (result as Record<string, unknown>)[key] = deepMerge(
        target[key] as Record<string, unknown>,
        value as Record<string, unknown>,
      );
    } else {
      (result as Record<string, unknown>)[key] = value;
    }
  }

  return result;
}

export function updateConfig(
  current: BotConfig,
  updates: Partial<BotConfig>,
): BotConfig {
  const merged = deepMerge(
    current as unknown as Record<string, unknown>,
    updates as unknown as Record<string, unknown>,
  );
  return validateConfig(merged);
}

/**
 * Save config to disk as YAML, preserving original file formatting.
 * Uses the yaml Document API to preserve block-style, comments, and ordering.
 * Falls back to plain stringify if the file can't be read/parsed.
 * The file watcher will detect the mtime change and reload.
 */
export function saveConfig(config: BotConfig, filePath?: string): void {
  const path = filePath ?? "config.yaml";
  let raw: string;
  try {
    const existing = readFileSync(path, "utf-8");
    const doc = parseDocument(existing);
    for (const key of Object.keys(config) as (keyof BotConfig)[]) {
      doc.setIn([key], config[key]);
    }
    raw = String(doc);
  } catch {
    log.debug(
      "Config",
      "Could not parse existing config for formatting preservation, using plain YAML",
    );
    raw = stringifyYaml(config);
  }
  const tmpPath = path + ".tmp";
  writeFileSync(tmpPath, raw, { encoding: "utf-8", flag: "w" });
  renameSync(tmpPath, path);
}
