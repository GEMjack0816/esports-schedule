import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import Loading from "./loading";

describe("homepage loading state", () => {
  it("announces loading accessibly and marks the page busy", () => {
    const html = renderToStaticMarkup(<Loading />);

    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('role="status"');
    expect(html).toContain("正在加载赛程");
    expect(html.indexOf('role="status"')).toBeLessThan(html.indexOf('aria-busy="true"'));
  });

  it("renders responsive placeholders without inventing match details", () => {
    const html = renderToStaticMarkup(<Loading />);

    expect(html).toContain("loading-match-list");
    expect(html).toContain("loading-filters");
    expect(html).toContain("loading-sync-grid");
    expect(html).not.toContain("BO3");
    expect(html).not.toContain("待定");
  });

  it("disables decorative shimmer for users who prefer reduced motion", () => {
    const css = readFileSync(resolve(process.cwd(), "src/app/globals.css"), "utf8");
    const reducedMotionRule = css.match(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([^}]+)\}/);

    expect(reducedMotionRule?.[1]).toContain(".loading-skeleton::after");
    expect(reducedMotionRule?.[1]).toContain("animation: none");
    expect(reducedMotionRule?.[1]).toContain("background: none");
  });
});
