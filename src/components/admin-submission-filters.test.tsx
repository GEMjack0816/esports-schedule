import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AdminSubmissionFilters } from "./admin-submission-filters";

describe("AdminSubmissionFilters", () => {
  it("provides visible, programmatic labels for both filter controls", () => {
    const markup = renderToStaticMarkup(
      <AdminSubmissionFilters status="pending" query="spring cup" />,
    );

    expect(markup).toMatch(/<label>\s*<span>状态<\/span>\s*<select[^>]*name="status"/);
    expect(markup).toMatch(/<label>\s*<span>搜索赛事或战队<\/span>\s*<input[^>]*type="search"[^>]*name="q"/);
    expect(markup).toContain('value="pending" selected');
    expect(markup).toContain('value="spring cup"');
  });
});
