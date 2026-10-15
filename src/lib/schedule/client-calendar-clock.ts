const MINUTE_MS = 60_000;
const TIMER_SLOP_MS = 25;
const SNAPSHOT_SEPARATOR = "|";

export function calendarClockSnapshot(timeZone: string, now = Date.now()): string {
  return `${timeZone}${SNAPSHOT_SEPARATOR}${Math.floor(now / MINUTE_MS)}`;
}

export function serverCalendarClockSnapshot(generatedAt: string): string {
  const timestamp = Date.parse(generatedAt);
  const stableNow = Number.isFinite(timestamp) && timestamp >= 0 ? timestamp : 0;
  return calendarClockSnapshot("UTC", stableNow);
}

export function parseCalendarClockSnapshot(snapshot: string): { timeZone: string; now: number } {
  const separator = snapshot.lastIndexOf(SNAPSHOT_SEPARATOR);
  const timeZone = separator > 0 ? snapshot.slice(0, separator) : "UTC";
  const minute = Number(snapshot.slice(separator + 1));
  return {
    timeZone,
    now: Number.isSafeInteger(minute) && minute >= 0 ? minute * MINUTE_MS : Date.now(),
  };
}

export function millisecondsUntilNextMinute(now = Date.now()): number {
  return MINUTE_MS - (now % MINUTE_MS) + TIMER_SLOP_MS;
}

export function subscribeCalendarClock(callback: () => void): () => void {
  let active = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = () => {
    if (!active) return;
    timer = setTimeout(() => {
      if (!active) return;
      callback();
      schedule();
    }, millisecondsUntilNextMinute());
  };
  const onVisible = () => {
    if (document.visibilityState === "visible") callback();
  };

  schedule();
  window.addEventListener("focus", callback);
  document.addEventListener("visibilitychange", onVisible);
  return () => {
    active = false;
    if (timer !== undefined) clearTimeout(timer);
    window.removeEventListener("focus", callback);
    document.removeEventListener("visibilitychange", onVisible);
  };
}
