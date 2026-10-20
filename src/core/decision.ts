import type { AppConfig } from '@shared/types'

import { normalizeSceneKey } from '@shared/scene'
export { normalizeSceneKey }

export interface GroupMapResult {
  map: Map<string, string> // normalized scene key -> preset id
  dupes: string[]
}

/** Build scene -> preset ("group") lookup. Only scenes mapped to a KNOWN preset count. */
export function buildGroupMap(cfg: Pick<AppConfig, 'presets' | 'scenes'>): GroupMapResult {
  const map = new Map<string, string>()
  const dupes: string[] = []
  for (const [scene, presetId] of Object.entries(cfg.scenes)) {
    if (!presetId || !(presetId in cfg.presets)) continue
    const key = normalizeSceneKey(scene)
    const existing = map.get(key)
    if (existing !== undefined && existing !== presetId) dupes.push(`'${scene}' listed in both ${existing} and ${presetId}`)
    else map.set(key, presetId)
  }
  return { map, dupes }
}

export function resolveGroup(map: Map<string, string>, scene?: string | null): string | null {
  if (!scene) return null
  return map.get(normalizeSceneKey(scene)) ?? null
}

export interface Decision {
  isCrossGroup: boolean
  origin: string
  target: string
  originGroup: string | null
  targetGroup: string | null
  key: 'intraGroup' | 'crossGroup'
  transitionName: string // as configured (the OBS name may differ if resolved by kind)
  durationMs: number
  settings: Record<string, unknown> | null
}

/** Pure decision: what transition does going origin -> target need? */
export function decide(
  cfg: Pick<AppConfig, 'transitions' | 'behavior'>,
  map: Map<string, string>,
  origin: string,
  target: string
): Decision {
  const og = resolveGroup(map, origin)
  const tg = resolveGroup(map, target)
  let cross = false
  if (og !== null && tg !== null) cross = og !== tg
  else if (og !== null && tg === null && cfg.behavior.unknownScenePolicy === 'cross') cross = true
  const key = cross ? 'crossGroup' : 'intraGroup'
  const t = cfg.transitions[key]
  return {
    isCrossGroup: cross,
    origin,
    target,
    originGroup: og,
    targetGroup: tg,
    key,
    transitionName: t.name,
    durationMs: t.durationMs,
    settings: t.settings
  }
}
