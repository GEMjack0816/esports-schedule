import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

type Color = { red: number; green: number; blue: number; alpha: number };
type Declarations = Record<string, string>;

const css = readFileSync(resolve(process.cwd(), "src/app/globals.css"), "utf8");
const dashboard = readFileSync(resolve(process.cwd(), "src/components/schedule-dashboard.tsx"), "utf8");

function declarationsFor(selector: string): Declarations {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`(?:^|})\\s*${escaped}\\s*\\{([^}]*)\\}`, "m"));
  expect(match, `CSS rule exists for ${selector}`).toBeTruthy();

  return Object.fromEntries(
    match![1]!
      .split(";")
      .map((declaration) => declaration.trim())
      .filter(Boolean)
      .map((declaration) => {
        const separator = declaration.indexOf(":");
        return [declaration.slice(0, separator).trim(), declaration.slice(separator + 1).trim()];
      }),
  );
}

function themeVariables(selector: string): Declarations {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`(?:^|})\\s*${escaped}\\s*\\{([^}]*)\\}`, "m"));
  expect(match, `theme rule exists for ${selector}`).toBeTruthy();
  return Object.fromEntries(
    [...match![1]!.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map(([, name, value]) => [name!, value!.trim()]),
  );
}

function parseColor(value: string, variables: Declarations): Color {
  const normalized = value.trim();
  const variable = normalized.match(/^var\((--[\w-]+)\)$/);
  if (variable) {
    const resolved = variables[variable[1]!];
    expect(resolved, `CSS variable ${variable[1]} is defined`).toBeTruthy();
    return parseColor(resolved!, variables);
  }

  const mix = normalized.match(/^color-mix\(in srgb,\s*(.+?),\s*(.+?)\s+([\d.]+)%\)$/i);
  if (mix) {
    const first = parseColor(mix[1]!, variables);
    const second = parseColor(mix[2]!, variables);
    const secondWeight = Number(mix[3]) / 100;
    if (second.alpha === 0) {
      return { ...first, alpha: first.alpha * (1 - secondWeight) };
    }
    return {
      red: first.red * (1 - secondWeight) + second.red * secondWeight,
      green: first.green * (1 - secondWeight) + second.green * secondWeight,
      blue: first.blue * (1 - secondWeight) + second.blue * secondWeight,
      alpha: first.alpha * (1 - secondWeight) + second.alpha * secondWeight,
    };
  }

  if (normalized === "transparent") return { red: 0, green: 0, blue: 0, alpha: 0 };

  const hex = normalized.match(/^#([\da-f]{3}|[\da-f]{6})$/i)?.[1];
  if (hex) {
    const expanded = hex.length === 3 ? [...hex].map((digit) => `${digit}${digit}`).join("") : hex;
    return {
      red: Number.parseInt(expanded.slice(0, 2), 16),
      green: Number.parseInt(expanded.slice(2, 4), 16),
      blue: Number.parseInt(expanded.slice(4, 6), 16),
      alpha: 1,
    };
  }

  const rgba = normalized.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)$/i);
  expect(rgba, `supported CSS color: ${normalized}`).toBeTruthy();
  const channels = rgba!;
  return {
    red: Number(channels[1]),
    green: Number(channels[2]),
    blue: Number(channels[3]),
    alpha: channels[4] === undefined ? 1 : Number(channels[4]),
  };
}

function composite(over: Color, under: Color): Color {
  const alpha = over.alpha + under.alpha * (1 - over.alpha);
  if (alpha === 0) return { red: 0, green: 0, blue: 0, alpha: 0 };
  return {
    red: (over.red * over.alpha + under.red * under.alpha * (1 - over.alpha)) / alpha,
    green: (over.green * over.alpha + under.green * under.alpha * (1 - over.alpha)) / alpha,
    blue: (over.blue * over.alpha + under.blue * under.alpha * (1 - over.alpha)) / alpha,
    alpha,
  };
}

