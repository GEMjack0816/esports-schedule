export const MINUTE_CLOCK_INTERVAL_MS = 60_000;

export type MinuteClockSource = {
  schedule: (callback: () => void, delayMs: number) => number;
  cancel: (handle: number) => void;
  visible: () => boolean;
  onVisibilityChange: (callback: () => void) => () => void;
  onPageShow: (callback: () => void) => () => void;
};

const browserClockSource: MinuteClockSource = {
  schedule: (callback, delayMs) => window.setInterval(callback, delayMs),
  cancel: (handle) => window.clearInterval(handle),
  visible: () => document.visibilityState === "visible",
  onVisibilityChange: (callback) => {
    document.addEventListener("visibilitychange", callback);
    return () => document.removeEventListener("visibilitychange", callback);
  },
  onPageShow: (callback) => {
    window.addEventListener("pageshow", callback);
    return () => window.removeEventListener("pageshow", callback);
  },
};

/** Keep time-based schedule metrics current after background-tab or BFCache suspension. */
export function subscribeToMinuteClock(
  tick: () => void,
  source: MinuteClockSource = browserClockSource,
): () => void {
  const interval = source.schedule(tick, MINUTE_CLOCK_INTERVAL_MS);
  const refreshWhenVisible = () => {
    if (source.visible()) tick();
  };
  const unsubscribeVisibility = source.onVisibilityChange(refreshWhenVisible);
  const unsubscribePageShow = source.onPageShow(tick);

  return () => {
    source.cancel(interval);
    unsubscribeVisibility();
    unsubscribePageShow();
  };
}
