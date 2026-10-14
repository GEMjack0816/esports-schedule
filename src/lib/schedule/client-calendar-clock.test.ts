import { afterEach, describe, expect, it, vi } from "vitest";
import {
  calendarClockSnapshot,
  millisecondsUntilNextMinute,
  parseCalendarClockSnapshot,
  serverCalendarClockSnapshot,
  subscribeCalendarClock,
} from "./client-calendar-clock";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("client calendar clock", () => {
  it("keeps a stable snapshot within one minute and advances at the boundary", () => {
    expect(calendarClockSnapshot("Asia/Shanghai", 60_001)).toBe("Asia/Shanghai|1");
    expect(calendarClockSnapshot("Asia/Shanghai", 119_999)).toBe("Asia/Shanghai|1");
    expect(calendarClockSnapshot("Asia/Shanghai", 120_000)).toBe("Asia/Shanghai|2");
  });

  it("round-trips the visitor time zone and minute timestamp", () => {
    expect(parseCalendarClockSnapshot("America/Los_Angeles|42")).toEqual({
      timeZone: "America/Los_Angeles",
      now: 2_520_000,
    });
  });

  it("keeps the server and hydration snapshot stable across a minute boundary", () => {
    vi.useFakeTimers();
    const generatedAt = "2026-09-27T23:59:59.999Z";
    vi.setSystemTime(new Date(generatedAt));
    const serverSnapshot = serverCalendarClockSnapshot(generatedAt);

    vi.setSystemTime(new Date("2026-09-28T00:00:00.001Z"));
    expect(serverCalendarClockSnapshot(generatedAt)).toBe(serverSnapshot);
    expect(serverSnapshot).toBe(`UTC|${Math.floor(Date.parse(generatedAt) / 60_000)}`);
  });

  it("uses a deterministic valid snapshot if serialized generation time is invalid", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-27T23:59:59.999Z"));
    const first = serverCalendarClockSnapshot("not-a-timestamp");

    vi.setSystemTime(new Date("2026-09-28T00:00:00.001Z"));
    expect(serverCalendarClockSnapshot("not-a-timestamp")).toBe(first);
    expect(first).toBe("UTC|0");
  });

  it("schedules just after the next minute boundary", () => {
    expect(millisecondsUntilNextMinute(60_000)).toBe(60_025);
    expect(millisecondsUntilNextMinute(119_999)).toBe(26);
  });

  it("notifies at minute rollover and when a visible tab regains focus", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(119_999));
    const browserWindow = new EventTarget();
    const browserDocument = new EventTarget();
    Object.defineProperty(browserDocument, "visibilityState", { configurable: true, value: "visible" });
    vi.stubGlobal("window", browserWindow);
    vi.stubGlobal("document", browserDocument);
    const listener = vi.fn();
    const unsubscribe = subscribeCalendarClock(listener);

    await vi.advanceTimersByTimeAsync(26);
    expect(listener).toHaveBeenCalledTimes(1);
    browserWindow.dispatchEvent(new Event("focus"));
    browserDocument.dispatchEvent(new Event("visibilitychange"));
    expect(listener).toHaveBeenCalledTimes(3);

    unsubscribe();
    await vi.advanceTimersByTimeAsync(60_025);
    expect(listener).toHaveBeenCalledTimes(3);
  });
});