function luminance(color: Color): number {
  const channel = (value: number) => {
    const srgb = value / 255;
    return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(color.red) + 0.7152 * channel(color.green) + 0.0722 * channel(color.blue);
}

function contrastRatio(foreground: Color, background: Color): number {
  const lighter = Math.max(luminance(foreground), luminance(background));
  const darker = Math.min(luminance(foreground), luminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

function expectAa(name: string, foreground: Color, background: Color): void {
  expect(contrastRatio(foreground, background), `${name} contrast ratio`).toBeGreaterThanOrEqual(4.5);
}

const themes = [
  { name: "dark", selector: ":root" },
  { name: "light", selector: '[data-theme="light"]' },
] as const;

describe("schedule theme text contrast", () => {
  it.each(themes)("keeps key text at WCAG AA in the $name theme", ({ name, selector }) => {
    const variables = { ...themeVariables(":root"), ...(selector === ":root" ? {} : themeVariables(selector)) };
    const background = parseColor(variables["--background"]!, variables);
    const surface = parseColor(variables["--surface"]!, variables);
    const card = composite(parseColor(variables["--card-bg"]!, variables), background);
    const cyan = parseColor(variables["--cyan"]!, variables);
    const muted = parseColor(variables["--muted"]!, variables);

    for (const selectorName of [".eyebrow", ".section-index", ".data-summary a"]) {
      expect(declarationsFor(selectorName).color).toBe("var(--cyan)");
      expectAa(`${name} ${selectorName}`, cyan, background);
      expectAa(`${name} ${selectorName} on surface`, cyan, surface);
    }

    for (const selectorName of [".filter-panel input::placeholder", ".no-stream", ".team-score"]) {
      expect(declarationsFor(selectorName).color).toBe("var(--muted)");
      expectAa(`${name} ${selectorName}`, muted, card);
    }

    expect(declarationsFor(".submit-actions button").color).toBe("var(--on-cyan)");
    expectAa(`${name} submit button`, parseColor(variables["--on-cyan"]!, variables), cyan);
    expect(declarationsFor(".sync-normal strong").color).toBe("var(--sync-success)");
    expectAa(`${name} sync success`, parseColor(variables["--sync-success"]!, variables), card);
    expect(declarationsFor(".sync-delayed strong").color).toBe("var(--sync-warning)");
    expectAa(`${name} sync delayed`, parseColor(variables["--sync-warning"]!, variables), card);
    expect(declarationsFor(".submit-message.success").color).toBe("var(--success)");
    expectAa(`${name} submit success`, parseColor(variables["--success"]!, variables), card);
    expect(declarationsFor(".submit-message.error").color).toBe("var(--danger)");
    expectAa(`${name} submit error`, parseColor(variables["--danger"]!, variables), card);

    const notice = declarationsFor(".data-notice");
    expect(notice.color).toBe("var(--notice-text)");
    expectAa(
      `${name} data notice`,
      parseColor(variables["--notice-text"]!, variables),
      composite(parseColor(notice.background!, variables), background),
    );

    const boLabel = declarationsFor(".bo-label");
    expect(boLabel.color).toBe("var(--bo-label-color)");
    expectAa(
      `${name} BO label`,
      parseColor(variables["--bo-label-color"]!, variables),
      parseColor(variables["--bo-label-bg"]!, variables),
    );
  });

  it.each(themes)("keeps every match status readable in the $name theme", ({ name, selector }) => {
    const variables = { ...themeVariables(":root"), ...(selector === ":root" ? {} : themeVariables(selector)) };
    const page = parseColor(variables["--background"]!, variables);
    const card = composite(parseColor(variables["--card-bg"]!, variables), page);

    for (const [className, textToken, backgroundToken] of [
      [".status-running", "--cyan", "--status-running-bg"],
      [".status-scheduled", "--status-scheduled", "--status-scheduled-bg"],
      [".status-finished", "--status-finished", "--status-finished-bg"],
      [".status-postponed", "--status-postponed", "--status-postponed-bg"],
      [".status-cancelled", "--status-cancelled", "--status-cancelled-bg"],
      [".status-forfeit", "--status-forfeit", "--status-forfeit-bg"],
      [".status-unknown", "--status-unknown", "--status-unknown-bg"],
    ]) {
      const style = declarationsFor(className);
      expect(style.color).toBe(`var(${textToken})`);
      expect(style.background).toBe(`var(${backgroundToken})`);
      const badgeBackground = composite(parseColor(variables[backgroundToken]!, variables), card);
      expectAa(`${name} ${className}`, parseColor(variables[textToken]!, variables), badgeBackground);
    }
  });

  it.each(themes)("keeps all five game chips readable in the $name theme", ({ name, selector }) => {
    const variables = { ...themeVariables(":root"), ...(selector === ":root" ? {} : themeVariables(selector)) };
    const page = parseColor(variables["--background"]!, variables);
    const card = composite(parseColor(variables["--card-bg"]!, variables), page);
    const gameBlock = dashboard.match(/const games:[\s\S]*?\n};/)?.[0];
    expect(gameBlock).toBeTruthy();
    const gameColors = [...gameBlock!.matchAll(/color:\s*"(#[\da-f]{6})"/gi)].map((match) => match[1]!);
    expect(gameColors).toHaveLength(5);

    const baseStyle = declarationsFor(".game-chip");
    const lightStyle = selector === ":root" ? {} : declarationsFor('[data-theme="light"] .game-chip');
    const foregroundExpression = lightStyle.color ?? baseStyle.color;
    const backgroundExpression = baseStyle.background!;
    expect(foregroundExpression).toContain("var(--game-color)");
    expect(backgroundExpression).toContain("transparent 91%");

    for (const gameColor of gameColors) {
      const gameVariables = { ...variables, "--game-color": gameColor };
      const foreground = parseColor(foregroundExpression, gameVariables);
      const chipBackground = composite(parseColor(backgroundExpression, gameVariables), card);
      expectAa(`${name} game chip ${gameColor}`, foreground, chipBackground);
    }
  });
});
