import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getReviewRepository, parseSubmissionFilters, requireAdminPage, listSubmissions } = vi.hoisted(() => ({
  getReviewRepository: vi.fn(),
  parseSubmissionFilters: vi.fn(),
  requireAdminPage: vi.fn(),
  listSubmissions: vi.fn(),
}));

vi.mock("@/components/admin-nav", () => ({ AdminNav: () => null }));
vi.mock("@/lib/auth/admin-page", () => ({ requireAdminPage }));
vi.mock("@/lib/review/repository", () => ({ getReviewRepository }));
vi.mock("@/lib/review/service", () => ({ parseSubmissionFilters }));

import AdminSubmissionsPage from "./page";

describe("admin submissions filter accessibility", () => {
  beforeEach(() => {
    requireAdminPage.mockReset().mockResolvedValue(undefined);
    parseSubmissionFilters.mockReset().mockReturnValue({});
    listSubmissions.mockReset().mockResolvedValue({ rows: [], total: 0, page: 1, pageSize: 50 });
    getReviewRepository.mockReset().mockReturnValue({ listSubmissions });
  });

  it("names the status and search controls for assistive technology", async () => {
    const element = await AdminSubmissionsPage({ searchParams: Promise.resolve({}) });
    const html = renderToStaticMarkup(element);

    expect(requireAdminPage).toHaveBeenCalledWith("/admin/submissions");
    expect(html).toMatch(/<select[^>]*aria-label="提交状态"/);
    expect(html).toMatch(/<input[^>]*aria-label="搜索赛事或战队"/);
  });
});
