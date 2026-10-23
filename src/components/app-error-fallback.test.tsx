import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AppErrorFallback } from "./app-error-fallback";
import styles from "./app-error-fallback.module.css";

type TestElementProps = { className?: string; children?: ReactNode; onClick?: unknown };

describe("AppErrorFallback", () => {
  it("renders generic recovery guidance without revealing exception details", () => {
    const html = renderToStaticMarkup(<AppErrorFallback retry={() => undefined} />);

    expect(html).toContain("页面暂时无法显示");
    expect(html).toContain("可以安全重试");
    expect(html).toContain('href="/"');
    expect(html).not.toContain("DATABASE_URL");
    expect(html).not.toContain("access_token");
    expect(html).not.toContain("Error:");
  });

  it("connects the retry button to the framework retry callback", () => {
    const retry = vi.fn();
    const tree = AppErrorFallback({ retry });
    const children = Children.toArray((tree as ReactElement<TestElementProps>).props.children);
    const card = children.find((child): child is ReactElement =>
      isValidElement(child) && (child as ReactElement<TestElementProps>).props.className === styles.card,
    );
    expect(card).toBeDefined();

    const cardChildren = Children.toArray((card as ReactElement<TestElementProps> | undefined)?.props.children);
    const actions = cardChildren.find((child): child is ReactElement =>
      isValidElement(child) && (child as ReactElement<TestElementProps>).props.className === styles.actions,
    );
    expect(actions).toBeDefined();

    const actionChildren = Children.toArray((actions as ReactElement<TestElementProps> | undefined)?.props.children);
    const retryButton = actionChildren.find((child): child is ReactElement =>
      isValidElement(child) && child.type === "button",
    );
    expect((retryButton as ReactElement<TestElementProps> | undefined)?.props.onClick).toBe(retry);
  });
});
