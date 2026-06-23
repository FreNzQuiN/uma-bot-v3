import { splitMessage } from '../../src/reports/format';

describe('Bug 1: splitMessage Part marker overhead', () => {
  const MAX_LENGTH = 4096;

  it('all parts including Part X/Y markers must be ≤ maxLength', () => {
    // Create a message that will need splitting
    const lines = Array.from({ length: 200 }, (_, i) => `Line ${i}: ${'x'.repeat(30)}`);
    const longMessage = lines.join('\n');

    const parts = splitMessage(longMessage, MAX_LENGTH);

    // Every part must respect maxLength
    for (const part of parts) {
      expect(part.length).toBeLessThanOrEqual(MAX_LENGTH);
    }
  });

  it('parts with markers at small maxLength are still within limit', () => {
    // Use a small maxLength to make the bug more obvious
    const lines = Array.from({ length: 50 }, (_, i) => `Line ${i}`);
    const longMessage = lines.join('\n');
    const smallMax = 80;

    const parts = splitMessage(longMessage, smallMax);

    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) {
      expect(part.length).toBeLessThanOrEqual(smallMax);
    }
  });

  it('single-line parts with markers respect maxLength', () => {
    // Create a message with lines just under maxLength
    const line = 'x'.repeat(100);
    const lines = Array.from({ length: 50 }, () => line);
    const longMessage = lines.join('\n');
    const maxLen = 120;

    const parts = splitMessage(longMessage, maxLen);

    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) {
      expect(part.length).toBeLessThanOrEqual(maxLen);
    }
  });

  it('force-split long lines also respect maxLength with markers', () => {
    // A single line that exceeds maxLength should be force-split
    const longLine = 'x'.repeat(200);
    const maxLen = 50;

    const parts = splitMessage(longLine, maxLen);

    for (const part of parts) {
      expect(part.length).toBeLessThanOrEqual(maxLen);
    }
  });

  it('real-world report content respects maxLength after splitting', () => {
    // Simulate a very long report
    const reportHeader = '📊 Daily Report — 12 Juni 2026\n\nHol＿Horse | A+ (#431)\n';
    const memberLines = Array.from(
      { length: 40 },
      (_, i) => `${i + 1}. Member${i} — +${(100 - i) * 100000}`
    ).join('\n');
    const report = reportHeader + memberLines;

    if (report.length > MAX_LENGTH) {
      const parts = splitMessage(report, MAX_LENGTH);
      for (const part of parts) {
        expect(part.length).toBeLessThanOrEqual(MAX_LENGTH);
      }
    }
  });
});
