import type { EsportsMatch } from "./types";

function utcDateTime(value: string | null): string | null {
  if (!value) return null;
  const timestamp = new Date(value);
  if (!Number.isFinite(timestamp.getTime())) return null;
  return timestamp.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function escapeText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\r\n|\r|\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function foldLine(line: string): string {
  const physicalLines: string[] = [];
  let current = "";
  let octets = 0;

  for (const character of line) {
    const characterOctets = new TextEncoder().encode(character).byteLength;
    if (octets + characterOctets > 75) {
      physicalLines.push(current);
      current = ` ${character}`;
      octets = 1 + characterOctets;
    } else {
      current += character;
      octets += characterOctets;
    }
  }

  physicalLines.push(current);
  return physicalLines.join("\r\n");
}

function eventStatus(status: EsportsMatch["status"]): "CANCELLED" | "CONFIRMED" | "TENTATIVE" {
  if (status === "cancelled") return "CANCELLED";
  if (status === "running" || status === "finished" || status === "forfeit") return "CONFIRMED";
  return "TENTATIVE";
}

function safeStreamUrl(match: EsportsMatch): string | null {
  const stream = match.streams[0];
  if (!stream) return null;
  try {
    const url = new URL(stream.url);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export function isCalendarExportable(match: EsportsMatch): boolean {
  return utcDateTime(match.startTimeUtc) !== null;
}

export function buildScheduleCalendar(
  matches: EsportsMatch[],
  generatedAt = new Date(),
): string {
  const stamp = utcDateTime(generatedAt.toISOString());
  if (!stamp) throw new Error("Calendar timestamp is invalid");

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Saijie PULSE//Esports Schedule//ZH-CN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:赛界电竞赛程",
  ];

  for (const match of matches) {
    const start = utcDateTime(match.startTimeUtc);
    if (!start) continue;

    const uid = `${encodeURIComponent(match.id)}@esports-schedule`;
    const summary = `${match.homeTeam.name} vs ${match.awayTeam.name} · ${match.league}`;
    const details = [
      `游戏：${match.game}`,
      `赛事：${match.tournament || match.league}`,
      match.stage ? `阶段：${match.stage}` : "",
      `赛制：${match.bestOf ? `BO${match.bestOf}` : "待定"}`,
      `状态：${match.status}`,
    ].filter(Boolean).join("\n");
    const streamUrl = safeStreamUrl(match);

    lines.push(
      "BEGIN:VEVENT",
      `UID:${uid}`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${start}`,
      `SUMMARY:${escapeText(summary)}`,
      `DESCRIPTION:${escapeText(details)}`,
      `STATUS:${eventStatus(match.status)}`,
      `CATEGORIES:${match.game}`,
      ...(streamUrl ? [`URL:${streamUrl}`] : []),
      "END:VEVENT",
    );
  }

  lines.push("END:VCALENDAR");
  return `${lines.map(foldLine).join("\r\n")}\r\n`;
}
