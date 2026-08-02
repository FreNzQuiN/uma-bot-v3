/**
 * Tests for isTransferMember.
 *
 * Split from tests/data/daily-fans.unit.test.ts
 */

import { isTransferMember } from "../../src/data/daily-fans";
import { RYU_DAILY_FANS, ZERO_DAILY_FANS } from "./daily-fans.fixtures";

describe("isTransferMember", () => {
  it("returns true when previous_circle_id is set", () => {
    expect(
      isTransferMember({
        daily_fans: RYU_DAILY_FANS,
        previous_circle_id: 555894304,
        previous_circle_name: "Advent",
      }),
    ).toBe(true);
  });

  it("returns true when previous_circle_name is set", () => {
    expect(
      isTransferMember({
        daily_fans: RYU_DAILY_FANS,
        previous_circle_name: "SomeClub",
      }),
    ).toBe(true);
  });

  it("returns true when daily_fans[0] is negative", () => {
    expect(
      isTransferMember({
        daily_fans: [
          -100, 200, 300, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
          0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        ],
      }),
    ).toBe(true);
  });

  it("returns true for Zero (both previous info and negative daily_fans)", () => {
    expect(
      isTransferMember({
        daily_fans: ZERO_DAILY_FANS,
        previous_circle_id: 555894304,
        previous_circle_name: "Advent",
      }),
    ).toBe(true);
  });

  it("returns false for Ryu (no previous info, positive daily_fans)", () => {
    expect(
      isTransferMember({
        daily_fans: RYU_DAILY_FANS,
      }),
    ).toBe(false);
  });

  it("returns false for all-positive daily_fans with no previous info", () => {
    expect(
      isTransferMember({
        daily_fans: [
          100, 200, 300, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
          0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        ],
      }),
    ).toBe(false);
  });

  it("returns false for all-zero daily_fans with no previous info", () => {
    expect(
      isTransferMember({
        daily_fans: new Array(32).fill(0),
      }),
    ).toBe(false);
  });

  it("returns false for empty daily_fans with no previous info", () => {
    expect(
      isTransferMember({
        daily_fans: [],
      }),
    ).toBe(false);
  });
});
