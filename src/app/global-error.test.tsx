import { renderToStaticMarkup } from "react-dom/server";
import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { describe, expect, it } from "vitest";
import GlobalError from "./global-error";
import { THEME_BOOTSTRAP_SCRIPT } from "@/lib/theme-bootstrap";

describe("global error theme bootstrap", () => {
  it("restores the selected theme before rendering the fallback", () => {
    const tree = GlobalError({ error: new Error("internal only"), reset: () => undefined });
    const html = renderToStaticMarkup(tree);

    const scriptPosition = html.indexOf(THEME_BOOTSTRAP_SCRIPT);
    const fallbackPosition = html.indexOf("页面暂时无法显示");

    expect((tree as ReactElement<{ suppressHydrationWarning?: boolean }>).props.suppressHydrationWarning)
      .toBe(true);
    expect(scriptPosition).toBeGreaterThanOrEqual(0);
    expect(fallbackPosition).toBeGreaterThan(scriptPosition);
    expect(html).not.toContain("internal only");
  });

  it("forwards Next.js reset to the rendered fallback", () => {
    const reset = () => undefined;
    const tree = GlobalError({ error: new Error("internal only"), reset });
    const htmlChildren = Children.toArray((tree as ReactElement<{ children?: ReactNode }>).props.children);
    const body = htmlChildren.find((child): child is ReactElement<{ children?: ReactNode }> =>
      isValidElement(child) && child.type === "body",
    );
    const bodyChildren = Children.toArray(body?.props.children);
    const fallback = bodyChildren.find((child): child is ReactElement<{ reset?: () => void }> =>
      isValidElement(child) && typeof child.type === "function",
    );

    expect(fallback?.props.reset).toBe(reset);
  });
});
