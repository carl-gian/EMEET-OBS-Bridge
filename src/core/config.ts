import type { AppConfig, Point, PresetCfg } from '@shared/types'
import { defaultConfig } from './defaults'

type Obj = Record<string, any>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Remove "_comment"-style keys (any key starting with "_") everywhere. */
function stripComments(v: any): any {
  if (Array.isArray(v)) return v.map(stripComments)
  if (!isObj(v)) return v
  const out: Obj = {}
  for (const [k, val] of Object.entries(v)) if (!k.startsWith('_')) out[k] = stripComments(val)
  return out
}

/** Merge `raw` over `def`, keeping only keys that exist in `def` and have the same primitive type. */
function mergeKnown(def: any, raw: any): any {
  if (isObj(def)) {
    if (!isObj(raw)) return def
    const out: Obj = {}
    for (const k of Object.keys(def)) out[k] = k in raw ? mergeKnown(def[k], raw[k]) : def[k]
    return out
  }
  if (def === null) return raw === undefined ? null : raw // nullable fields: accept whatever is given
  if (typeof def === typeof raw) return raw
  if (typeof def === 'number' && typeof raw === 'string' && raw.trim() !== '' && !isNaN(Number(raw))) return Number(raw)
  return def
}

function toPoint(v: unknown): Point | null {
  if (!isObj(v)) return null
  const x = Number(v.x)
  const y = Number(v.y)
  return Number.isFinite(x) && Number.isFinite(y) ? { x: Math.round(x), y: Math.round(y) } : null
}

/**
 * Turn whatever was in a config file (new layout OR the old PowerShell layout) into a complete, safe AppConfig.
 * Returns warnings for things that were ignored.
 */
export function normalizeConfig(rawIn: unknown): { config: AppConfig; warnings: string[] } {
  const warnings: string[] = []
  const def = defaultConfig()
  const raw: Obj = isObj(rawIn) ? stripComments(rawIn) : {}
  const cfg = def

  for (const section of ['general', 'obs', 'transitions', 'blackBridge', 'ptz', 'emeet', 'behavior', 'logging'] as const) {
    if (section in raw) (cfg as Obj)[section] = mergeKnown((def as Obj)[section], raw[section])
  }

  // Old layout: obs.uri = "ws://host:port"
  if (isObj(raw.obs) && typeof raw.obs.uri === 'string' && !('host' in raw.obs) && !('port' in raw.obs)) {
    try {
      const u = new URL(raw.obs.uri)
      cfg.obs.host = u.hostname || 'localhost'
      if (u.port) cfg.obs.port = Number(u.port)
    } catch {
      warnings.push(`obs.uri '${raw.obs.uri}' is not a valid URL - using defaults.`)
    }
  }
  // transitions.*.settings may legitimately be null/object; mergeKnown handles it.
  if (isObj(raw.transitions)) {
    for (const k of ['intraGroup', 'crossGroup'] as const) {
      const r = raw.transitions[k]
      if (isObj(r) && 'settings' in r) cfg.transitions[k].settings = isObj(r.settings) ? r.settings : null
    }
    if (raw.transitions.crossGroupMode === 'blackBridge') cfg.transitions.crossGroupMode = 'blackBridge'
  }

  // Presets: id -> { label, x, y | clicks }
  if (isObj(raw.presets)) {
    const p: Record<string, PresetCfg> = {}
    for (const [id, v] of Object.entries(raw.presets)) {
      if (!isObj(v)) continue
      const preset: PresetCfg = { label: typeof v.label === 'string' ? v.label : id }
      const x = Number(v.x)
      const y = Number(v.y)
      if (Number.isFinite(x) && Number.isFinite(y) && v.x !== null && v.y !== null && v.x !== '' && v.y !== '') {
        preset.x = Math.round(x)
        preset.y = Math.round(y)
      }
      if (Array.isArray(v.clicks)) {
        preset.clicks = []
        for (const c of v.clicks) {
          const pt = toPoint(c)
          if (!pt) continue
          preset.clicks.push({ ...pt, ...(Number.isFinite(Number(c.delayMs)) && c.delayMs !== null ? { delayMs: Number(c.delayMs) } : {}), ...(c.space === 'client' || c.space === 'screen' ? { space: c.space } : {}) })
        }
      }
      p[id] = preset
    }
    cfg.presets = p
  }

  // Scenes: name -> preset id (anything unknown is dropped with a warning)
  if (isObj(raw.scenes)) {
    const s: Record<string, string> = {}
    for (const [name, id] of Object.entries(raw.scenes)) {
      if (typeof id !== 'string' || id === '') continue
      if (!(id in cfg.presets)) {
        warnings.push(`Scene '${name}' points to unknown preset '${id}' - ignored.`)
        continue
      }
      s[name] = id
    }
    cfg.scenes = s
  }

  if (isObj(raw.sceneTracking)) {
    const t: Record<string, boolean> = {}
    for (const [name, on] of Object.entries(raw.sceneTracking)) if (on === true) t[name] = true
    cfg.sceneTracking = t
  }

  if (isObj(raw.tracking)) {
    const t = raw.tracking
    cfg.tracking = {
      enabled: t.enabled === true,
      enableClick: toPoint(t.enableClick),
      disableClick: toPoint(t.disableClick),
      assumeInitiallyOn: t.assumeInitiallyOn === true,
      delayAfterPresetMs: Number.isFinite(Number(t.delayAfterPresetMs)) ? Math.max(0, Number(t.delayAfterPresetMs)) : def.tracking.delayAfterPresetMs
    }
  }

  // Sanity clamps
  const nonNeg = (n: number, fallback: number) => (Number.isFinite(n) && n >= 0 ? n : fallback)
  cfg.transitions.intraGroup.durationMs = nonNeg(cfg.transitions.intraGroup.durationMs, 1000)
  cfg.transitions.crossGroup.durationMs = nonNeg(cfg.transitions.crossGroup.durationMs, 1000)
  cfg.ptz.fireOffsetMs = nonNeg(cfg.ptz.fireOffsetMs, 200)
  cfg.blackBridge.holdMs = nonNeg(cfg.blackBridge.holdMs, 3000)
  if (!['Debug', 'Info', 'Warn', 'Error'].includes(cfg.logging.level)) cfg.logging.level = 'Debug'
  if (!['fast', 'blackBridge'].includes(cfg.transitions.crossGroupMode)) cfg.transitions.crossGroupMode = 'fast'
  if (!['screen', 'client'].includes(cfg.emeet.coordSpace)) cfg.emeet.coordSpace = 'screen'

  return { config: cfg, warnings }
}

export function obsUri(cfg: AppConfig): string {
  return `ws://${cfg.obs.host || 'localhost'}:${cfg.obs.port || 4455}`
}

/** Resolve the click list for a preset (clicks[] wins over x/y). Empty = not configured. */
export function presetClicks(p: PresetCfg | undefined) {
  if (!p) return []
  if (p.clicks && p.clicks.length) return p.clicks
  if (typeof p.x === 'number' && typeof p.y === 'number') return [{ x: p.x, y: p.y }]
  return []
}
