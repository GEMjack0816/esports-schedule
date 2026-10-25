export type ThemePreference = "dark" | "light";

type ThemePreferenceStorage = Pick<Storage, "setItem">;

/**
 * Saving a theme is best effort: the current page can still apply the selected
 * theme when browser storage is unavailable (for example in a restricted
 * privacy context). Always notify subscribers so their controls stay in sync.
 */
export function saveThemePreference(
  theme: ThemePreference,
  getStorage: () => ThemePreferenceStorage,
  notifyThemeChange: () => void,
): void {
  try {
    getStorage().setItem("schedule-theme", theme);
  } catch {
    // Keep the in-memory document theme; persistence is optional.
  }

  notifyThemeChange();
}
