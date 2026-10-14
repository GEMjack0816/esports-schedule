type ScheduleFormatters = {
  time: Intl.DateTimeFormat;
  date: Intl.DateTimeFormat;
  dateTime: Intl.DateTimeFormat;
};

const MAX_CACHED_TIME_ZONES = 8;
const formattersByTimeZone = new Map<string, ScheduleFormatters>();

/**
 * Reuse the expensive Intl formatter instances used by the thousands of match
 * cards. The small LRU bound prevents arbitrary timezone inputs from growing
 * this module-level cache without limit.
 */
export function getScheduleFormatters(timeZone: string): ScheduleFormatters {
  const cached = formattersByTimeZone.get(timeZone);
  if (cached) {
    formattersByTimeZone.delete(timeZone);
    formattersByTimeZone.set(timeZone, cached);
    return cached;
  }

  const formatters: ScheduleFormatters = {
    time: new Intl.DateTimeFormat("zh-CN", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }),
    date: new Intl.DateTimeFormat("zh-CN", {
      timeZone,
      month: "long",
      day: "numeric",
      weekday: "short",
    }),
    dateTime: new Intl.DateTimeFormat("zh-CN", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }),
  };

  formattersByTimeZone.set(timeZone, formatters);
  if (formattersByTimeZone.size > MAX_CACHED_TIME_ZONES) {
    const leastRecentlyUsedTimeZone = formattersByTimeZone.keys().next().value;
    if (leastRecentlyUsedTimeZone !== undefined) {
      formattersByTimeZone.delete(leastRecentlyUsedTimeZone);
    }
  }

  return formatters;
}
