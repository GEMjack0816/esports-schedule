"use client";

import Link from "next/link";
import { useMemo, useState, useSyncExternalStore } from "react";
import type { EsportsMatch, GameKey, MatchStatus, SchedulePayload } from "@/lib/schedule";
import { addDaysKey, dateKeyInTimeZone } from "@/lib/schedule/time";
import { TeamLogo } from "@/components/team-logo";

type RangeKey = "today" | "tomorrow" | "seven" | "history" | "all";
type Theme = "dark" | "light";

const subscribeToTimeZone = () => () => undefined;
const getBrowserTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
const getServerTimeZone = () => "UTC";
const subscribeToTheme = (callback: () => void) => {
  window.addEventListener("schedule-theme-change", callback);
  return () => window.removeEventListener("schedule-theme-change", callback);
};
const getBrowserTheme = (): Theme => document.documentElement.dataset.theme === "light" ? "light" : "dark";
const getServerTheme = (): Theme => "dark";

const games: Record<GameKey, { label: string; short: string; color: string }> = {
  lol: { label: "英雄联盟", short: "LOL", color: "#45d6ff" },
  valorant: { label: "无畏契约", short: "VAL", color: "#ff5f68" },
  "honor-of-kings": { label: "王者荣耀", short: "HOK", color: "#f6c85f" },
  cs2: { label: "CS2", short: "CS2", color: "#ff9d4a" },
  dota2: { label: "Dota 2", short: "DOTA", color: "#e96a6a" },
};

const statusMeta: Record<MatchStatus, { label: string; className: string }> = {
  scheduled: { label: "未开始", className: "status-scheduled" },
  running: { label: "进行中", className: "status-running" },
  finished: { label: "已结束", className: "status-finished" },
  postponed: { label: "已延期", className: "status-postponed" },
  cancelled: { label: "已取消", className: "status-cancelled" },
  forfeit: { label: "已弃权", className: "status-forfeit" },
  unknown: { label: "状态待确认", className: "status-unknown" },
};

