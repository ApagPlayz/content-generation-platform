/**
 * Light/dark theme persistence (issue #126).
 *
 * Light is the default. Dark is opt-in via the toggle in the nav bar and is
 * remembered in localStorage, so it survives a reload.
 *
 * THEME_BOOT_SCRIPT runs synchronously in <head> before the first paint, which
 * is what stops the page flashing light for a frame before flipping to dark.
 * It is deliberately a plain string of ES5 so it can be inlined with
 * dangerouslySetInnerHTML and exercised in a unit test via node:vm.
 */

export type Theme = 'light' | 'dark'

export const THEME_STORAGE_KEY = 'ce-theme'
export const DEFAULT_THEME: Theme = 'light'

/** Anything that isn't the literal string 'dark' falls back to the default. */
export function normalizeTheme(value: unknown): Theme {
  return value === 'dark' ? 'dark' : DEFAULT_THEME
}

export const THEME_BOOT_SCRIPT = `(function(){try{
if(localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)})==='dark'){
document.documentElement.classList.add('dark')}}catch(e){}})();`
