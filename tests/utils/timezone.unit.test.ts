import {
  getDataDate,
  getDataDateComponents,
  getDataDay,
  getDataMonth,
  getDataYear,
  formatForDisplay,
  formatDateWIB,
  INDONESIAN_MONTHS,
} from "../../src/utils/timezone";

describe("getDataDate", () => {
  it("returns 2026-06-12 for June 12 03:00 UTC (12:00 JST)", () => {
    // June 12 03:00 UTC = June 12 12:00 JST
    const date = new Date("2026-06-12T03:00:00Z");
    expect(getDataDate(date)).toBe("2026-06-12");
  });

  it("returns 2026-06-01 for June 1 14:00 UTC (23:00 JST)", () => {
    // June 1 14:00 UTC = June 1 23:00 JST
    const date = new Date("2026-06-01T14:00:00Z");
    expect(getDataDate(date)).toBe("2026-06-01");
  });

  it("returns 2026-06-01 for June 1 14:59 UTC (23:59 JST)", () => {
    // June 1 14:59 UTC = June 1 23:59 JST
    const date = new Date("2026-06-01T14:59:00Z");
    expect(getDataDate(date)).toBe("2026-06-01");
  });

  it("rolls to next JST day when UTC is before midnight but JST is after", () => {
    // Dec 31 15:00 UTC = Jan 1 00:00 JST (next day)
    const date = new Date("2025-12-31T15:00:00Z");
    expect(getDataDate(date)).toBe("2026-01-01");
  });

  it("pads single-digit month and day with leading zeros", () => {
    // Jan 5 03:00 UTC = Jan 5 12:00 JST
    const date = new Date("2026-01-05T03:00:00Z");
    expect(getDataDate(date)).toBe("2026-01-05");
  });
});

describe("getDataDateComponents", () => {
  it("returns correct components for a known date", () => {
    // June 12 03:00 UTC = June 12 12:00 JST
    const date = new Date("2026-06-12T03:00:00Z");
    const result = getDataDateComponents(date);
    expect(result).toEqual({ year: 2026, month: 6, day: 12 });
  });

  it("returns correct components at JST midnight", () => {
    // Dec 31 15:00 UTC = Jan 1 00:00 JST
    const date = new Date("2025-12-31T15:00:00Z");
    const result = getDataDateComponents(date);
    expect(result).toEqual({ year: 2026, month: 1, day: 1 });
  });
});

describe("getDataDay", () => {
  it("returns the day number in JST", () => {
    // June 12 03:00 UTC = June 12 12:00 JST
    const date = new Date("2026-06-12T03:00:00Z");
    expect(getDataDay(date)).toBe(12);
  });

  it("returns 1 for the first day of the month in JST", () => {
    // June 1 14:00 UTC = June 1 23:00 JST
    const date = new Date("2026-06-01T14:00:00Z");
    expect(getDataDay(date)).toBe(1);
  });
});

describe("getDataMonth", () => {
  it("returns the month number in JST", () => {
    // June 12 03:00 UTC = June 12 12:00 JST
    const date = new Date("2026-06-12T03:00:00Z");
    expect(getDataMonth(date)).toBe(6);
  });

  it("returns 12 for December in JST", () => {
    // Dec 25 03:00 UTC = Dec 25 12:00 JST
    const date = new Date("2026-12-25T03:00:00Z");
    expect(getDataMonth(date)).toBe(12);
  });
});

describe("getDataYear", () => {
  it("returns the year in JST", () => {
    // June 12 03:00 UTC = June 12 12:00 JST
    const date = new Date("2026-06-12T03:00:00Z");
    expect(getDataYear(date)).toBe(2026);
  });

  it("returns next year when JST crosses midnight on Dec 31", () => {
    // Dec 31 15:00 UTC = Jan 1 00:00 JST
    const date = new Date("2025-12-31T15:00:00Z");
    expect(getDataYear(date)).toBe(2026);
  });
});

describe("formatForDisplay", () => {
  it("formats a known date in Asia/Jakarta (WIB, UTC+7)", () => {
    // June 12 09:30 UTC = June 12 16:30 WIB
    const date = new Date("2026-06-12T09:30:00Z");
    expect(formatForDisplay(date, "Asia/Jakarta")).toBe("12/6 16:30");
  });

  it("formats with zero-padded hours and minutes", () => {
    // June 12 00:05 UTC = June 12 07:05 WIB
    const date = new Date("2026-06-12T00:05:00Z");
    expect(formatForDisplay(date, "Asia/Jakarta")).toBe("12/6 07:05");
  });

  it("shows 00 for midnight, not 24", () => {
    // June 12 17:00 UTC = June 13 00:00 WIB
    const date = new Date("2026-06-12T17:00:00Z");
    expect(formatForDisplay(date, "Asia/Jakarta")).toBe("13/6 00:00");
  });

  it("works with a different timezone (Asia/Tokyo)", () => {
    // June 12 03:00 UTC = June 12 12:00 JST
    const date = new Date("2026-06-12T03:00:00Z");
    expect(formatForDisplay(date, "Asia/Tokyo")).toBe("12/6 12:00");
  });
});

describe("formatDateWIB", () => {
  it('formats 2026-06-11 as "11 Juni 2026"', () => {
    expect(formatDateWIB("2026-06-11")).toBe("11 Juni 2026");
  });

  it('formats 2026-01-01 as "1 Januari 2026"', () => {
    expect(formatDateWIB("2026-01-01")).toBe("1 Januari 2026");
  });

  it('formats 2026-12-31 as "31 Desember 2026"', () => {
    expect(formatDateWIB("2026-12-31")).toBe("31 Desember 2026");
  });

  it("formats mid-year date correctly", () => {
    expect(formatDateWIB("2026-07-04")).toBe("4 Juli 2026");
  });
});

describe("INDONESIAN_MONTHS", () => {
  it("has length of 12", () => {
    expect(INDONESIAN_MONTHS).toHaveLength(12);
  });

  it("starts with Januari and ends with Desember", () => {
    expect(INDONESIAN_MONTHS[0]).toBe("Januari");
    expect(INDONESIAN_MONTHS[11]).toBe("Desember");
  });

  it("contains all expected month names in order", () => {
    expect(INDONESIAN_MONTHS).toEqual([
      "Januari",
      "Februari",
      "Maret",
      "April",
      "Mei",
      "Juni",
      "Juli",
      "Agustus",
      "September",
      "Oktober",
      "November",
      "Desember",
    ]);
  });
});
