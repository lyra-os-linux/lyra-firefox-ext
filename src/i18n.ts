/** Firefox supplies the en_US fallback declared in manifest.json. */
export function t(key: string, subs?: string | string[]): string {
  // Pure handoff tests run outside Firefox. Production always has browser.i18n.
  return typeof browser === "undefined" ? key : browser.i18n.getMessage(key, subs) || key;
}
