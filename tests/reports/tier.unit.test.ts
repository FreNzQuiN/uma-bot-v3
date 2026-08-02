import { Snapshot, BotConfig } from "../../src/types";
import { getDefaultConfig } from "../../src/config";
import { computeMembers } from "../../src/reports/compute";
import { generateTierReport } from "../../src/reports/tier";
import { loadRealSnapshot, WHATSAPP_MAX_LENGTH } from "../_helpers";

const snapshot: Snapshot = loadRealSnapshot();
const config: BotConfig = getDefaultConfig();

describe("E2E: Tier Report", () => {
  let report: string;

  beforeAll(() => {
    report = generateTierReport(
      snapshot,
      config,
      computeMembers(snapshot, config),
    );
  });

  it("starts with Tier Intelligence header", () => {
    expect(report).toMatch(/🏆 \*Tier Intelligence/);
  });

  it("contains tier name", () => {
    expect(report).toContain("A+");
  });

  it("contains promotion gap", () => {
    expect(report).toMatch(/Promosi: [\d.,]+[KMB]/);
  });

  it("contains demotion buffer", () => {
    expect(report).toMatch(/Degradasi: buffer [\d.,]+[KMB]/);
  });

  it("contains current pace", () => {
    expect(report).toMatch(/Pace saat ini: [\d.,]+[KMB]\/hari/);
  });

  it("contains required pace", () => {
    expect(report).toMatch(/Pace butuh: [\d.,]+[KMB]\/hari/);
  });

  it("contains days left", () => {
    expect(report).toMatch(/Sisa hari: \d+/);
  });

  it("contains projection with emoji", () => {
    expect(report).toMatch(/Proyeksi: .+/);
  });

  it("uses WhatsApp formatting (no Markdown bold)", () => {
    expect(report).not.toMatch(/\*\*[^*]+\*\*/);
  });

  it("does not exceed WhatsApp message limit", () => {
    expect(report.length).toBeLessThanOrEqual(WHATSAPP_MAX_LENGTH);
  });
});
