export type ScheduleStatusCounts = {
  live: number;
  upcoming: number;
};

export function countLiveAndUpcoming(matches: readonly { status: string }[]): ScheduleStatusCounts {
  let live = 0;
  let upcoming = 0;

  for (const match of matches) {
    if (match.status === "running") live += 1;
    if (match.status === "scheduled") upcoming += 1;
  }

  return { live, upcoming };
}
