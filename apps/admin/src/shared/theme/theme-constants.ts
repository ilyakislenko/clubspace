// Plain (non-client) module so the server root layout can import the no-flash
// script string without crossing the "use client" boundary.
import { DEFAULT_THEME_KEY } from "@clubspace/ui-kit/util"

export const THEME_STORAGE_KEY = "clubspace-theme"
export const MODE_STORAGE_KEY = "clubspace-theme-mode"

/**
 * Runs in <head> before hydration so the saved theme is applied before first
 * paint (no flash of the default theme). Keep in sync with applyToDom in
 * theme-provider.tsx.
 */
export const THEME_NO_FLASH_SCRIPT = `(function(){try{
  var t=localStorage.getItem('${THEME_STORAGE_KEY}')||'${DEFAULT_THEME_KEY}';
  var m=localStorage.getItem('${MODE_STORAGE_KEY}')||'auto';
  var d=document.documentElement;
  d.setAttribute('data-theme',t);
  var dark=m==='dark'||(m==='auto'&&window.matchMedia('(prefers-color-scheme: dark)').matches);
  d.classList.toggle('dark',dark);
}catch(e){}})();`
