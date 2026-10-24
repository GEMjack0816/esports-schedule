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

  it("limits application animations and transitions for reduced-motion users", () => {
    const css = readFileSync(resolve(process.cwd(), "src/app/globals.css"), "utf8");
    const reducedMotionBlocks = [...css.matchAll(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([\s\S]*?)\n\}/g)];
    const globalMotionBlock = reducedMotionBlocks.find(([, block]) =>
      /\*\s*,\s*\*::before\s*,\s*\*::after\s*\{/.test(block),
    )?.[1];

    expect(css).toMatch(/\.is-spinning\s*\{[^}]*animation:/);
    expect(css).toMatch(/\.live-dot\s*\{[^}]*animation:/);
    expect(globalMotionBlock).toContain("animation-duration: .01ms !important");
    expect(globalMotionBlock).toContain("animation-iteration-count: 1 !important");
    expect(globalMotionBlock).toContain("transition-duration: .01ms !important");
  });

  it("keeps placeholders visible in forced-colors mode without animation", () => {
    const css = readFileSync(resolve(process.cwd(), "src/app/globals.css"), "utf8");
    const forcedColorsRule = css.match(/@media\s*\(forced-colors:\s*active\)\s*\{([\s\S]*?)\n\}/);

    expect(forcedColorsRule?.[1]).toContain(".loading-skeleton");
    expect(forcedColorsRule?.[1]).toContain("background: Canvas");
    expect(forcedColorsRule?.[1]).toContain("border: 1px solid CanvasText");
    expect(forcedColorsRule?.[1]).toContain(".loading-skeleton::after { display: none; }");
  });
});
