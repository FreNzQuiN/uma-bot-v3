/**
 * Command parser for WhatsApp messages.
 *
 * Parses incoming messages into structured commands with arguments.
 * Handles prefix matching, numeric offset extraction, and multi-word args.
 */

import type { ComputedMember } from '../types';

// ============================================================
// Types
// ============================================================

export interface ParsedCommand {
  command: string;
  args: string[];
  offset: number | null;
  raw: string;
}

// ============================================================
// Levenshtein distance helper
// ============================================================

function levenshteinDistance(a: string, b: string): number {
  const aLen = a.length;
  const bLen = b.length;

  if (aLen === 0) return bLen;
  if (bLen === 0) return aLen;

  // Use single-row DP for memory efficiency
  let prev = Array.from({ length: bLen + 1 }, (_, i) => i);
  let curr = new Array<number>(bLen + 1);

  for (let i = 1; i <= aLen; i++) {
    curr[0] = i;
    for (let j = 1; j <= bLen; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1,       // deletion
        curr[j - 1] + 1,   // insertion
        prev[j - 1] + cost  // substitution
      );
    }
    [prev, curr] = [curr, prev];
  }

  return prev[bLen];
}

// ============================================================
// parseCommand
// ============================================================

/**
 * Parse a message text into a structured command.
 *
 * Returns null if the message doesn't start with any configured prefix.
 * Always returns the raw message text in the `raw` field.
 *
 * Numeric args are parsed as offsets. Non-numeric args are collected as strings.
 */
export function parseCommand(text: string, prefixes: string[]): ParsedCommand | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  // Find matching prefix
  let matchedPrefix: string | null = null;
  for (const prefix of prefixes) {
    if (trimmed.startsWith(prefix)) {
      matchedPrefix = prefix;
      break;
    }
  }

  if (matchedPrefix === null) return null;

  // Strip prefix and split into tokens
  const afterPrefix = trimmed.slice(matchedPrefix.length).trim();
  if (!afterPrefix) return null;

  const tokens = afterPrefix.split(/\s+/);
  const command = tokens[0].toLowerCase();
  const args = tokens.slice(1);

  // Parse offset: first numeric arg
  let offset: number | null = null;
  if (args.length > 0) {
    const parsed = Number(args[0]);
    if (!isNaN(parsed) && args[0].trim() !== '') {
      offset = parsed;
    }
  }

  return {
    command,
    args,
    offset,
    raw: trimmed,
  };
}

// ============================================================
// resolveMemberName
// ============================================================

/**
 * Resolve a partial name to a unique member.
 *
 * Resolution order:
 * 1. Exact case-sensitive match
 * 2. Exact case-insensitive match
 * 3. Unique partial (prefix) match
 * 4. Fuzzy match (Levenshtein distance <= 2)
 * 5. Ambiguous → null (caller asks user to choose)
 */
export function resolveMemberName(
  partial: string,
  members: ComputedMember[]
): ComputedMember | null {
  if (!partial || !partial.trim() || members.length === 0) {
    return null;
  }

  const query = partial.trim();

  // 1. Exact case-sensitive match
  const exactMatch = members.find((m) => m.trainerName === query);
  if (exactMatch) return exactMatch;

  // 2. Exact case-insensitive match
  const lowerQuery = query.toLowerCase();
  const caseInsensitiveMatch = members.find(
    (m) => m.trainerName.toLowerCase() === lowerQuery
  );
  if (caseInsensitiveMatch) return caseInsensitiveMatch;

  // 3. Unique partial (prefix) match — case-insensitive
  const partialMatches = members.filter((m) =>
    m.trainerName.toLowerCase().startsWith(lowerQuery)
  );
  if (partialMatches.length === 1) return partialMatches[0];

  // 4. Fuzzy match (Levenshtein distance <= 2)
  const FUZZY_THRESHOLD = 2;
  const fuzzyMatches: Array<{ member: ComputedMember; distance: number }> = [];

  for (const member of members) {
    const name = member.trainerName.toLowerCase();
    // Check if query is within threshold of the full name
    const fullDist = levenshteinDistance(lowerQuery, name);
    if (fullDist <= FUZZY_THRESHOLD) {
      fuzzyMatches.push({ member, distance: fullDist });
      continue;
    }

    // Check individual words in the name
    const nameWords = name.split(/\s+/);
    for (const word of nameWords) {
      const wordDist = levenshteinDistance(lowerQuery, word);
      if (wordDist <= FUZZY_THRESHOLD) {
        fuzzyMatches.push({ member, distance: wordDist });
        break;
      }
    }
  }

  // Sort by distance, return best match if unique
  if (fuzzyMatches.length === 1) {
    return fuzzyMatches[0].member;
  }

  if (fuzzyMatches.length > 1) {
    // Return the closest match, but only if there's a clear winner
    fuzzyMatches.sort((a, b) => a.distance - b.distance);
    if (fuzzyMatches[0].distance < fuzzyMatches[1].distance) {
      return fuzzyMatches[0].member;
    }
    // Ambiguous
    return null;
  }

  // 5. No match at all
  return null;
}
