import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";
import GlobalError from "./global-error";
import { THEME_BOOTSTRAP_SCRIPT } from "@/lib/theme-bootstrap";

describe("global error theme bootstrap", () => {
  it("restores the selected theme before rendering the fallback", () => {
    const tree = GlobalError({ error: new Error("internal only"), retry: () => undefined });
    const html = renderToStaticMarkup(tree);

    const scriptPosition = html.indexOf(THEME_BOOTSTRAP_SCRIPT);
    const fallbackPosition = html.indexOf("页面暂时无法显示");

    expect((tree as ReactElement<{ suppressHydrationWarning?: boolean }>).props.suppressHydrationWarning)
      .toBe(true);
    expect(scriptPosition).toBeGreaterThanOrEqual(0);
    expect(fallbackPosition).toBeGreaterThan(scriptPosition);
    expect(html).not.toContain("internal only");
  });
});
