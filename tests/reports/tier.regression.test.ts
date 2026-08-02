import type { Snapshot } from "../../src/types";
import { computeTierData } from "../../src/data/daily-fans";
import { loadRealSnapshot } from "../_helpers";

const realSnapshot: Snapshot = loadRealSnapshot();

describe("Bug 3: Tier projectedOutcome for max-tier clubs", () => {
  it("max-tier club with low demotion buffer should show demotion_risk, not stay", () => {
    // Create a snapshot where:
    // - club_rank = 11 (SS tier, highest) → fans_to_next_tier = 0
    // - fans_to_lower_tier is very small (low buffer)
    // - current pace is high enough that buffer < 3 days → HIGH risk
    const snapshot: Snapshot = {
      ...realSnapshot,
      club_rank: 11, // SS tier — max tier, fans_to_next_tier = 0
      fans_to_next_tier: 0, // Already at top
      fans_to_lower_tier: 100000, // Small buffer
      circle: {
        ...realSnapshot.circle,
        monthly_point: 500000000, // High total fans
      },
      members: realSnapshot.members.map((m) => ({
        ...m,
        daily_fans: (() => {
          // Create high daily gains to make currentPace large
          // so that bufferDays = fans_to_lower_tier / currentPace < 3
          const fans = new Array(32).fill(0);
          fans[0] = 100000000;
          for (let i = 1; i < 12; i++) {
            fans[i] = 100000000 * (i + 1);
          }
          return fans;
        })(),
      })),
    };

    const tierData = computeTierData(snapshot);

    // With low buffer and high pace, risk should be HIGH
    // projectedOutcome should be demotion_risk, NOT stay
    expect(tierData.riskLevel).toBe("HIGH");
    expect(tierData.projectedOutcome).toBe("demotion_risk");
  });

  it("max-tier club with high buffer shows LOW risk and stay", () => {
    // club_rank = 11, fans_to_next_tier = 0, large buffer
    const snapshot: Snapshot = {
      ...realSnapshot,
      club_rank: 11,
      fans_to_next_tier: 0,
      fans_to_lower_tier: 100000000, // Huge buffer
      circle: {
        ...realSnapshot.circle,
        monthly_point: 1000000,
      },
      members: realSnapshot.members.map((m) => ({
        ...m,
        daily_fans: (() => {
          const fans = new Array(32).fill(0);
          fans[0] = 10000;
          for (let i = 1; i < 12; i++) {
            fans[i] = 10000 * (i + 1);
          }
          return fans;
        })(),
      })),
    };

    const tierData = computeTierData(snapshot);

    // Large buffer with low pace → bufferDays >= 7 → LOW risk → stay
    expect(tierData.riskLevel).toBe("LOW");
    expect(tierData.projectedOutcome).toBe("stay");
  });
});
