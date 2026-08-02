/**
 * WhatsApp auth directory housekeeping.
 *
 * Baileys writes session state to data/auth/ as flat JSON files.
 * Some file types accumulate unbounded (lid-mapping, pre-key) and need
 * periodic pruning. Others (creds, identity-key, app-state) must never
 * be deleted during normal operation.
 *
 * File types and their lifecycle:
 * - creds.json              — identity credentials, never delete
 * - identity-key-*          — Signal identity keys, never delete
 * - app-state-sync-*        — WhatsApp app state, never delete
 * - device-list-*           — known device lists, never delete
 * - session-*.json          — Signal sessions, required for group sender-key
 * - sender-key-*            — group encryption keys, delete only on corruption
 * - lid-mapping-*           — LID reverse lookup cache, safe to prune old ones
 * - pre-key-*               — Signal pre-keys, Baileys manages internally
 */

import { readdirSync, statSync, unlinkSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { log } from "../utils/logger";

const LID_MAPPING_PREFIX = "lid-mapping-";
const SENDER_KEY_PREFIX = "sender-key-";
const PRE_KEY_PREFIX = "pre-key-";
const SESSION_PREFIX = "session-";
const CREDS_FILE = "creds.json";

/** Files that must never be deleted during normal operation. */
const PROTECTED_PREFIXES = [
  "creds.json",
  "identity-key-",
  "app-state-sync-",
  "device-list-",
];

/** Default: prune lid-mapping files older than 7 days. */
const DEFAULT_LID_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export interface AuthStats {
  total: number;
  byType: Record<string, number>;
}

export interface CleanupResult {
  deleted: number;
  errors: number;
}

/**
 * Count auth files grouped by type prefix.
 * Returns total file count and per-type counts.
 */
export function getAuthStats(authDir: string): AuthStats {
  const byType: Record<string, number> = {};

  if (!existsSync(authDir)) {
    return { total: 0, byType };
  }

  const files = readdirSync(authDir);
  for (const file of files) {
    const type = classifyAuthFile(file);
    byType[type] = (byType[type] ?? 0) + 1;
  }

  return { total: files.length, byType };
}

/**
 * Classify an auth file into a human-readable type bucket.
 */
function classifyAuthFile(filename: string): string {
  if (filename === CREDS_FILE) return "creds";
  if (filename.startsWith(LID_MAPPING_PREFIX)) return "lid-mapping";
  if (filename.startsWith(SENDER_KEY_PREFIX)) return "sender-key";
  if (filename.startsWith(PRE_KEY_PREFIX)) return "pre-key";
  if (filename.startsWith(SESSION_PREFIX)) return "session";
  if (filename.startsWith("identity-key-")) return "identity-key";
  if (filename.startsWith("app-state-sync-")) return "app-state-sync";
  if (filename.startsWith("device-list-")) return "device-list";
  return "other";
}

/**
 * Delete lid-mapping files older than maxAgeMs.
 *
 * LID mappings are reverse-lookup caches that Baileys recreates on demand.
 * Old mappings for contacts no longer in any shared group are pure bloat.
 */
export function pruneStaleLidMappings(
  authDir: string,
  maxAgeMs: number = DEFAULT_LID_MAX_AGE_MS,
): CleanupResult {
  let deleted = 0;
  let errors = 0;

  if (!existsSync(authDir)) {
    return { deleted, errors };
  }

  const now = Date.now();
  const files = readdirSync(authDir);

  for (const file of files) {
    if (!file.startsWith(LID_MAPPING_PREFIX)) continue;

    const filePath = join(authDir, file);
    try {
      const stat = statSync(filePath);
      if (now - stat.mtimeMs > maxAgeMs) {
        unlinkSync(filePath);
        deleted++;
      }
    } catch {
      errors++;
    }
  }

  return { deleted, errors };
}

/**
 * Auto-delete a corrupted sender-key file for a specific JID.
 *
 * Called when sendMessageWithRetry detects a senderMessageKeys or
 * SenderKeyState error. Baileys will recreate the sender-key on
 * next group message attempt.
 *
 * @returns true if a file was found and deleted
 */
export function deleteCorruptedSenderKey(
  authDir: string,
  jid: string,
): boolean {
  if (!existsSync(authDir)) return false;

  const files = readdirSync(authDir);
  // Extract the numeric part from the JID for file matching
  const numericPart = jid.replace(/@.*/, "");

  for (const file of files) {
    if (!file.startsWith(SENDER_KEY_PREFIX)) continue;
    if (!file.includes(numericPart)) continue;

    try {
      unlinkSync(join(authDir, file));
      log.info("WhatsApp", `Auto-deleted corrupted sender-key: ${file}`);
      return true;
    } catch {
      // File may have been deleted by another process — not an error
    }
  }

  return false;
}

/**
 * Run all startup cleanup tasks and log auth directory health.
 *
 * Call this once during connect(), before useMultiFileAuthState().
 */
export function runAuthCleanup(authDir: string): void {
  if (!existsSync(authDir)) return;

  const statsBefore = getAuthStats(authDir);
  log.info(
    "WhatsApp",
    `Auth directory: ${statsBefore.total} files — ${formatStats(statsBefore)}`,
  );

  const pruned = pruneStaleLidMappings(authDir);
  if (pruned.deleted > 0) {
    log.info("WhatsApp", `Pruned ${pruned.deleted} stale lid-mapping files`);
  }
  if (pruned.errors > 0) {
    log.warn("WhatsApp", `Failed to prune ${pruned.errors} lid-mapping files`);
  }

  const statsAfter = getAuthStats(authDir);
  if (statsBefore.total !== statsAfter.total) {
    log.info(
      "WhatsApp",
      `Auth cleanup: ${statsBefore.total} → ${statsAfter.total} files`,
    );
  }
}

function formatStats(stats: AuthStats): string {
  return Object.entries(stats.byType)
    .sort((a, b) => b[1] - a[1])
    .map(([type, count]) => `${type}:${count}`)
    .join(" ");
}
