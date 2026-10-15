"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { EsportsMatch, GameKey, MatchStatus } from "@/lib/schedule";
import type { SchedulePageData, SchedulePageQuery, ScheduleRangeKey } from "@/lib/schedule/page-types";
import {
  isCurrentSchedulePageRequest,
  isSchedulePageForCurrentFilters,
  schedulePageRequestKey,
} from "@/lib/schedule/client-page-request";
import { groupScheduleMatches } from "@/lib/schedule/client-grouping";
import { ScheduleResultStatus } from "@/components/schedule-result-status";
import { scheduleResultAnnouncementUpdate } from "@/lib/schedule/announcements";
import { dateKeyInTimeZone } from "@/lib/schedule/time";

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
        <Image
          src={team.logo || "/team-placeholder.svg"}
          alt=""
          width={28}
          height={28}
          unoptimized
          onError={(event) => { event.currentTarget.src = "/team-placeholder.svg"; }}
        />
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

function pageUrl(query: SchedulePageQuery): string {
  const params = new URLSearchParams({
    range: query.range,
    timeZone: query.timeZone,
    game: query.game,
    league: query.league,
    status: query.status,
    q: query.query,
    limit: String(query.limit),
  });
  if (query.selectedDate) params.set("date", query.selectedDate);
  if (query.cursor) params.set("cursor", query.cursor);
  return `/api/matches/page?${params.toString()}`;
}

