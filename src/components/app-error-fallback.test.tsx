import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { AppErrorFallback } from "./app-error-fallback";
import styles from "./app-error-fallback.module.css";

type TestElementProps = { className?: string; children?: ReactNode; onClick?: unknown };

describe("AppErrorFallback", () => {
  it("follows the bootstrapped saved theme instead of overriding it with the OS theme", () => {
    const stylesheet = readFileSync(new URL("./app-error-fallback.module.css", import.meta.url), "utf8");

    expect(stylesheet).not.toContain("prefers-color-scheme");
    expect(stylesheet).toContain(':global(html[data-theme="light"]) .shell');
    expect(stylesheet).toContain("background: #090b0f");
  });

  it("renders generic recovery guidance without revealing exception details", () => {
    const html = renderToStaticMarkup(<AppErrorFallback reset={() => undefined} />);

    expect(html).toContain("页面暂时无法显示");
    expect(html).toContain("可以安全重试");
    expect(html).toContain('href="/"');
    expect(html).not.toContain("DATABASE_URL");
    expect(html).not.toContain("access_token");
    expect(html).not.toContain("Error:");
  });

  it("connects the retry button to the framework reset callback", () => {
    const reset = vi.fn();
    const tree = AppErrorFallback({ reset });
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
    expect((retryButton as ReactElement<TestElementProps> | undefined)?.props.onClick).toBe(reset);
  });
});
