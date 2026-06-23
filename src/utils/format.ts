/**
 * Pure string formatting utilities.
 *
 * No domain logic — only string manipulation.
 * Used by both reports/format and whatsapp/client.
 */

// ============================================================
// Message splitting
// ============================================================

/**
 * Split a message into parts that fit within maxLength.
 * Splits at newline boundaries and adds "Part X/Y" markers.
 *
 * Uses a two-pass approach:
 * 1. Split content into chunks that fit (maxLength - markerOverhead)
 * 2. Prepend "Part X/Y\n" markers
 *
 * The marker overhead is estimated at 20 chars (covers "Part XX/XX\n").
 */
export function splitMessage(text: string, maxLength: number, splitAtNewline = true): string[] {
  const FIXED_MARKER_OVERHEAD = 20;
  if (text.length <= maxLength) {
    return [text];
  }

  if (!splitAtNewline) {
    const parts: string[] = [];
    let remaining = text;
    while (remaining.length > maxLength) {
      const markerLen = `Part ${Math.ceil(remaining.length / maxLength) + 1}/${Math.ceil(remaining.length / maxLength)}\n`.length;
      const effectiveMax = Math.max(1, maxLength - markerLen);
      parts.push(remaining.slice(0, effectiveMax));
      remaining = remaining.slice(effectiveMax);
    }
    if (remaining) parts.push(remaining);
    return parts.map((part, i) => `Part ${i + 1}/${parts.length}\n${part}`);
  }

  const lines = text.split('\n');
  const parts: string[] = [];
  let current = '';

  for (const line of lines) {
    const candidate = current ? current + '\n' + line : line;

    const effectiveMax = Math.max(1, maxLength - FIXED_MARKER_OVERHEAD);

    if (candidate.length <= effectiveMax) {
      current = candidate;
    } else {
      if (current) {
        parts.push(current);
      }
      if (line.length > effectiveMax) {
        let remaining = line;
        while (remaining.length > effectiveMax) {
          parts.push(remaining.slice(0, effectiveMax));
          remaining = remaining.slice(effectiveMax);
        }
        current = remaining;
      } else {
        current = line;
      }
    }
  }

  if (current) {
    parts.push(current);
  }

  if (parts.length === 0) {
    // Fallback: text was all newlines or couldn't be split — ensure maxLength
    if (text.length > maxLength) {
      return [text.slice(0, maxLength)];
    }
    return [text];
  }

  if (parts.length <= 1) {
    return parts;
  }

  // Final pass: compute exact markers now that we know total count
  return parts.map((part, i) => `Part ${i + 1}/${parts.length}\n${part}`);
}
