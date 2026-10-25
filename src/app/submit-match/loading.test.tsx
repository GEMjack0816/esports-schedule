import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import SubmitMatchLoading from "./loading";

describe("submit-match route loading state", () => {
  it("announces the form context and does not show schedule-only placeholders", () => {
    const html = renderToStaticMarkup(<SubmitMatchLoading />);

    expect(html).toContain("正在加载提交表单");
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("loading-submit-field");
    expect(html).not.toContain("正在加载赛程");
  });
});
