/**
 * Scene names here contain odd spacing and dashes, so EVERY comparison uses this normalized key:
 * unicode dashes -> '-', all whitespace removed, lower-cased.
 */
export function normalizeSceneKey(name?: string | null): string {
  if (!name) return ''
  return name.replace(/[‐-―−]/g, '-').replace(/\s/g, '').toLowerCase()
}
