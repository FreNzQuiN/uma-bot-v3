/**
 * WhatsApp auth directory housekeeping.
 *
 * Baileys writes session state to data/auth/ as flat JSON files.
 * Some file types accumulate unbounded (lid-mapping, pre-key) and need
 * periodic pruning. Others (creds, identity-key, app-state) must never
 * be deleted during normal operation.
 *
 * File types and their lifecycle:
 * - creds.json              — identity credentials, never delete (backed up as creds.json.bak)
 * - identity-key-*          — Signal identity keys, age-pruned when the contact is not protected
 * - app-state-sync-*        — WhatsApp app state, never delete
 * - device-list-*           — known device lists, never delete
 * - session-*.json          — Signal sessions, age-pruned when the contact is not protected
 * - sender-key-*            — group encryption keys, delete on corruption or age
 * - lid-mapping-*           — LID lookup cache, safe to prune old ones
 * - pre-key-*               — Signal pre-keys, managed by Baileys only (deleted
 *                             on consumption). Never prune: a pre-key file may be
 *                             needed to decrypt a message queued while offline.
 *
 * Sessions/identity-keys are safe to delete: Baileys re-establishes them via
 * pre-key exchange on the next message. creds.json is the only file whose loss
 * forces a QR re-scan.
 */

import {
  readdirSync,
  statSync,
  unlinkSync,
  existsSync,
  copyFileSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { log } from "../utils/logger";

const LID_MAPPING_PREFIX = "lid-mapping-";
const SENDER_KEY_PREFIX = "sender-key-";
const PRE_KEY_PREFIX = "pre-key-";
const SESSION_PREFIX = "session-";
const IDENTITY_KEY_PREFIX = "identity-key-";
const APP_STATE_SYNC_PREFIX = "app-state-sync-";
const DEVICE_LIST_PREFIX = "device-list-";
const CREDS_FILE = "creds.json";
const CREDS_BACKUP_FILE = "creds.json.bak";
const LAST_CONNECT_MARKER = ".last-connect";

/** Default: prune lid-mapping files older than 7 days. */
const DEFAULT_LID_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const DAY_MS = 86_400_000;

export interface AuthStats {
  total: number;
  byType: Record<string, number>;
}

export interface CleanupResult {
  deleted: number;
  errors: number;
}

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

function classifyAuthFile(filename: string): string {
  if (filename === CREDS_FILE) return "creds";
  if (filename.startsWith(LID_MAPPING_PREFIX)) return "lid-mapping";
  if (filename.startsWith(SENDER_KEY_PREFIX)) return "sender-key";
  if (filename.startsWith(PRE_KEY_PREFIX)) return "pre-key";
  if (filename.startsWith(SESSION_PREFIX)) return "session";
  if (filename.startsWith(IDENTITY_KEY_PREFIX)) return "identity-key";
  if (filename.startsWith(APP_STATE_SYNC_PREFIX)) return "app-state-sync";
  if (filename.startsWith(DEVICE_LIST_PREFIX)) return "device-list";
  return "other";
}

/**
 * Age-prune files matching any of the given prefixes.
 *
 * extractKey maps a filename to its protection key (numeric JID, group JID);
 * null means "can't parse — keep". Files whose key is in protectedKeys are
 * skipped without being stat'ed — an unreadable protected file is not an
 * error. Omit extractKey to prune all prefix matches unconditionally.
 */
function pruneFiles(
  authDir: string,
  prefixes: string[],
  extractKey: ((filename: string) => string | null) | undefined,
  protectedKeys: ReadonlySet<string> | undefined,
  maxAgeMs: number,
): CleanupResult {
  let deleted = 0;
  let errors = 0;

  if (!existsSync(authDir)) {
    return { deleted, errors };
  }

  const now = Date.now();
  for (const file of readdirSync(authDir)) {
    if (!prefixes.some((prefix) => file.startsWith(prefix))) continue;
    if (extractKey) {
      const key = extractKey(file);
      if (key === null || protectedKeys?.has(key)) continue;
    }
    const filePath = join(authDir, file);
    try {
      if (now - statSync(filePath).mtimeMs > maxAgeMs) {
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
 * Delete lid-mapping files older than maxAgeMs.
 *
 * LID mappings are reverse-lookup caches that Baileys recreates on demand.
 * Old mappings for contacts no longer in any shared group are pure bloat.
 */
export function pruneStaleLidMappings(
  authDir: string,
  maxAgeMs: number = DEFAULT_LID_MAX_AGE_MS,
): CleanupResult {
  return pruneFiles(
    authDir,
    [LID_MAPPING_PREFIX],
    undefined,
    undefined,
    maxAgeMs,
  );
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
  const numericPart = jid.replace(/@.*/, "");

  for (const file of files) {
    if (!file.startsWith(SENDER_KEY_PREFIX)) continue;
    if (!file.includes(numericPart)) continue;

    try {
      unlinkSync(join(authDir, file));
      log.info("WhatsApp", `Auto-deleted corrupted sender-key: ${file}`);
      return true;
    } catch (err) {
      // ENOENT: deleted by another process — not an error
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        log.warn(
          "WhatsApp",
          `Failed to delete corrupted sender-key: ${file}`,
          err,
        );
      }
    }
  }

  return false;
}

/**
 * Copy creds.json to creds.json.bak.
 *
 * Baileys writes creds.json non-atomically (no tmp+rename) — a crash
 * mid-write corrupts it and forces a QR re-scan. The backup restores the
 * last known-good identity so a corrupt write doesn't end the session.
 */
export function backupCreds(authDir: string): boolean {
  try {
    const src = join(authDir, CREDS_FILE);
    if (!existsSync(src)) return false;
    copyFileSync(src, join(authDir, CREDS_BACKUP_FILE));
    return true;
  } catch {
    return false;
  }
}

export function restoreCredsBackup(authDir: string): boolean {
  try {
    const src = join(authDir, CREDS_BACKUP_FILE);
    if (!existsSync(src)) return false;
    copyFileSync(src, join(authDir, CREDS_FILE));
    return true;
  } catch {
    return false;
  }
}

/**
 * Check whether creds.json holds a usable identity.
 * Usable = parses as JSON and carries me.id + signedIdentityKey.
 */
export function isCredsUsable(authDir: string): boolean {
  try {
    const raw = readFileSync(join(authDir, CREDS_FILE), "utf-8");
    const creds = JSON.parse(raw) as {
      me?: { id?: unknown };
      signedIdentityKey?: unknown;
    };
    return Boolean(creds.me?.id) && Boolean(creds.signedIdentityKey);
  } catch {
    return false;
  }
}

/**
 * When the bot was last successfully connected, in ms since epoch.
 *
 * The marker file is written on every successful "open". creds.json mtime is
 * NOT a usable proxy — Baileys rewrites creds.json on every connect, so a bot
 * restarted multiple times in one day always looks "recent" even when its
 * sessions are weeks old. Returns null when the marker is missing (first run
 * after this feature, or marker lost) — the caller treats that as "unknown
 * staleness" and purges if creds exist.
 */
export function getLastConnect(authDir: string): number | null {
  try {
    return statSync(join(authDir, LAST_CONNECT_MARKER)).mtimeMs;
  } catch {
    return null;
  }
}

/** Call on every successful "open". */
export function writeLastConnect(authDir: string): void {
  try {
    const markerPath = join(authDir, LAST_CONNECT_MARKER);
    writeFileSync(markerPath, String(Date.now()), "utf-8");
  } catch {
    // Marker write failure is not fatal — next connect falls back to purge.
  }
}

/**
 * Whether stale signal state should be purged before connecting.
 *
 * True when the bot has an identity (creds.json) but no recorded connection
 * within purgeAfterDays — either the marker is missing (unknown age) or old
 * (genuine long downtime). Fresh installs (no creds) return false.
 */
export function shouldPurgeSignalState(
  authDir: string,
  purgeAfterDays: number,
): boolean {
  if (!isCredsUsable(authDir)) return false;
  const lastConnect = getLastConnect(authDir);
  if (lastConnect === null) return true;
  return Date.now() - lastConnect > purgeAfterDays * DAY_MS;
}

/**
 * Delete all Signal session, sender-key, and identity-key files.
 *
 * Surgical badSession recovery: these files re-establish automatically via
 * pre-key exchange, while creds.json (the identity) is kept — no QR re-scan.
 */
export function resetSignalState(authDir: string): CleanupResult {
  let deleted = 0;
  let errors = 0;

  if (!existsSync(authDir)) {
    return { deleted, errors };
  }

  for (const file of readdirSync(authDir)) {
    if (
      !file.startsWith(SESSION_PREFIX) &&
      !file.startsWith(SENDER_KEY_PREFIX) &&
      !file.startsWith(IDENTITY_KEY_PREFIX)
    ) {
      continue;
    }
    try {
      unlinkSync(join(authDir, file));
      deleted++;
    } catch {
      errors++;
    }
  }

  return { deleted, errors };
}

/**
 * Age-prune session/identity/sender-key files.
 *
 * Sessions and identity-keys are matched by the numeric part before "_"
 * (LID or PN) and kept when it is in protectedJids. Sender-keys are matched
 * by group JID (part before "--") and kept when it is in protectedGroups.
 * Files that don't match the expected shapes are kept — never delete what
 * can't be parsed. creds, pre-keys, lid-mapping, device-list and app-state
 * are never touched.
 */
export function pruneStaleSignalState(
  authDir: string,
  protectedJids: Set<string>,
  protectedGroups: Set<string>,
  maxAgeMs: number,
): CleanupResult {
  const sessions = pruneStaleSessionsAndIdentities(
    authDir,
    protectedJids,
    maxAgeMs,
  );
  const senderKeys = pruneStaleSenderKeys(authDir, protectedGroups, maxAgeMs);
  return {
    deleted: sessions.deleted + senderKeys.deleted,
    errors: sessions.errors + senderKeys.errors,
  };
}

/**
 * Age-prune sender-key files, keeping keys for protected groups.
 * Used standalone when group participants can't be fetched (degraded mode).
 */
export function pruneStaleSenderKeys(
  authDir: string,
  protectedGroups: Set<string>,
  maxAgeMs: number,
): CleanupResult {
  return pruneFiles(
    authDir,
    [SENDER_KEY_PREFIX],
    extractSenderKeyGroupJid,
    protectedGroups,
    maxAgeMs,
  );
}

function pruneStaleSessionsAndIdentities(
  authDir: string,
  protectedJids: Set<string>,
  maxAgeMs: number,
): CleanupResult {
  return pruneFiles(
    authDir,
    [SESSION_PREFIX, IDENTITY_KEY_PREFIX],
    extractNumericJid,
    protectedJids,
    maxAgeMs,
  );
}

/**
 * "session-62812345678_1.json" → "62812345678"; null when the part before
 * "_" isn't purely numeric (e.g. legacy names without a device index).
 */
function extractNumericJid(filename: string): string | null {
  const prefix = filename.startsWith(SESSION_PREFIX)
    ? SESSION_PREFIX
    : IDENTITY_KEY_PREFIX;
  const rest = filename.slice(prefix.length);
  const numeric = rest.split("_")[0];
  return /^\d+$/.test(numeric) ? numeric : null;
}

/** "sender-key-120363238771337472@g.us--1234_1--0.json" → group JID before
 * "--"; null when the filename has no "--" separator (legacy format).
 */
function extractSenderKeyGroupJid(filename: string): string | null {
  const rest = filename.slice(SENDER_KEY_PREFIX.length);
  const separator = rest.indexOf("--");
  if (separator === -1) return null;
  const groupJid = rest.slice(0, separator);
  return groupJid.length > 0 ? groupJid : null;
}

/**
 * Resolve PN JIDs to their LID forms using the forward lid-mapping cache.
 *
 * Session/identity-key files are keyed by LID after migration, while config
 * admins are PNs. The mapping files are pruned at 7 days, so this is
 * best-effort — unmatched PNs fall back to participants protection.
 * Returns the numeric forms of both the input PNs and any resolved LIDs.
 */
export function resolveProtectedLids(authDir: string, pns: string[]): string[] {
  const result: string[] = [];
  for (const pn of pns) {
    const numeric = pn.replace(/@.*/, "");
    if (!numeric) continue;
    result.push(numeric);
    try {
      const raw = readFileSync(
        join(authDir, `${LID_MAPPING_PREFIX}${numeric}.json`),
        "utf-8",
      );
      const lid = JSON.parse(raw);
      // Mapping files store bare digits today; tolerate @lid-suffixed values
      // in case a Baileys version starts persisting the full JID form.
      const numericLid = typeof lid === "string" ? lid.replace(/@.*/, "") : "";
      if (/^\d+$/.test(numericLid)) {
        result.push(numericLid);
      }
    } catch {
      // Mapping pruned or not yet created — participants protection covers it
    }
  }
  return result;
}

/**
 * Run all startup cleanup tasks and log auth directory health.
 *
 * Call this once during connect(), before useMultiFileAuthState().
 * Sockets are not up here, so sessions/sender-keys are NOT pruned — active
 * group members can't be distinguished from stale ones yet.
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

  if (isCredsUsable(authDir) && backupCreds(authDir)) {
    log.info("WhatsApp", "Backed up creds.json");
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
