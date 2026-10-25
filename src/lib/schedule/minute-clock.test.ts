import { describe, expect, it, vi } from "vitest";
import {
  MINUTE_CLOCK_INTERVAL_MS,
  subscribeToMinuteClock,
  type MinuteClockSource,
} from "./minute-clock";

describe("minute clock refresh subscription", () => {
  it("keeps polling and immediately refreshes when a background tab becomes visible", () => {
    let visibilityListener: (() => void) | undefined;
    let pageShowListener: (() => void) | undefined;
    let visible = false;
    const tick = vi.fn();
    const cancel = vi.fn();
    const unsubscribeVisibility = vi.fn(() => { visibilityListener = undefined; });
    const unsubscribePageShow = vi.fn(() => { pageShowListener = undefined; });
    const source: MinuteClockSource = {
      schedule: vi.fn((_callback, delayMs) => {
        expect(delayMs).toBe(MINUTE_CLOCK_INTERVAL_MS);
        return 17;
      }),
      cancel,
      visible: () => visible,
      onVisibilityChange: (callback) => {
        visibilityListener = callback;
        return unsubscribeVisibility;
      },
      onPageShow: (callback) => {
        pageShowListener = callback;
        return unsubscribePageShow;
      },
    };

    const unsubscribe = subscribeToMinuteClock(tick, source);
    expect(tick).not.toHaveBeenCalled();

    visibilityListener?.();
    expect(tick).not.toHaveBeenCalled();

    visible = true;
    visibilityListener?.();
    expect(tick).toHaveBeenCalledTimes(1);

    pageShowListener?.();
    expect(tick).toHaveBeenCalledTimes(2);

    unsubscribe();
    expect(cancel).toHaveBeenCalledWith(17);
    expect(unsubscribeVisibility).toHaveBeenCalledOnce();
    expect(unsubscribePageShow).toHaveBeenCalledOnce();
    expect(visibilityListener).toBeUndefined();
    expect(pageShowListener).toBeUndefined();
  });
});
