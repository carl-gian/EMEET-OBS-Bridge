import { describe, expect, it } from 'vitest'
import { defaultConfig } from '@core/defaults'
import { buildGroupMap, decide, normalizeSceneKey, resolveGroup } from '@core/decision'
import { normalizeConfig, obsUri } from '@core/config'

const cfg = defaultConfig()
const { map } = buildGroupMap(cfg)
const FULL = 'FULL STAGE----------(For Prayers and Switching Speaker)'
const CLOSE = 'CLOSE UP----------(For talks only)'
const READER = 'READER SETUP---------- (Watchtower & CBS)'

describe('normalizeSceneKey', () => {
  it('ignores whitespace, case and unicode dashes', () => {
    expect(normalizeSceneKey('TABLE ----------- (For Standing)')).toBe(normalizeSceneKey('table\u2014----------(for  standing)'))
  })
})

describe('decide', () => {
  it('same preset = intra group', () => {
    const d = decide(cfg, map, FULL, CLOSE)
    expect(d.isCrossGroup).toBe(false)
    expect(d.key).toBe('intraGroup')
  })
  it('different preset = cross group with target group', () => {
    const d = decide(cfg, map, FULL, READER)
    expect(d.isCrossGroup).toBe(true)
    expect(d.targetGroup).toBe('Preset2')
    expect(d.durationMs).toBe(1000)
  })
  it('unmapped scene is intra', () => {
    expect(decide(cfg, map, FULL, 'Some Other Scene').isCrossGroup).toBe(false)
    expect(resolveGroup(map, 'Some Other Scene')).toBeNull()
  })
  it('unknownScenePolicy=cross', () => {
    const c = { ...cfg, behavior: { ...cfg.behavior, unknownScenePolicy: 'cross' as const } }
    expect(decide(c, map, FULL, 'Unmapped').isCrossGroup).toBe(true)
  })
})

describe('normalizeConfig', () => {
  it('imports the old PowerShell layout (obs.uri, comments, obsolete delayMs)', () => {
    const { config } = normalizeConfig({
      _help: 'x',
      obs: { uri: 'ws://127.0.0.1:4466', password: 'pw' },
      ptz: { enabled: true, delayMs: 100, fireOffsetMs: 250 },
      scenes: { A: 'Preset1', B: 'PresetNope' }
    })
    expect(config.obs.host).toBe('127.0.0.1')
    expect(config.obs.port).toBe(4466)
    expect(config.obs.password).toBe('pw')
    expect(config.ptz.fireOffsetMs).toBe(250)
    expect((config.ptz as any).delayMs).toBeUndefined()
    expect(config.scenes).toEqual({ A: 'Preset1' })
    expect(obsUri(config)).toBe('ws://127.0.0.1:4466')
  })
  it('garbage in -> defaults out', () => {
    expect(normalizeConfig(null).config.presets.Preset1.x).toBe(929)
    expect(normalizeConfig(null).config.presetCount).toBe(3)
    expect(normalizeConfig({ ptz: { fireOffsetMs: 'abc' } }).config.ptz.fireOffsetMs).toBe(0)
  })
})

describe('config migration', () => {
  it('shows at least the presets that scenes use, always keeps all 8 coordinates', () => {
    const { config } = normalizeConfig({ scenes: { A: 'Preset5' }, presets: { Preset1: { label: 'X', x: 1, y: 2 } } })
    expect(config.presetCount).toBe(5)
    expect(Object.keys(config.presets)).toHaveLength(8)
    expect(config.presets.Preset8.x).toBe(1222)
    expect(config.presets.Preset1.x).toBe(1)
  })
  it('old 200 ms offset becomes 0 once; Black Bridge settings become Seamless; unknown options vanish', () => {
    const { config, warnings } = normalizeConfig({
      ptz: { fireOffsetMs: 200 },
      transitions: { crossGroupMode: 'blackBridge' },
      blackBridge: { sceneName: 'BLK', holdMs: 2500 },
      general: { someRemovedOption: true, obsPath: 'C:\\obs.exe' }
    })
    expect(config.ptz.fireOffsetMs).toBe(0)
    expect(warnings.some((w) => /200 ms to 0 ms/.test(w))).toBe(true)
    expect(config.transitions.crossGroupMode).toBe('seamless')
    expect(config.seamless).toMatchObject({ sceneName: 'BLK', holdMs: 2500, fadeToBlackMs: 800, fadeInMs: 800 })
    expect((config.general as any).someRemovedOption).toBeUndefined()
    expect(normalizeConfig({ configVersion: 2, ptz: { fireOffsetMs: 200 } }).config.ptz.fireOffsetMs).toBe(200)
  })
  it('EMEET Studio path defaults in, and the launch/start-up switches are OFF by default', () => {
    const d = defaultConfig()
    expect(d.emeet.exePath).toBe('C:\\Program Files\\EMEET STUDIO\\bin\\64bit\\EMEET STUDIO.exe')
    expect(d.emeet.launchOnStart).toBe(false)
    expect(d.general.startWithWindows).toBe(false)
    // an older config with an empty path gets the default once; a path the owner chose is kept
    expect(normalizeConfig({ configVersion: 2, emeet: { exePath: '' } }).config.emeet.exePath).toBe(d.emeet.exePath)
    expect(normalizeConfig({ configVersion: 2, emeet: { exePath: 'D:\\E.exe' } }).config.emeet.exePath).toBe('D:\\E.exe')
  })
})
