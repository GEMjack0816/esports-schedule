import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ScheduleResultStatus } from "./schedule-result-status";

describe("ScheduleResultStatus", () => {
  it("renders a concise atomic polite status region for filtered matches", () => {
    const html = renderToStaticMarkup(<ScheduleResultStatus count={12} />);
    expect(html).toContain('class="sr-only schedule-result-status"');
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('aria-atomic="true"');
    expect(html).toContain("筛选结果：12 场比赛。");
  });
  it("renders an explicit empty-result announcement", () => {
    const html = renderToStaticMarkup(<ScheduleResultStatus count={0} />);
    expect(html).toContain("没有符合条件的比赛。");
  });
  it("keeps the status live region empty while results refresh", () => {
    const html = renderToStaticMarkup(<ScheduleResultStatus count={null} />);
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('aria-atomic="true"');
    expect(html).not.toContain("筛选结果：");
  });
});
