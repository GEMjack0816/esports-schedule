import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { THEME_BOOTSTRAP_SCRIPT } from "./theme-bootstrap";

function resolveTheme(savedTheme: string | null, prefersLight: boolean, storageThrows = false) {
  const documentElement = { dataset: {} as Record<string, string> };
  const context = {
    document: { documentElement },
    localStorage: {
      getItem: vi.fn(() => {
        if (storageThrows) throw new Error("storage unavailable");
        return savedTheme;
      }),
    },
    matchMedia: vi.fn(() => ({ matches: prefersLight })),
  };

  runInNewContext(THEME_BOOTSTRAP_SCRIPT, context);
  return { theme: documentElement.dataset.theme, context };
}

describe("theme bootstrap", () => {
  it.each(["light", "dark"] as const)("preserves a saved %s preference", (savedTheme) => {
    const { theme, context } = resolveTheme(savedTheme, savedTheme !== "dark");

    expect(theme).toBe(savedTheme);
    expect(context.matchMedia).not.toHaveBeenCalled();
  });

  it("uses the system preference when no valid preference is saved", () => {
    expect(resolveTheme(null, true).theme).toBe("light");
    expect(resolveTheme("sepia", false).theme).toBe("dark");
  });

  it("fails closed to dark mode when storage is unavailable", () => {
    const { theme, context } = resolveTheme(null, true, true);

    expect(theme).toBe("dark");
    expect(context.matchMedia).not.toHaveBeenCalled();
  });
});
