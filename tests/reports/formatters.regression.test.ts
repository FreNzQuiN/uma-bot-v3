import { splitMessage } from "../../src/utils/format";

describe("splitMessage Part marker overhead", () => {
  const MAX_LENGTH = 4096;

  it("all parts including Part X/Y markers must be ≤ maxLength", () => {
    const lines = Array.from(
      { length: 200 },
      (_, i) => `Line ${i}: ${"x".repeat(30)}`,
    );
    const longMessage = lines.join("\n");

    const parts = splitMessage(longMessage, MAX_LENGTH);

    for (const part of parts) {
      expect(part.length).toBeLessThanOrEqual(MAX_LENGTH);
    }
  });

  it("parts with markers at small maxLength are still within limit", () => {
    // Use a small maxLength to make the bug more obvious
    const lines = Array.from({ length: 50 }, (_, i) => `Line ${i}`);
    const longMessage = lines.join("\n");
    const smallMax = 80;

    const parts = splitMessage(longMessage, smallMax);

    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) {
      expect(part.length).toBeLessThanOrEqual(smallMax);
    }
  });

  it("single-line parts with markers respect maxLength", () => {
    // Lines just under maxLength so the Part marker pushes each part over
    const line = "x".repeat(100);
    const lines = Array.from({ length: 50 }, () => line);
    const longMessage = lines.join("\n");
    const maxLen = 120;

    const parts = splitMessage(longMessage, maxLen);

    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) {
      expect(part.length).toBeLessThanOrEqual(maxLen);
    }
  });

  it("force-split long lines also respect maxLength with markers", () => {
    const longLine = "x".repeat(200);
    const maxLen = 50;

    const parts = splitMessage(longLine, maxLen);

    for (const part of parts) {
      expect(part.length).toBeLessThanOrEqual(maxLen);
    }
  });

  it("real-world report content respects maxLength after splitting", () => {
    const reportHeader =
      "📊 Daily Report — 12 Juni 2026\n\nHol＿Horse | A+ (#431)\n";
    const memberLines = Array.from(
      { length: 40 },
      (_, i) => `${i + 1}. Member${i} — +${(100 - i) * 100000}`,
    ).join("\n");
    const report = reportHeader + memberLines;

    const smallMax = 800;
    if (report.length > smallMax) {
      const parts = splitMessage(report, smallMax);
      for (const part of parts) {
        expect(part.length).toBeLessThanOrEqual(smallMax);
      }
    }
  });
});