export function ScheduleDashboard({ initialData }: { initialData: SchedulePageData }) {
  const [payload, setPayload] = useState(initialData);
  const [range, setRange] = useState<ScheduleRangeKey>("today");
  const [game, setGame] = useState<GameKey | "all">("all");
  const [league, setLeague] = useState("all");
  const [status, setStatus] = useState<MatchStatus | "all">("all");
  const [query, setQuery] = useState("");
  const [selectedDate, setSelectedDate] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [requestError, setRequestError] = useState(false);
  const [paginationRestartedFor, setPaginationRestartedFor] = useState<string | null>(null);
  const activeController = useRef<AbortController | null>(null);
  const requestSerial = useRef(0);
  const initialRequestSkipped = useRef(false);
  const loadingMoreRef = useRef(false);
  const timeZone = useSyncExternalStore(
    subscribeToTimeZone,
    getBrowserTimeZone,
    getServerTimeZone,
  );
  const theme = useSyncExternalStore(subscribeToTheme, getBrowserTheme, getServerTheme);

  const requestQuery = useMemo<SchedulePageQuery>(() => ({
    range,
    timeZone,
    game,
    league,
    status,
    query,
    selectedDate: selectedDate || null,
    cursor: null,
    limit: payload.page.limit,
  }), [game, league, payload.page.limit, query, range, selectedDate, status, timeZone]);
  const requestKey = schedulePageRequestKey(requestQuery);
  const initialPayloadKey = schedulePageRequestKey({
    range: "today",
    timeZone: initialData.timeZone,
    game: "all",
    league: "all",
    status: "all",
    query: "",
    selectedDate: null,
  });
  const [loadedRequestKey, setLoadedRequestKey] = useState(initialPayloadKey);
  const payloadMatchesFilters = isSchedulePageForCurrentFilters(loadedRequestKey, requestKey);
  const [announcedMatchCount, setAnnouncedMatchCount] = useState<number | null>(null);
  useEffect(
    () => scheduleResultAnnouncementUpdate(
      payloadMatchesFilters ? payload.page.total : null,
      setAnnouncedMatchCount,
    ),
    [payload.page.total, payloadMatchesFilters, requestKey],
  );
  const currentRequestKey = useRef(requestKey);
  useLayoutEffect(() => {
    currentRequestKey.current = requestKey;
  }, [requestKey]);

  useEffect(() => {
    if (!initialRequestSkipped.current) {
      initialRequestSkipped.current = true;
      if (requestQuery.timeZone === initialData.timeZone
        && requestQuery.range === "today"
        && requestQuery.game === "all"
        && requestQuery.league === "all"
        && requestQuery.status === "all"
        && !requestQuery.query
        && !requestQuery.selectedDate) return;
    }

    loadingMoreRef.current = false;
    setLoadingMore(false);
    const serial = ++requestSerial.current;
    const controller = new AbortController();
    activeController.current?.abort();
    activeController.current = controller;
    const delay = requestQuery.query.trim() ? 250 : 0;
    const timer = setTimeout(async () => {
      setLoading(true);
      setRequestError(false);
      try {
        const response = await fetch(pageUrl(requestQuery), { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("schedule page request failed");
        const next = await response.json() as SchedulePageData;
        if (isCurrentSchedulePageRequest(serial, requestSerial.current, requestKey, currentRequestKey.current)) {
          setPayload(next);
          setLoadedRequestKey(requestKey);
        }
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")
          && isCurrentSchedulePageRequest(serial, requestSerial.current, requestKey, currentRequestKey.current)) {
          setRequestError(true);
        }
      } finally {
        if (isCurrentSchedulePageRequest(serial, requestSerial.current, requestKey, currentRequestKey.current)) {
          setLoading(false);
        }
      }
    }, delay);
    return () => {
      clearTimeout(timer);
      controller.abort();
      if (activeController.current === controller) activeController.current = null;
    };
  }, [initialData.timeZone, requestKey, requestQuery]);

  const filtered = payload.matches;
  const leagues = payload.leagues;

  const grouped = useMemo(() => {
    return groupScheduleMatches(filtered, timeZone, range);
  }, [filtered, range, timeZone]);

  const liveCount = payload.liveCount;
  const upcomingCount = payload.upcomingCount;

  async function refreshSchedule() {
    setRefreshing(true);
    setLoading(true);
    // A refresh supersedes any in-flight pagination request. Its finally block
    // is intentionally guarded by the request serial, so release the pagination
    // state here rather than leaving the Load More control stuck as busy.
    loadingMoreRef.current = false;
    setLoadingMore(false);
    const serial = ++requestSerial.current;
    const controller = new AbortController();
    activeController.current?.abort();
    activeController.current = controller;
    setRequestError(false);
    try {
      const response = await fetch(pageUrl(requestQuery), { cache: "no-store", signal: controller.signal });
      if (!response.ok) throw new Error("schedule page request failed");
      const next = await response.json() as SchedulePageData;
      if (serial === requestSerial.current && requestKey === currentRequestKey.current) {
        setPayload(next);
        setLoadedRequestKey(requestKey);
        setPaginationRestartedFor(null);
      }
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")
        && serial === requestSerial.current && requestKey === currentRequestKey.current) setRequestError(true);
    } finally {
      if (serial === requestSerial.current) setLoading(false);
      setRefreshing(false);
      if (activeController.current === controller) activeController.current = null;
    }
  }

  async function loadMoreMatches() {
    const cursor = payload.page.nextCursor;
    if (!cursor || loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    const serial = ++requestSerial.current;
    const controller = new AbortController();
    activeController.current?.abort();
    activeController.current = controller;
    setRequestError(false);
    try {
      const response = await fetch(pageUrl({ ...requestQuery, cursor }), { cache: "no-store", signal: controller.signal });
      if (response.status === 409) {
        const body = await response.json() as { error?: string };
        if (body.error !== "SCHEDULE_CHANGED") throw new Error("schedule page changed unexpectedly");
        if (serial !== requestSerial.current || requestKey !== currentRequestKey.current) return;

        const restartedResponse = await fetch(pageUrl({ ...requestQuery, cursor: null }), {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!restartedResponse.ok) throw new Error("schedule page restart failed");
        const restarted = await restartedResponse.json() as SchedulePageData;
        if (serial === requestSerial.current && requestKey === currentRequestKey.current) {
          setPayload(restarted);
          setLoadedRequestKey(requestKey);
          setPaginationRestartedFor(requestKey);
          setRequestError(false);
        }
        return;
      }
      if (!response.ok) throw new Error("schedule page request failed");
      const next = await response.json() as SchedulePageData;
      if (serial === requestSerial.current && requestKey === currentRequestKey.current) {
        setPayload((current) => {
          const knownIds = new Set(current.matches.map((match) => match.id));
          const newMatches = next.matches.filter((match) => {
            if (knownIds.has(match.id)) return false;
            knownIds.add(match.id);
            return true;
          });
          return { ...next, matches: [...current.matches, ...newMatches] };
        });
        setLoadedRequestKey(requestKey);
      }
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")
        && serial === requestSerial.current && requestKey === currentRequestKey.current) setRequestError(true);
    } finally {
      if (serial === requestSerial.current) {
        loadingMoreRef.current = false;
        setLoadingMore(false);
      }
      if (activeController.current === controller) activeController.current = null;
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
          <button className="refresh-button" type="button" onClick={refreshSchedule} disabled={refreshing || loading}>
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
              <button key={key} role="tab" aria-selected={range === key} className={range === key ? "active" : ""} type="button" onClick={() => { setSelectedDate(""); setRange(key); }}>
                <span>{label}</span><em>{payload.rangeCounts[key]}</em>
              </button>
            ))}
          </div>

          <div className="filter-panel">
            <label className="search-field"><svg viewBox="0 0 18 18" aria-hidden="true"><circle cx="8" cy="8" r="4.75" /><path d="m11.5 11.5 3 3" /></svg><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索战队或赛事" /></label>
            <label><span className="sr-only">游戏</span><select value={game} onChange={(event) => setGame(event.target.value as GameKey | "all")}><option value="all">全部游戏</option>{Object.entries(games).map(([key, value]) => <option value={key} key={key}>{value.label}</option>)}</select></label>
            <label><span className="sr-only">赛事</span><select value={league} onChange={(event) => setLeague(event.target.value)}><option value="all">全部赛事</option>{leagues.map((item) => <option value={item} key={item}>{item}</option>)}</select></label>
            <label><span className="sr-only">状态</span><select value={status} onChange={(event) => setStatus(event.target.value as MatchStatus | "all")}><option value="all">全部状态</option>{Object.entries(statusMeta).map(([key, value]) => <option value={key} key={key}>{value.label}</option>)}</select></label>
            <label className="date-field"><span className="sr-only">日期</span><input type="date" min={payload.coverage.range.earliestMatchAt ? dateKeyInTimeZone(payload.coverage.range.earliestMatchAt, timeZone) : undefined} max={payload.coverage.range.latestMatchAt ? dateKeyInTimeZone(payload.coverage.range.latestMatchAt, timeZone) : undefined} value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)} /></label>
          </div>

          <ScheduleResultStatus count={announcedMatchCount} />
          <div className="match-list" aria-busy={loading || loadingMore}>
            {!payloadMatchesFilters && <div className="data-notice" role={requestError ? "alert" : "status"}>
              {requestError
                ? "当前筛选加载失败，下面显示的是上一组筛选结果；请重试。"
                : "筛选更新中，下面暂时保留上一组筛选结果。"}
            </div>}
            {requestError && payloadMatchesFilters && <div className="data-notice" role="alert">赛程筛选暂时失败，已保留当前结果，请重试。</div>}
            {paginationRestartedFor === requestKey && <div className="data-notice" role="status">赛程在浏览期间更新，已从最新结果重新载入。</div>}
            {loading && <div className="results-meta" role="status">{payloadMatchesFilters ? "正在更新筛选结果…" : "正在更新筛选结果，列表暂为上一组结果…"}</div>}
            {grouped.length > 0 ? grouped.map(([key, matches]) => (
              <section className="date-group" key={key}>
                <div className="date-divider"><span>{formatDate(matches[0].startTimeUtc, timeZone)}</span><i /><em>{matches.length} 场</em></div>
                {matches.map((match) => <MatchCard match={match} timeZone={timeZone} key={match.id} />)}
              </section>
            )) : (
              <div className="empty-state"><span className="empty-glyph">⌁</span><h3>{loading ? "正在加载比赛" : "没有找到符合条件的比赛"}</h3><p>{loading ? "正在读取当前筛选范围。" : "试试切换时间范围，或清除部分筛选条件。"}</p>{!loading && <button type="button" onClick={resetFilters}>清除筛选</button>}</div>
            )}
          </div>
          <div className="match-page-footer">
            <span className="results-meta">{payloadMatchesFilters ? "已载入" : "上一组筛选结果：已载入"} {payload.matches.length} / {payload.page.total} 场</span>
            {payloadMatchesFilters && payload.page.nextCursor && <button className="load-more-button" type="button" onClick={loadMoreMatches} disabled={loadingMore || loading}>
              {loadingMore ? "加载中…" : `加载更多（${Math.min(payload.page.limit, payload.page.total - payload.matches.length)} 场）`}
            </button>}
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
