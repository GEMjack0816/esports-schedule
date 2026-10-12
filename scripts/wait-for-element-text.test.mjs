import { describe, expect, it, vi } from "vitest";
import { waitForElementText } from "./wait-for-element-text.mjs";

describe("waitForElementText", () => {
  it("waits for delayed DOM text and forwards an explicit timeout to Playwright", async () => {
    let text = "old announcement";
    const previousDocument = globalThis.document;
    globalThis.document = {
      querySelector: vi.fn(() => ({ textContent: text })),
    };
    const page = {
      waitForFunction: vi.fn(async (predicate, argument, options) => {
        const deadline = Date.now() + options.timeout;
        while (!predicate(argument)) {
          if (Date.now() >= deadline) throw new Error("Timed out waiting for element text");
          await new Promise((resolve) => setTimeout(resolve, 5));
        }
      }),
    };

    try {
      const waiting = waitForElementText(page, ".schedule-result-status", "new announcement", 1_000);
      setTimeout(() => { text = "new announcement"; }, 20);
      await expect(waiting).resolves.toBeUndefined();
      expect(page.waitForFunction).toHaveBeenCalledWith(
        expect.any(Function),
        { selector: ".schedule-result-status", expected: "new announcement" },
        { timeout: 1_000 },
      );
    } finally {
      if (previousDocument === undefined) delete globalThis.document;
      else globalThis.document = previousDocument;
    }
  });
});
