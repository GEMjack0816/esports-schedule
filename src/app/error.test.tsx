import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";
import ErrorPage from "./error";

describe("route error boundary", () => {
  it("forwards the Next.js reset callback to the recovery UI", () => {
    const reset = () => undefined;
    const tree = ErrorPage({ error: new Error("internal only"), reset });

    expect((tree as ReactElement<{ reset?: () => void }>).props.reset).toBe(reset);
  });
});
