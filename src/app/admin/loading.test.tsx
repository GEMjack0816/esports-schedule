import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import AdminLoading from "./loading";

describe("admin route loading state", () => {
  it("announces the admin route instead of showing the public schedule fallback", () => {
    const html = renderToStaticMarkup(<AdminLoading />);

    expect(html).toContain("正在加载管理页面");
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('aria-describedby="admin-loading-status"');
    expect(html).toContain("loading-admin-list");
    expect(html).not.toContain("正在加载赛程");
  });
});
