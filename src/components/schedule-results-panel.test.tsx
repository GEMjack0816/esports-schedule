import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ScheduleResultsPanel } from "./schedule-results-panel";

describe("ScheduleResultsPanel", () => {
  it("keeps partial matches visible and marks the list busy during a full-schedule load", () => {
    const html = renderToStaticMarkup(
      <ScheduleResultsPanel
        completeScheduleError={false}
        loadingCompleteSchedule
        needsCompleteSchedule
        onRetry={vi.fn()}
      >
        <article className="match-card">Already loaded match</article>
      </ScheduleResultsPanel>,
    );

    expect(html).toContain("正在加载完整赛程；先显示当前已加载的比赛。");
    expect(html).toContain('class="match-list" aria-live="polite" aria-busy="true"');
    expect(html).toContain('<article class="match-card">Already loaded match</article>');
  });

  it("keeps partial matches visible and offers retry after the full-schedule request fails", () => {
    const html = renderToStaticMarkup(
      <ScheduleResultsPanel
        completeScheduleError
        loadingCompleteSchedule={false}
        needsCompleteSchedule
        onRetry={vi.fn()}
      >
        <article className="match-card">Already loaded match</article>
      </ScheduleResultsPanel>,
    );

    expect(html).toContain('role="alert"');
    expect(html).toContain("完整赛程暂时无法加载；当前已加载的比赛仍可查看。");
    expect(html).toContain('<button type="button">重试</button>');
    expect(html).toContain('<article class="match-card">Already loaded match</article>');
    expect(html).toContain('class="match-list" aria-live="polite" aria-busy="false"');
  });

  it("does not show full-schedule status when a complete load is not needed", () => {
    const html = renderToStaticMarkup(
      <ScheduleResultsPanel
        completeScheduleError
        loadingCompleteSchedule
        needsCompleteSchedule={false}
        onRetry={vi.fn()}
      >
        <article className="match-card">Already loaded match</article>
      </ScheduleResultsPanel>,
    );

    expect(html).not.toContain('role="alert"');
    expect(html).not.toContain('role="status"');
    expect(html).toContain('aria-busy="false"');
  });
});
