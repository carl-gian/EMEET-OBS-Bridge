import type { AppConfig } from '@shared/types'
import { compareVersions } from '@shared/changelog'

/** The transition our OBS plugin adds (see obs-plugin/src/hold-transition.c). */
export const PLUGIN_KIND = 'emeet_bridge_hold_transition'
export const PLUGIN_TRANSITION_NAME = 'EMEET Bridge Seamless'
/** Folder name of the plugin inside OBS's plugin folder. */
export const PLUGIN_FOLDER = 'emeet-bridge-transition'

/** In Seamless Mode the "different preset" transition IS our OBS plugin, when the plugin is usable. Otherwise the config is returned unchanged (Fast Mode). */
export function withPlugin(cfg: AppConfig, usable: boolean): AppConfig {
  if (cfg.transitions.crossGroupMode !== 'seamless' || !usable) return cfg
  const p = cfg.plugin
  return {
    ...cfg,
    transitions: {
      ...cfg.transitions,
      crossGroup: {
        name: PLUGIN_TRANSITION_NAME,
        kind: PLUGIN_KIND,
        durationMs: pluginTotalMs(cfg), // the plugin sets OBS's duration itself; kept here for bookkeeping only
        settings: { image_path: p.imagePath, fade_ms: p.fadeMs, hold_ms: p.holdMs }
      }
    },
    // the camera clicks once the picture fully covers the screen (the end of the first fade)
    ptz: { ...cfg.ptz, fireOffsetMs: p.fadeMs }
  }
}

/** Fade + hold + fade, in ms. */
export function pluginTotalMs(cfg: AppConfig): number {
  return 2 * cfg.plugin.fadeMs + cfg.plugin.holdMs
}

// ------------------------------------------------------------------ version contract ----

/** plugin.json, shipped next to the plugin's DLL. */
export interface InstalledPlugin {
  schema: number
  plugin: string // plugin version
  obs: string // the OBS version it was built for
  kind: string
  minBridge: string
  layout: string
}

/** plugin-manifest.json, published with each plugin release: the ONE current plugin build. */
export interface PluginManifest {
  schema: number
  plugin: string
  obs: string
  url: string
  sha256: string
  layout: string
  minBridge: string
  file: string
}

export type PluginStatus =
  | 'unknown' // OBS not connected, so nothing can be judged yet
  | 'not-installed' // no plugin files on this PC
  | 'needs-transition' // plugin loaded in OBS, but nobody added the transition in OBS's Scene Transitions panel
  | 'restart-obs' // files are installed but OBS has not loaded the plugin yet
  | 'ready' // OBS version matches, plugin loaded, transition present
  | 'update-available' // a newer plugin build exists for this OBS
  | 'obs-newer' // OBS is newer than the plugin was built for: go back, or accept the risk
  | 'obs-older' // OBS is older than the plugin was built for: update OBS (forward-only rule)
  | 'risk-accepted' // mismatch, but the user chose to carry on for this OBS version
  | 'bridge-too-old' // the newest plugin needs a newer Bridge

export interface PluginFacts {
  obsVersion: string // '' when OBS is not connected
  installed: InstalledPlugin | null
  manifest: PluginManifest | null
  kindLoaded: boolean // OBS lists our transition kind (plugin loaded)
  instanceFound: boolean // a transition of our kind exists in OBS's Scene Transitions panel
  riskAcceptedObs: string // OBS version the user accepted the risk for ('' = none)
  bridgeVersion: string
}

export interface PluginDecision {
  status: PluginStatus
  /** Safe to use the plugin transition right now. */
  usable: boolean
}

/**
 * The single place that decides what to tell the user and whether the plugin transition may be used.
 * Rules (owner's): only the latest stable OBS is supported; the plugin is built for exactly one OBS version;
 * we only ever move forward to a plugin built for a newer OBS, never patch the plugin of an older one.
 */
