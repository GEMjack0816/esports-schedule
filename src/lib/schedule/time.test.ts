import { describe, expect, it } from "vitest";
import { dateInputBound } from "./time";

describe("local date picker bounds", () => {
  it("includes the following local day east of UTC", () => {
    expect(dateInputBound("2026-09-02T23:30:00.000Z", "Asia/Shanghai")).toBe("2026-09-03");
  });
  it("includes the previous local day west of UTC", () => {
    expect(dateInputBound("2026-09-01T01:30:00.000Z", "America/Los_Angeles")).toBe("2026-08-31");
  });
  it("leaves UTC calendar bounds unchanged", () => {
    expect(dateInputBound("2026-09-01T01:30:00.000Z", "UTC")).toBe("2026-09-01");
  });
  it("uses the actual offset during daylight saving changes", () => {
    expect(dateInputBound("2026-03-09T04:30:00.000Z", "America/New_York")).toBe("2026-03-09");
    expect(dateInputBound("2026-11-02T04:30:00.000Z", "America/New_York")).toBe("2026-11-01");
  });
  it.each([null, undefined, "", "invalid"])("does not constrain a missing/invalid bound (%s)", value => {
    expect(dateInputBound(value, "UTC")).toBeUndefined();
  });
});
