import { describe, expect, it, vi } from "vitest";
import { saveThemePreference } from "./theme-preference";

describe("saveThemePreference", () => {
  it("persists the selected theme before notifying subscribers", () => {
    const calls: string[] = [];
    const setItem = vi.fn((key: string, value: string) => calls.push(`${key}:${value}`));
    const notify = vi.fn(() => calls.push("notify"));

    saveThemePreference("light", () => ({ setItem }), notify);

    expect(setItem).toHaveBeenCalledWith("schedule-theme", "light");
    expect(calls).toEqual(["schedule-theme:light", "notify"]);
  });

  it("still notifies subscribers when storage rejects writes", () => {
    const notify = vi.fn();

    expect(() => saveThemePreference(
      "light",
      () => ({ setItem: () => { throw new DOMException("Blocked", "SecurityError"); } }),
      notify,
    )).not.toThrow();

    expect(notify).toHaveBeenCalledOnce();
  });

  it("still notifies subscribers when accessing storage throws", () => {
    const notify = vi.fn();

    expect(() => saveThemePreference(
      "dark",
      () => { throw new DOMException("Blocked", "SecurityError"); },
      notify,
    )).not.toThrow();

    expect(notify).toHaveBeenCalledOnce();
  });
});
