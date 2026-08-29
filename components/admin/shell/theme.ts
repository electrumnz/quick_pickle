/**
 * The scheme switch.
 *
 * `lib/brand/tokens.css` already publishes two complete, separately authored
 * palettes: the OS preference wins unless `data-theme` is set on the document,
 * and setting it flips every token at once. So this is the whole mechanism —
 * one attribute and one remembered string.
 */

export const THEME_STORAGE_KEY = "half-sour-theme";
export type Theme = "light" | "dark";

/**
 * Runs before first paint, from the admin layout.
 *
 * Inline and synchronous on purpose: reading the stored choice after hydration
 * would show the wrong scheme for a frame, which on a dark-mode admin at 6am is
 * a flash of a white screen.
 */
export const THEME_BOOTSTRAP_SCRIPT = `try{var t=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY,
)});if(t==="dark"||t==="light"){document.documentElement.dataset.theme=t}}catch(e){}`;
