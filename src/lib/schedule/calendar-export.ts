import type { EsportsMatch } from "./types";

export type CalendarRangeKey = "today" | "tomorrow" | "seven" | "history" | "all";

const credentialParameters = new Set([
  "access_token",
  "accesstoken",
  "api_key",
  "apikey",
  "auth",
  "authorization",
  "client_secret",
  "clientsecret",
  "code",
  "credential",
  "idtoken",
  "jwt",
  "oauth_token",
  "oauthtoken",
  "password",
  "passwd",
  "refreshtoken",
  "secret",
  "sig",
  "signature",
  "token",
  "state",
]);

function hasCredentialParameter(parameters: URLSearchParams): boolean {
  return [...parameters.keys()].some((key) => {
    const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
    return credentialParameters.has(key.toLowerCase())
      || credentialParameters.has(normalized)
      || /(?:token|secret|password|passwd|credential|authorization|signature|jwt)$/.test(normalized)
      || /(?:api|access|client|private)key$/.test(normalized);
  });
}

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

function utf8OctetLength(character: string): number {
  const codePoint = character.codePointAt(0) ?? 0;
  if (codePoint <= 0x7f) return 1;
  if (codePoint <= 0x7ff) return 2;
  if (codePoint <= 0xffff) return 3;
  return 4;
}

function foldLine(line: string): string {
  const physicalLines: string[] = [];
  let current = "";
  let octets = 0;

  for (const character of line) {
    const characterOctets = utf8OctetLength(character);
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
  for (const stream of match.streams) {
    try {
      const url = new URL(stream.url);
      const fragmentParameters = url.hash.slice(1).split("?").at(-1) ?? "";
      const containsCredential = hasCredentialParameter(url.searchParams)
        || hasCredentialParameter(new URLSearchParams(fragmentParameters));
      if (url.protocol === "https:" && !url.username && !url.password && !containsCredential) {
        return url.toString();
      }
    } catch {
      // Ignore malformed provider data and try the next stream.
    }
  }

  return null;
}

export function isCalendarExportable(match: EsportsMatch): boolean {
  return utcDateTime(match.startTimeUtc) !== null;
}

export function calendarExportFilename(range: CalendarRangeKey, selectedDate = ""): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(selectedDate)) {
    const parsed = new Date(`${selectedDate}T00:00:00.000Z`);
    if (Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === selectedDate) {
      return `esports-schedule-date-${selectedDate}.ics`;
    }
  }

  return `esports-schedule-${range}.ics`;
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
