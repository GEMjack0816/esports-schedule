/**
 * Runs before the error UI is painted so global-error keeps the same saved
 * theme as the normal root layout, which it replaces when active.
 */
export const THEME_BOOTSTRAP_SCRIPT =
  "try{var t=localStorage.getItem('schedule-theme');document.documentElement.dataset.theme=t==='light'||t==='dark'?t:(matchMedia('(prefers-color-scheme: light)').matches?'light':'dark')}catch(e){document.documentElement.dataset.theme='dark'}";
