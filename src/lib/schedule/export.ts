import type { EsportsMatch, GameKey, MatchStatus } from "./types";

const gameLabels: Record<GameKey, string> = {
  lol: "英雄联盟",
  valorant: "无畏契约",
  "honor-of-kings": "王者荣耀",
  cs2: "CS2",
  dota2: "Dota 2",
};

const statusLabels: Record<MatchStatus, string> = {
  scheduled: "未开始",
  running: "进行中",
  finished: "已结束",
  postponed: "已延期",
  cancelled: "已取消",
  forfeit: "已弃权",
  unknown: "状态待确认",
};

const headers = [
  "比赛日期",
  "比赛时间",
  "时区",
  "游戏",
  "赛事",
  "锦标赛",
  "阶段",
  "战队 A",
  "战队 B",
  "比分",
  "赛制",
  "状态",
  "直播链接",
  "比赛 ID",
];

function csvCell(value: string | number | null): string {
  const text = value === null ? "" : String(value);
  // Spreadsheet applications may evaluate untrusted text as a formula even
  // when it is quoted as a CSV cell. Prefix formula-leading values as text.
  const safeText = /^[\s\uFEFF]*[=+\-@]/u.test(text) ? `'${text}` : text;
  return `"${safeText.replaceAll('"', '""')}"`;
}

function localDateParts(
  value: string | null,
  formatter: Intl.DateTimeFormat,
): { date: string; time: string } {
  if (!value) return { date: "", time: "" };
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) return { date: "", time: "" };

  const parts = formatter.formatToParts(instant);
  const values = Object.fromEntries(parts.map(({ type, value: part }) => [type, part]));
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    time: `${values.hour}:${values.minute}`,
  };
}

/** Creates a spreadsheet-safe CSV of the currently visible schedule matches. */
export function createScheduleCsv(matches: EsportsMatch[], timeZone: string): string {
  // A large schedule may contain thousands of matches; construct the locale
  // formatter once per export rather than once per row.
  const formatter = new Intl.DateTimeFormat("en", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const rows = matches.map((match) => {
    const local = localDateParts(match.startTimeUtc, formatter);
    const score = match.homeScore === null && match.awayScore === null
      ? ""
      : `${match.homeScore ?? "–"} - ${match.awayScore ?? "–"}`;

    return [
      local.date,
      local.time,
      match.startTimeUtc ? timeZone : "",
      gameLabels[match.game],
      match.league,
      match.tournament,
      match.stage,
      match.homeTeam.name,
      match.awayTeam.name,
      score,
      match.bestOf === null ? "待定" : `BO${match.bestOf}`,
      statusLabels[match.status],
      match.streams.map((stream) => stream.url).join(" "),
      match.id,
    ].map(csvCell).join(",");
  });

  return `\uFEFF${[headers.map(csvCell).join(","), ...rows].join("\r\n")}`;
}