export function decidePluginState(f: PluginFacts): PluginDecision {
  const no = (status: PluginStatus): PluginDecision => ({ status, usable: false })
  const ok = (status: PluginStatus): PluginDecision => ({ status, usable: true })

  if (!f.installed) {
    if (f.manifest && compareVersions(f.manifest.minBridge, f.bridgeVersion) > 0) return no('bridge-too-old')
    return no('not-installed')
  }
  if (!f.obsVersion) return no('unknown')

  const sameObs = compareVersions(f.obsVersion, f.installed.obs) === 0
  const manifestFitsObs = !!f.manifest && compareVersions(f.manifest.obs, f.obsVersion) === 0
  const manifestNewer = !!f.manifest && compareVersions(f.manifest.plugin, f.installed.plugin) > 0
  const manifestUsable = !!f.manifest && compareVersions(f.manifest.minBridge, f.bridgeVersion) <= 0

  // A newer plugin exists for the OBS we are running now: that is the way forward.
  if (manifestFitsObs && manifestNewer && (!sameObs || manifestUsable)) {
    if (!manifestUsable) return no('bridge-too-old')
    // Still usable meanwhile if the installed one matches this OBS and is loaded.
    return { status: 'update-available', usable: sameObs && f.kindLoaded && f.instanceFound }
  }

  if (!sameObs) {
    const newer = compareVersions(f.obsVersion, f.installed.obs) > 0
    if (f.riskAcceptedObs === f.obsVersion && f.kindLoaded && f.instanceFound) return ok('risk-accepted')
    return no(newer ? 'obs-newer' : 'obs-older')
  }

  if (!f.kindLoaded) return no('restart-obs')
  if (!f.instanceFound) return no('needs-transition')
  return ok('ready')
}

// ------------------------------------------------------------------ parsing helpers (pure, unit-tested) ----

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown) => (typeof v === 'string' ? v : '')
const isVersion = (v: string) => /^\d+\.\d+\.\d+/.test(v)

export function parseInstalled(raw: unknown): InstalledPlugin | null {
  if (!isObj(raw)) return null
  const p: InstalledPlugin = { schema: Number(raw.schema) || 0, plugin: str(raw.plugin), obs: str(raw.obs), kind: str(raw.kind), minBridge: str(raw.minBridge) || '0.0.0', layout: str(raw.layout) || 'legacy' }
  return p.schema === 1 && isVersion(p.plugin) && isVersion(p.obs) && p.kind === PLUGIN_KIND ? p : null
}

export function parseManifest(raw: unknown): PluginManifest | null {
  if (!isObj(raw)) return null
  const m: PluginManifest = {
    schema: Number(raw.schema) || 0,
    plugin: str(raw.plugin),
    obs: str(raw.obs),
    url: str(raw.url),
    sha256: str(raw.sha256).toLowerCase(),
    layout: str(raw.layout) || 'legacy',
    minBridge: str(raw.minBridge) || '0.0.0',
    file: str(raw.file)
  }
  const goodUrl = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/releases\/download\//.test(m.url)
  return m.schema === 1 && isVersion(m.plugin) && isVersion(m.obs) && goodUrl && /^[0-9a-f]{64}$/.test(m.sha256) ? m : null
}

export interface GithubRelease {
  tag_name: string
  draft?: boolean
  assets?: { name: string; browser_download_url: string }[]
}

/** The newest `plugin-<version>` release that has a plugin-manifest.json asset, or null. */
export function pickLatestPluginRelease(releases: GithubRelease[]): { version: string; manifestUrl: string } | null {
  let best: { version: string; manifestUrl: string } | null = null
  for (const r of releases) {
    if (r.draft || !r.tag_name.startsWith('plugin-')) continue
    const version = r.tag_name.slice('plugin-'.length)
    const asset = (r.assets ?? []).find((a) => a.name === 'plugin-manifest.json')
    if (!isVersion(version) || !asset) continue
    if (!best || compareVersions(version, best.version) > 0) best = { version, manifestUrl: asset.browser_download_url }
  }
  return best
}