function formatTime(value: string | null, timeZone: string): string {
  if (!value) return "待定";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function formatDate(value: string | null, timeZone: string): string {
  if (!value) return "时间待定";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone,
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(new Date(value));
}

function formatDateTime(value: string | null, timeZone: string): string {
  if (!value) return "暂无";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function initials(name: string): string {
  const asciiInitials = name.split(/\s+/).map((part) => part[0]).join("").slice(0, 3);
  return asciiInitials || name.slice(0, 2);
}

function matchDateKey(match: EsportsMatch, timeZone: string): string {
  return match.startTimeUtc ? dateKeyInTimeZone(match.startTimeUtc, timeZone) : "unscheduled";
}

function MatchStatusBadge({ status }: { status: MatchStatus }) {
  const meta = statusMeta[status];
  return (
    <span className={`status-badge ${meta.className}`}>
      {status === "running" && <span className="live-dot" aria-hidden="true" />}
      {meta.label}
    </span>
  );
}

function TeamRow({ team, score, winning }: {
  team: EsportsMatch["homeTeam"];
  score: number | null;
  winning: boolean;
}) {
  return (
    <div className={`team-row ${winning ? "team-winning" : ""}`}>
      <span className="team-mark" aria-hidden="true">
        <TeamLogo source={team.logo} />
        <span>{team.acronym?.slice(0, 3) || initials(team.name)}</span>
      </span>
      <span className="team-name">{team.name}</span>
      <span className="team-score">{score ?? "–"}</span>
    </div>
  );
}

function MatchCard({ match, timeZone }: { match: EsportsMatch; timeZone: string }) {
  const game = games[match.game];
  const scoreA = match.homeScore;
  const scoreB = match.awayScore;
  const firstWins = scoreA !== null && scoreB !== null && scoreA > scoreB;
  const secondWins = scoreA !== null && scoreB !== null && scoreB > scoreA;
  const stream = match.streams[0];

  return (
    <article className={`match-card ${match.status === "running" ? "match-live" : ""}`}>
      <div className="match-time-cell">
        <span className="match-time">{formatTime(match.startTimeUtc, timeZone)}</span>
        <span className="match-date">{formatDate(match.startTimeUtc, timeZone)}</span>
      </div>
      <div className="match-event-cell">
        <span className="game-chip" style={{ "--game-color": game.color } as React.CSSProperties}>{game.short}</span>
        <div><h3>{match.league}</h3><p>{[match.tournament, match.stage].filter(Boolean).join(" · ") || "赛程待更新"}</p></div>
      </div>
      <div className="match-teams-cell">
        <TeamRow team={match.homeTeam} score={scoreA} winning={firstWins} />
        <TeamRow team={match.awayTeam} score={scoreB} winning={secondWins} />
      </div>
      <div className="match-meta-cell">
        <span className="bo-label">{match.bestOf ? `BO${match.bestOf}` : "BO待定"}</span>
        <MatchStatusBadge status={match.status} />
        {stream ? (
          <a className="watch-link" href={stream.url} target="_blank" rel="noreferrer">
            <span>{match.status === "running" ? "立即观看" : "直播入口"}</span>
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5.25 3.5h7.25v7.25M12.3 3.7l-8.8 8.8" /></svg>
          </a>
        ) : <span className="no-stream">暂无直播</span>}
      </div>
    </article>
  );
}

export function ScheduleDashboard({ initialData }: { initialData: SchedulePayload }) {
  const [payload, setPayload] = useState(initialData);
  const [range, setRange] = useState<RangeKey>("today");
  const [game, setGame] = useState<GameKey | "all">("all");
  const [league, setLeague] = useState("all");
  const [status, setStatus] = useState<MatchStatus | "all">("all");
  const [query, setQuery] = useState("");
  const [selectedDate, setSelectedDate] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const timeZone = useSyncExternalStore(
    subscribeToTimeZone,
    getBrowserTimeZone,
    getServerTimeZone,
  );
  const theme = useSyncExternalStore(subscribeToTheme, getBrowserTheme, getServerTheme);

  const today = addDaysKey(0, timeZone);
  const tomorrow = addDaysKey(1, timeZone);
  const sevenDaysOut = addDaysKey(6, timeZone);

  const rangeCounts = useMemo(() => {
    const counts: Record<RangeKey, number> = { today: 0, tomorrow: 0, seven: 0, history: 0, all: 0 };
    for (const match of payload.matches) {
      const key = matchDateKey(match, timeZone);
      counts.all += 1;
      if (key === today) counts.today += 1;
      if (key === tomorrow) counts.tomorrow += 1;
      if (key >= today && key <= sevenDaysOut) counts.seven += 1;
      if (key < today) counts.history += 1;
    }
    return counts;
  }, [payload.matches, sevenDaysOut, timeZone, today, tomorrow]);

  const leagues = useMemo(
    () => [...new Set(payload.matches.map((match) => match.league))].sort(),
    [payload.matches],
  );

  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return payload.matches.filter((match) => {
      const key = matchDateKey(match, timeZone);
      const inRange = selectedDate
        ? key === selectedDate
        : range === "all"
          ? true
          : range === "today"
            ? key === today
            : range === "tomorrow"
              ? key === tomorrow
              : range === "seven"
                ? key >= today && key <= sevenDaysOut
                : key < today;
      const haystack = [match.homeTeam.name, match.awayTeam.name, match.league, match.tournament || "", match.stage || ""]
        .join(" ").toLocaleLowerCase();
      return inRange
        && (game === "all" || match.game === game)
        && (league === "all" || match.league === league)
        && (status === "all" || match.status === status)
        && (!normalizedQuery || haystack.includes(normalizedQuery));
    });
  }, [game, league, payload.matches, query, range, selectedDate, sevenDaysOut, status, timeZone, today, tomorrow]);

  const grouped = useMemo(() => {
    const groups = new Map<string, EsportsMatch[]>();
    for (const match of filtered) {
      const key = matchDateKey(match, timeZone);
      groups.set(key, [...(groups.get(key) ?? []), match]);
    }
    return [...groups.entries()].sort(([a], [b]) => {
      if (a === "unscheduled") return 1;
      if (b === "unscheduled") return -1;
      return range === "history" ? b.localeCompare(a) : a.localeCompare(b);
    });
  }, [filtered, range, timeZone]);

  const liveCount = payload.matches.filter((match) => match.status === "running").length;
  const upcomingCount = payload.matches.filter((match) => match.status === "scheduled").length;

  async function refreshSchedule() {
    setRefreshing(true);
    try {
      const response = await fetch("/api/matches", { cache: "no-store" });
      if (response.ok) setPayload((await response.json()) as SchedulePayload);
    } finally {
      setRefreshing(false);
    }
  }

  function resetFilters() {
    setGame("all"); setLeague("all"); setStatus("all"); setQuery(""); setSelectedDate("");
  }

  function toggleTheme() {
    const nextTheme: Theme = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = nextTheme;
    localStorage.setItem("schedule-theme", nextTheme);
    window.dispatchEvent(new Event("schedule-theme-change"));
  }

  return (
    <div className="site-shell">
      <header className="site-header">
        <a className="brand" href="#top" aria-label="赛界首页">
          <span className="brand-mark"><i /><i /><i /></span>
          <span>赛界<span className="brand-accent">PULSE</span></span>
        </a>
        <div className="header-actions">
          <span className="timezone-pill">
            <svg viewBox="0 0 18 18" aria-hidden="true"><circle cx="9" cy="9" r="6.75" /><path d="M9 5v4.3l2.7 1.7" /></svg>
            {timeZone.replace("Asia/", "")}
          </span>
          <button className="theme-button" type="button" onClick={toggleTheme} aria-label={theme === "dark" ? "切换到浅色主题" : "切换到深色主题"}>
            <span aria-hidden="true">{theme === "dark" ? "☀" : "☾"}</span>
          </button>
          <button className="refresh-button" type="button" onClick={refreshSchedule} disabled={refreshing}>
            <svg className={refreshing ? "is-spinning" : ""} viewBox="0 0 18 18" aria-hidden="true"><path d="M14.6 6.5A6 6 0 1 0 15 10M14.6 3.5v3h-3" /></svg>
            <span>{refreshing ? "更新中" : "刷新"}</span>
          </button>
        </div>
      </header>

      <main id="top">
        <section className="hero-section">
          <div className="hero-copy">
            <span className="eyebrow"><i /> GLOBAL ESPORTS FIXTURES</span>
            <h1>全球赛场，<br /><span>一屏掌握。</span></h1>
            <p>聚合五大电竞项目的主要职业及半职业比赛、比分与直播入口，时间会自动转换为你的本地时区。</p>
          </div>
          <div className="hero-stats">
            <div className="stat-card stat-card-live"><span className="stat-label"><i /> LIVE NOW</span><strong>{String(liveCount).padStart(2, "0")}</strong><span>场比赛正在进行</span></div>
            <div className="stat-card"><span className="stat-label">UP NEXT</span><strong>{String(upcomingCount).padStart(2, "0")}</strong><span>场比赛即将开赛</span></div>
          </div>
        </section>

        <section className="schedule-section" aria-labelledby="schedule-title">
          <div className="section-heading">
            <div><span className="section-index">01 / 赛程中心</span><h2 id="schedule-title">比赛日历</h2></div>
            <div className={`source-state ${payload.mode === "live" && !payload.stale ? "source-live" : "source-stale"}`}>
              <i />
              <span>{payload.mode === "live"
                ? payload.stale ? "PandaScore 聚合数据（部分延迟）" : "PandaScore 聚合数据"
                : "PandaScore 聚合数据（服务暂不可用）"}</span>
            </div>
          </div>

          {payload.warning && <div className="data-notice" role="status"><svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7.5" /><path d="M10 6.5v4.2M10 13.7h.01" /></svg><span>{payload.warning}</span></div>}

          <div className="data-summary" aria-label="数据覆盖信息">
            <span>源快照时间 <strong>{formatDateTime(payload.coverage.sourceFetchedAt, timeZone)}</strong></span>
            <span>最近同步尝试 <strong>{formatDateTime(payload.coverage.lastAttemptAt, timeZone)}</strong></span>
            <span>当前收录范围 <strong>{formatDateTime(payload.coverage.range.earliestMatchAt, timeZone)} — {formatDateTime(payload.coverage.range.latestMatchAt, timeZone)}</strong></span>
            <Link href="/submit-match" prefetch={false}>提交遗漏比赛</Link>
          </div>

          <div className="sync-status-grid" aria-label="各游戏数据同步状态">
            {Object.entries(games).map(([key, value]) => {
              const coverage = payload.coverage.games[key as GameKey];
              const syncStatus = coverage?.syncStatus ?? "failed";
              return (
                <div className={`sync-status-card sync-${syncStatus}`} key={key}>
                  <span>{value.label}</span>
                  <strong>{coverage?.refreshInProgress ? "同步中" : syncStatus === "normal" ? "正常" : syncStatus === "delayed" ? "延迟" : "同步失败"}</strong>
                  <small>{formatDateTime(coverage?.sourceFetchedAt ?? null, timeZone)}</small>
                </div>
              );
            })}
          </div>

          <div className="range-tabs" role="tablist" aria-label="选择时间范围">
            {([ ["today", "今日"], ["tomorrow", "明日"], ["seven", "未来 7 天"], ["history", "历史比赛"], ["all", "全部收录"] ] as const).map(([key, label]) => (
              <button key={key} role="tab" aria-selected={range === key} className={range === key ? "active" : ""} type="button" onClick={() => setRange(key)}>
                <span>{label}</span><em>{rangeCounts[key]}</em>
              </button>
            ))}
          </div>

          <div className="filter-panel">
            <label className="search-field"><svg viewBox="0 0 18 18" aria-hidden="true"><circle cx="8" cy="8" r="4.75" /><path d="m11.5 11.5 3 3" /></svg><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索战队或赛事" /></label>
            <label><span className="sr-only">游戏</span><select value={game} onChange={(event) => setGame(event.target.value as GameKey | "all")}><option value="all">全部游戏</option>{Object.entries(games).map(([key, value]) => <option value={key} key={key}>{value.label}</option>)}</select></label>
            <label><span className="sr-only">赛事</span><select value={league} onChange={(event) => setLeague(event.target.value)}><option value="all">全部赛事</option>{leagues.map((item) => <option value={item} key={item}>{item}</option>)}</select></label>
            <label><span className="sr-only">状态</span><select value={status} onChange={(event) => setStatus(event.target.value as MatchStatus | "all")}><option value="all">全部状态</option>{Object.entries(statusMeta).map(([key, value]) => <option value={key} key={key}>{value.label}</option>)}</select></label>
            <label className="date-field"><span className="sr-only">日期</span><input type="date" min={payload.coverage.range.earliestMatchAt?.slice(0, 10)} max={payload.coverage.range.latestMatchAt?.slice(0, 10)} value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)} /></label>
          </div>

          <div className="match-list" aria-live="polite">
            {grouped.length > 0 ? grouped.map(([key, matches]) => (
              <section className="date-group" key={key}>
                <div className="date-divider"><span>{formatDate(matches[0].startTimeUtc, timeZone)}</span><i /><em>{matches.length} 场</em></div>
                {matches.map((match) => <MatchCard match={match} timeZone={timeZone} key={match.id} />)}
              </section>
            )) : (
              <div className="empty-state"><span className="empty-glyph">⌁</span><h3>没有找到符合条件的比赛</h3><p>试试切换时间范围，或清除部分筛选条件。</p><button type="button" onClick={resetFilters}>清除筛选</button></div>
            )}
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <div className="brand footer-brand"><span className="brand-mark"><i /><i /><i /></span><span>赛界<span className="brand-accent">PULSE</span></span></div>
        <p>PandaScore 五游戏 Fixtures · 人工纠错补漏 · 自动本地时区</p>
        <span>最后成功同步 {formatDateTime(payload.lastSuccessfulSyncAt, timeZone)}</span>
      </footer>
    </div>
  );
}
