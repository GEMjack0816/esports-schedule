import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import Loading from "./loading";

describe("homepage loading state", () => {
  it("announces loading accessibly and marks the page busy", () => {
    const html = renderToStaticMarkup(<Loading />);

    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('role="status"');
    expect(html).toContain("正在加载赛程");
  });

  it("renders responsive placeholders without inventing match details", () => {
    const html = renderToStaticMarkup(<Loading />);

    expect(html).toContain("loading-match-list");
    expect(html).toContain("loading-filters");
    expect(html).toContain("loading-sync-grid");
    expect(html).not.toContain("BO3");
    expect(html).not.toContain("待定");
  });
});
