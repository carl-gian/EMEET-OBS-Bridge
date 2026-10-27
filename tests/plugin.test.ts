import { describe, expect, it } from 'vitest'
import { decidePluginState, parseInstalled, parseManifest, pickLatestPluginRelease, withPlugin, pluginTotalMs, PLUGIN_KIND, type PluginFacts } from '@core/plugin'
import { defaultConfig } from '@core/defaults'

const installed = { schema: 1, plugin: '1.0.1', obs: '32.2.2', kind: PLUGIN_KIND, minBridge: '1.1.0', layout: 'legacy' }
const manifest = { schema: 1, plugin: '1.0.1', obs: '32.2.2', url: 'https://github.com/o/r/releases/download/plugin-1.0.1/x.zip', sha256: 'a'.repeat(64), layout: 'legacy', minBridge: '1.1.0', file: 'x.zip' }
const facts = (over: Partial<PluginFacts> = {}): PluginFacts => ({
  obsVersion: '32.2.2',
  installed,
  manifest,
  kindLoaded: true,
  instanceFound: true,
  riskAcceptedObs: '',
  bridgeVersion: '1.1.0',
  ...over
})
const status = (over: Partial<PluginFacts> = {}) => decidePluginState(facts(over)).status

describe('decidePluginState (the version contract)', () => {
  it('ready when OBS matches and the plugin is loaded', () => {
    expect(decidePluginState(facts())).toEqual({ status: 'ready', usable: true })
  })
  it('not installed (and not usable)', () => {
    expect(decidePluginState(facts({ installed: null }))).toEqual({ status: 'not-installed', usable: false })
  })
  it('bridge too old for the newest plugin when nothing is installed', () => {
    expect(status({ installed: null, manifest: { ...manifest, minBridge: '2.0.0' } })).toBe('bridge-too-old')
  })
  it('unknown while OBS is not connected', () => {
    expect(status({ obsVersion: '' })).toBe('unknown')
  })
  it('installed but not loaded yet: restart OBS', () => {
    expect(status({ kindLoaded: false })).toBe('restart-obs')
  })
  it('loaded but nobody added the transition in OBS', () => {
    expect(status({ instanceFound: false })).toBe('needs-transition')
  })
  it('OBS newer than the plugin: go back or accept the risk, never usable by default', () => {
    expect(decidePluginState(facts({ obsVersion: '32.3.0' }))).toEqual({ status: 'obs-newer', usable: false })
  })
  it('OBS older than the plugin: update OBS (forward-only)', () => {
    expect(decidePluginState(facts({ obsVersion: '32.1.0' }))).toEqual({ status: 'obs-older', usable: false })
  })
  it('risk accepted applies to that OBS version only', () => {
    expect(decidePluginState(facts({ obsVersion: '32.3.0', riskAcceptedObs: '32.3.0' }))).toEqual({ status: 'risk-accepted', usable: true })
    expect(status({ obsVersion: '32.4.0', riskAcceptedObs: '32.3.0' })).toBe('obs-newer')
  })
  it('risk accepted still needs the plugin loaded and the transition present', () => {
    expect(decidePluginState(facts({ obsVersion: '32.3.0', riskAcceptedObs: '32.3.0', kindLoaded: false })).usable).toBe(false)
  })
  it('a newer plugin for this OBS: update available, current one stays usable meanwhile', () => {
    const m = { ...manifest, plugin: '1.0.2' }
    expect(decidePluginState(facts({ manifest: m }))).toEqual({ status: 'update-available', usable: true })
  })
  it('OBS moved forward and a plugin for it exists: update is the way forward (old plugin not usable)', () => {
    const m = { ...manifest, plugin: '1.1.0', obs: '32.3.0' }
    expect(decidePluginState(facts({ obsVersion: '32.3.0', manifest: m }))).toEqual({ status: 'update-available', usable: false })
  })
  it('a newer plugin that needs a newer Bridge is reported, the installed one keeps working', () => {
    const m = { ...manifest, plugin: '1.0.2', minBridge: '9.0.0' }
    expect(status({ manifest: m })).toBe('ready')
    expect(status({ obsVersion: '32.3.0', manifest: { ...m, obs: '32.3.0' } })).toBe('bridge-too-old')
  })
  it('works without a manifest (GitHub unreachable)', () => {
    expect(status({ manifest: null })).toBe('ready')
  })
})

describe('plugin files and releases', () => {
  it('parses plugin.json and the manifest, rejecting bad ones', () => {
    expect(parseInstalled(installed)).toEqual(installed)
    expect(parseInstalled({ ...installed, kind: 'other' })).toBeNull()
    expect(parseInstalled(null)).toBeNull()
    expect(parseManifest(manifest)).toMatchObject({ plugin: '1.0.1', obs: '32.2.2' })
    expect(parseManifest({ ...manifest, url: 'http://evil.example/x.zip' })).toBeNull()
    expect(parseManifest({ ...manifest, sha256: 'xyz' })).toBeNull()
  })
  it('picks the newest plugin-* release that has a manifest, ignoring app releases and drafts', () => {
    const asset = (v: string) => [{ name: 'plugin-manifest.json', browser_download_url: `https://github.com/o/r/releases/download/plugin-${v}/plugin-manifest.json` }]
    const picked = pickLatestPluginRelease([
      { tag_name: 'v1.0.4', assets: [] },
      { tag_name: 'plugin-1.0.1', assets: asset('1.0.1') },
      { tag_name: 'plugin-1.0.10', assets: asset('1.0.10') },
      { tag_name: 'plugin-1.0.9', draft: true, assets: asset('1.0.9') },
      { tag_name: 'plugin-1.1.0', assets: [] }
    ])
    expect(picked?.version).toBe('1.0.10')
    expect(pickLatestPluginRelease([{ tag_name: 'v1.0.4' }])).toBeNull()
  })
})

describe('withPlugin (Seamless Mode overlay)', () => {
  const seamless = () => {
    const c = defaultConfig()
    c.transitions.crossGroupMode = 'seamless'
    c.plugin.imagePath = 'C:\\data\\card.png'
    return c
  }
  it('uses the plugin transition with the picture and times, and clicks the camera at the end of the first fade', () => {
    const c = withPlugin(seamless(), true)
    expect(c.transitions.crossGroup.kind).toBe(PLUGIN_KIND)
    expect(c.transitions.crossGroup.settings).toEqual({ image_path: 'C:\\data\\card.png', fade_ms: 800, hold_ms: 3500 })
    expect(c.ptz.fireOffsetMs).toBe(800)
    expect(pluginTotalMs(seamless())).toBe(5100)
  })
  it('does nothing in Fast Mode, or when the plugin is not usable', () => {
    const fast = defaultConfig()
    expect(withPlugin(fast, true)).toBe(fast)
    const s = seamless()
    expect(withPlugin(s, false)).toBe(s)
  })
})
