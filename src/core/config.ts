import type { AppConfig, Point, PresetCfg } from '@shared/types'
import { DEFAULT_EMEET_EXE, defaultConfig } from './defaults'
import { DEFAULT_PRESETS, MAX_PRESETS, MIN_PRESETS, presetNumber } from '@shared/presets'

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

  for (const section of ['general', 'obs', 'transitions', 'plugin', 'ptz', 'emeet', 'behavior', 'logging'] as const) {
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
  }

  // Presets: always Preset1..Preset8. Anything the file doesn't define comes from the preloaded defaults.
  if (isObj(raw.presets)) {
    for (const [id, v] of Object.entries(raw.presets)) {
      if (!isObj(v)) continue
      if (!(id in DEFAULT_PRESETS)) {
        warnings.push(`Preset '${id}' is not one of Preset1..Preset${MAX_PRESETS} - ignored.`)
        continue
      }
      const preset: PresetCfg = { label: typeof v.label === 'string' ? v.label : DEFAULT_PRESETS[id].label }
      const x = Number(v.x)
      const y = Number(v.y)
      if (Number.isFinite(x) && Number.isFinite(y) && v.x !== null && v.y !== null && v.x !== '' && v.y !== '') {
        preset.x = Math.round(x)
        preset.y = Math.round(y)
      } else {
        preset.x = DEFAULT_PRESETS[id].x
        preset.y = DEFAULT_PRESETS[id].y
      }
      if (Array.isArray(v.clicks)) {
        preset.clicks = []
        for (const c of v.clicks) {
          const pt = toPoint(c)
          if (!pt) continue
          preset.clicks.push({ ...pt, ...(Number.isFinite(Number(c.delayMs)) && c.delayMs !== null ? { delayMs: Number(c.delayMs) } : {}), ...(c.space === 'client' || c.space === 'screen' ? { space: c.space } : {}) })
        }
      }
      cfg.presets[id] = preset
    }
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

  // How many presets are shown: saved value, but never fewer than the highest preset a scene uses (and 3..8).
  const highestUsed = Math.max(0, ...Object.values(cfg.scenes).map(presetNumber))
  const savedCount = Number(raw.presetCount)
  cfg.presetCount = Math.min(MAX_PRESETS, Math.max(MIN_PRESETS, Number.isFinite(savedCount) ? Math.round(savedCount) : MIN_PRESETS, highestUsed))

  // Version 2: Fast Mode fires the click immediately (was 200 ms). Carry old default forward once.
  const fromVersion = Number(raw.configVersion) || 1
  if (fromVersion < 2 && isObj(raw.ptz) && Number(raw.ptz.fireOffsetMs) === 200) {
    cfg.ptz.fireOffsetMs = 0
    warnings.push('Settings updated: Fast Mode camera click offset changed from 200 ms to 0 ms (immediate). You can change it in Settings > Transition Rules.')
  }
  // Version 3: EMEET Studio path has a default (older configs had it empty).
  if (fromVersion < 3 && !cfg.emeet.exePath) cfg.emeet.exePath = DEFAULT_EMEET_EXE
  // Version 4: Seamless Mode is now the OBS plugin transition. The old holding-scene settings are gone; keep the picture if there was one.
  if (fromVersion < 4 && isObj(raw.seamless) && typeof raw.seamless.cardImage === 'string' && !cfg.plugin.imagePath) cfg.plugin.imagePath = raw.seamless.cardImage
  cfg.configVersion = 4

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
  cfg.ptz.verifyAfterMs = Math.min(10000, nonNeg(cfg.ptz.verifyAfterMs, 600))
  cfg.emeet.presetClickCount = Math.min(10, Math.max(1, Math.round(nonNeg(cfg.emeet.presetClickCount, 5))))
  cfg.emeet.presetClickGapMs = Math.min(2000, Math.max(100, nonNeg(cfg.emeet.presetClickGapMs, 300)))
  cfg.plugin.fadeMs = Math.min(10000, nonNeg(cfg.plugin.fadeMs, 800))
  cfg.plugin.holdMs = Math.min(60000, nonNeg(cfg.plugin.holdMs, 3500))
  if (typeof cfg.plugin.imagePath !== 'string') cfg.plugin.imagePath = ''
  if (typeof cfg.plugin.riskAcceptedObs !== 'string') cfg.plugin.riskAcceptedObs = ''
  if (!['Debug', 'Info', 'Warn', 'Error'].includes(cfg.logging.level)) cfg.logging.level = 'Debug'
  if (!['fast', 'seamless'].includes(cfg.transitions.crossGroupMode)) cfg.transitions.crossGroupMode = 'fast'
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
