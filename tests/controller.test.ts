import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Controller } from '@core/controller'
import { defaultConfig } from '@core/defaults'
import type { AppConfig, PtzCommand } from '@shared/types'
import type { ObsLink } from '@core/types'

const FULL = 'FULL STAGE----------(For Prayers and Switching Speaker)'
const CLOSE = 'CLOSE UP----------(For talks only)'
const READER = 'READER SETUP---------- (Watchtower & CBS)'
const TABLE = 'TABLE ----------- (For Standing)'
const BLACK = 'BLACK SCREEN'

function setup(mutate?: (c: AppConfig) => void) {
  const cfg = defaultConfig()
  cfg.emeet.presetClickCount = 1 // most tests look at a single press; the repeat has its own test below
  cfg.ptz.verifyAfterMs = 0 // and the verification press has its own test too
  mutate?.(cfg)
  const sent: PtzCommand[] = []
  const calls: { type: string; data?: any }[] = []
  const batches: any[][] = []
  const logs: string[] = []
  let program = FULL
  const flags = { plugin: true, pluginUsable: false }
  const obs: ObsLink = {
    async call(type, data) {
      calls.push({ type, data })
      switch (type) {
        case 'GetVersion': return { obsVersion: '32', obsWebSocketVersion: '5.7.4' }
        case 'GetStudioModeEnabled': return { studioModeEnabled: true }
        case 'GetSceneList': return { scenes: [FULL, CLOSE, READER, TABLE].map((n, i) => ({ sceneName: n, sceneIndex: i })) }
        case 'GetTransitionKindList': return { transitionKinds: ['cut_transition', 'fade_transition', ...(flags.plugin ? ['emeet_bridge_hold_transition'] : [])] }
        case 'GetSceneTransitionList': return { transitions: [{ transitionName: 'Fade', transitionKind: 'fade_transition' }, { transitionName: 'Fade to Black', transitionKind: 'fade_to_color_transition' }, ...(flags.plugin ? [{ transitionName: 'My Seamless', transitionKind: 'emeet_bridge_hold_transition' }] : [])] }
        case 'GetCurrentSceneTransition': return { transitionName: 'Fade', transitionKind: 'fade_transition', transitionDuration: 1000 }
        case 'GetSceneSceneTransitionOverride': return {}
        case 'GetCurrentProgramScene': return { currentProgramSceneName: program }
        case 'GetCurrentPreviewScene': return { currentPreviewSceneName: FULL }
        default: return {}
      }
    },
    async batch(reqs) { batches.push(reqs); return reqs.map((r) => ({ requestType: r.requestType, requestStatus: { result: true, code: 100 } })) }
  }
  const log = { debug: (m: string) => logs.push(m), info: (m: string) => logs.push(m), warn: (m: string) => logs.push(m), error: (m: string) => logs.push(m) }
  const c = new Controller({ obs, ptzSink: { send: (cmd) => sent.push(cmd) }, ptzLog: log, log, getConfig: () => cfg, getPluginUsable: () => flags.pluginUsable })
  return { c, cfg, sent, calls, batches, logs, flags, setProgram: (s: string) => (program = s) }
}

const flush = () => vi.advanceTimersByTimeAsync(0)

describe('Controller - Fast Mode', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('startup primes the intra transition and clears nothing when there are no overrides', async () => {
    const t = setup()
    await t.c.initSession()
    expect(t.c.programScene).toBe(FULL)
    expect(t.sent).toHaveLength(0)
  })

  it('cross-group: primes Fade to Black, early-fires the camera at +200 ms when an offset is set, confirm does not double-click', async () => {
    const t = setup((c) => (c.ptz.fireOffsetMs = 200))
    await t.c.initSession()
    await flush()
    t.c.handleEvent('CurrentPreviewSceneChanged', { sceneName: READER })
    await flush()
    const prime = t.batches.at(-1)!
    expect(prime[0].requestData.transitionName).toBe('Fade to Black')
    expect(prime[1].requestData.transitionDuration).toBe(1000)
    expect(prime.some((r) => r.requestType === 'SetCurrentSceneTransitionSettings')).toBe(false) // sent on its own, after the switch
    await vi.advanceTimersByTimeAsync(200)
    expect(t.calls.some((c) => c.type === 'SetCurrentSceneTransitionSettings')).toBe(true)

    const t0 = Date.now()
    t.c.handleEvent('SceneTransitionStarted', { transitionName: 'Fade to Black' })
    expect(t.sent).toHaveLength(1)
    expect(t.sent[0].presetId).toBe('Preset2')
    expect(t.sent[0].fireAt! - t0).toBe(200)

    t.c.handleEvent('CurrentProgramSceneChanged', { sceneName: READER })
    t.c.handleEvent('SceneTransitionEnded', { transitionName: 'Fade to Black' })
    await flush()
    expect(t.sent).toHaveLength(1) // dedupe
  })

  it('default Fast Mode fires immediately (no schedule) as soon as the transition starts', async () => {
    const t = setup()
    await t.c.initSession()
    t.c.handleEvent('CurrentPreviewSceneChanged', { sceneName: READER })
    t.c.handleEvent('SceneTransitionStarted', { transitionName: 'Fade to Black' })
    expect(t.sent).toHaveLength(1)
    expect(t.sent[0].presetId).toBe('Preset2')
    expect(t.sent[0].fireAt).toBeUndefined()
  })

  it('intra-group switch never clicks', async () => {
    const t = setup()
    await t.c.initSession()
    t.c.handleEvent('CurrentProgramSceneChanged', { sceneName: TABLE })
    t.c.handleEvent('CurrentProgramSceneChanged', { sceneName: FULL }) // camera is now on Preset1
    const before = t.sent.length
    t.c.handleEvent('CurrentPreviewSceneChanged', { sceneName: CLOSE })
    t.c.handleEvent('SceneTransitionStarted', { transitionName: 'Fade' })
    t.c.handleEvent('CurrentProgramSceneChanged', { sceneName: CLOSE })
    t.c.handleEvent('SceneTransitionEnded', { transitionName: 'Fade' })
    await flush()
    expect(t.sent).toHaveLength(before)
  })

  it('another program sets Program directly (stale preview): quick-fire clicks immediately with the right preset', async () => {
    const t = setup()
    await t.c.initSession()
    t.c.handleEvent('CurrentProgramSceneChanged', { sceneName: TABLE })
    expect(t.sent).toHaveLength(1)
    expect(t.sent[0].presetId).toBe('Preset3')
    expect(t.sent[0].fireAt).toBeUndefined()
  })

  it('wrong early guess is corrected', async () => {
    const t = setup()
    await t.c.initSession()
    t.c.handleEvent('CurrentPreviewSceneChanged', { sceneName: READER })
    t.c.handleEvent('SceneTransitionStarted', { transitionName: 'Fade to Black' }) // early -> Preset2
    t.c.handleEvent('CurrentProgramSceneChanged', { sceneName: TABLE }) // real target
    expect(t.sent.map((s) => s.presetId)).toEqual(['Preset2', 'Preset3'])
  })

  it('transition with no program-change event: verified on transition end', async () => {
    const t = setup()
    await t.c.initSession()
    t.c.handleEvent('CurrentPreviewSceneChanged', { sceneName: READER })
    t.c.handleEvent('SceneTransitionStarted', { transitionName: 'Fade to Black' })
    t.setProgram(TABLE)
    t.c.handleEvent('SceneTransitionEnded', { transitionName: 'Fade to Black' })
    await flush()
    expect(t.sent.map((s) => s.presetId)).toEqual(['Preset2', 'Preset3'])
  })

  it('Transition pressed with Program == Preview forces a manual resync even when deduped', async () => {
    const t = setup()
    await t.c.initSession()
    t.c.handleEvent('CurrentProgramSceneChanged', { sceneName: TABLE }) // camera now Preset3
    t.c.handleEvent('CurrentPreviewSceneChanged', { sceneName: TABLE })
    t.c.handleEvent('SceneTransitionStarted', { transitionName: 'Fade' })
    expect(t.sent.map((s) => s.presetId)).toEqual(['Preset3', 'Preset3'])
  })

  it('rapid back-and-forth does not double click', async () => {
    const t = setup()
    await t.c.initSession()
    for (const s of [READER, TABLE, READER, READER]) t.c.handleEvent('CurrentProgramSceneChanged', { sceneName: s })
    expect(t.sent.map((x) => x.presetId)).toEqual(['Preset2', 'Preset3', 'Preset2'])
  })

  it('dry run sends nothing to the camera or OBS', async () => {
    const t = setup()
    await t.c.initSession()
    t.c.dryRun = true
    const before = t.batches.length
    t.c.handleEvent('CurrentProgramSceneChanged', { sceneName: TABLE })
    t.c.handleEvent('CurrentPreviewSceneChanged', { sceneName: READER })
    await flush()
    expect(t.sent).toHaveLength(0)
    expect(t.batches.length).toBe(before)
  })
})

describe('Tracking', () => {
  it('per-scene tracking: ON clicked after the preset click, OFF when leaving, nothing extra when no scene wants it', async () => {
    const t = setup((c) => {
      c.tracking.enabled = true
      c.tracking.enableClick = { x: 10, y: 20 }
      c.tracking.disableClick = { x: 30, y: 40 }
      c.tracking.delayAfterPresetMs = 500
      c.sceneTracking = { [READER]: true }
    })
    await t.c.initSession()
    t.c.handleEvent('CurrentProgramSceneChanged', { sceneName: READER })
    expect(t.sent[0].clicks.map((k) => [k.x, k.y, k.delayMs ?? 0])).toEqual([[1025, 764, 0], [10, 20, 500]])
    t.c.handleEvent('CurrentProgramSceneChanged', { sceneName: TABLE })
    expect(t.sent[1].clicks.map((k) => [k.x, k.y])).toEqual([[1119, 765], [30, 40]])
    t.cfg.sceneTracking = {}
    t.c.handleEvent('CurrentProgramSceneChanged', { sceneName: READER })
    expect(t.sent[2].clicks).toHaveLength(1) // no scene wants tracking and it is already off: preset only
  })

  it('same-preset scenes still switch tracking', async () => {
    const t = setup((c) => {
      c.tracking.enabled = true
      c.tracking.enableClick = { x: 10, y: 20 } // toggle button (no separate disable)
      c.tracking.disableClick = null
      c.sceneTracking = { [CLOSE]: true }
    })
    await t.c.initSession()
    t.c.handleEvent('CurrentProgramSceneChanged', { sceneName: FULL }) // same as start: nothing
    t.c.handleEvent('CurrentProgramSceneChanged', { sceneName: CLOSE })
    expect(t.sent.at(-1)!.clicks.map((k) => [k.x, k.y])).toEqual([[929, 762], [10, 20]])
    t.c.handleEvent('CurrentProgramSceneChanged', { sceneName: FULL })
    expect(t.sent.at(-1)!.clicks.map((k) => [k.x, k.y])).toEqual([[10, 20]]) // toggled off, no preset click
  })
})

describe('Controller - Seamless Mode (OBS plugin)', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())
  const seamless = (c: AppConfig) => {
    c.transitions.crossGroupMode = 'seamless'
    c.plugin = { imagePath: 'C:\\data\\card.png', fadeMs: 800, holdMs: 3500, riskAcceptedObs: '' }
  }

  it('selects the plugin transition with the picture and times, sets no duration, and clicks the camera at the end of the first fade', async () => {
    const t = setup(seamless)
    t.flags.pluginUsable = true
    await t.c.initSession()
    await flush()
    t.c.handleEvent('CurrentPreviewSceneChanged', { sceneName: READER })
    await flush()
    const prime = t.batches.at(-1)!
    expect(prime[0].requestData.transitionName).toBe('My Seamless')
    expect(prime.some((r) => r.requestType === 'SetCurrentSceneTransitionDuration')).toBe(false)
    await vi.advanceTimersByTimeAsync(200)
    expect(t.calls.find((c) => c.type === 'SetCurrentSceneTransitionSettings')!.data.transitionSettings).toEqual({ image_path: 'C:\\data\\card.png', fade_ms: 800, hold_ms: 3500 })
    expect(t.c.pluginKindLoaded).toBe(true)
    expect(t.c.pluginInstanceFound).toBe(true)

    const t0 = Date.now()
    t.c.handleEvent('SceneTransitionStarted', { transitionName: 'My Seamless' })
    expect(t.sent).toHaveLength(1)
    expect(t.sent[0].presetId).toBe('Preset2')
    expect(t.sent[0].fireAt! - t0).toBe(800)
  })

  it('never touches OBS Preview or adds scenes (the operator keeps full control of what transitions)', async () => {
    const t = setup(seamless)
    t.flags.pluginUsable = true
    await t.c.initSession()
    await flush()
    t.c.handleEvent('CurrentPreviewSceneChanged', { sceneName: READER })
    await flush()
    expect(t.calls.some((c) => c.type === 'SetCurrentPreviewScene' || c.type === 'CreateScene' || c.type === 'CreateInput')).toBe(false)
  })

  it('falls back to Fast Mode while the plugin is not usable', async () => {
    const t = setup(seamless)
    t.flags.pluginUsable = false
    await t.c.initSession()
    await flush()
    t.c.handleEvent('CurrentPreviewSceneChanged', { sceneName: READER })
    await flush()
    expect(t.batches.at(-1)![0].requestData.transitionName).toBe('Fade to Black')
    expect(t.logs.some((l) => /Seamless Mode is selected but the OBS plugin is not ready/.test(l))).toBe(true)
  })

  it('reports whether OBS has the plugin loaded and the transition added', async () => {
    const t = setup(seamless)
    t.flags.plugin = false
    await t.c.initSession()
    expect(t.c.pluginKindLoaded).toBe(false)
    expect(t.c.pluginInstanceFound).toBe(false)
    t.flags.plugin = true
    await t.c.recheckPlugin()
    expect(t.c.pluginKindLoaded).toBe(true)
    expect(t.c.pluginInstanceFound).toBe(true)
    expect(t.c.pluginTransitionName).toBeNull() // only set once it is the resolved cross-group transition
  })
})

describe('Transition settings are applied after OBS has switched (606 race)', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('retries when OBS still answers 606 (still on the old transition) and succeeds once it has switched', async () => {
    const t = setup((c) => {
      c.transitions.crossGroupMode = 'seamless'
      c.plugin = { imagePath: 'C:\\data\\card.png', fadeMs: 800, holdMs: 3500, riskAcceptedObs: '' }
    })
    t.flags.pluginUsable = true
    let attempts = 0
    const realCall = (t.c as any).d.obs.call
    ;(t.c as any).d.obs.call = async (type: string, data: any) => {
      if (type === 'SetCurrentSceneTransitionSettings') {
        attempts++
        if (attempts < 3) throw Object.assign(new Error('The current transition does not support custom settings.'), { code: 606 })
      }
      return realCall(type, data)
    }
    await t.c.initSession()
    await flush()
    t.c.handleEvent('CurrentPreviewSceneChanged', { sceneName: READER })
    await vi.advanceTimersByTimeAsync(2000)
    expect(attempts).toBe(3)
    expect(t.logs.some((l) => /Transition settings applied/.test(l))).toBe(true)
  })
})

describe('Preset button is pressed several times, spread over the transition', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  const cross = (c: AppConfig) => {
    c.emeet.presetClickCount = 5
    c.ptz.fireOffsetMs = 0
  }
  const presses = (t: ReturnType<typeof setup>) => t.sent.filter((s) => s.presetId === 'Preset2')

  it('the first press goes with the command, the other 4 follow evenly until the transition ends', async () => {
    const t = setup(cross) // Fast Mode: 1000 ms fade
    await t.c.initSession()
    await flush()
    t.c.handleEvent('CurrentPreviewSceneChanged', { sceneName: READER })
    await flush()
    t.c.handleEvent('SceneTransitionStarted', { transitionName: 'Fade to Black' })
    expect(presses(t)).toHaveLength(1)
    expect(presses(t)[0].clicks).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(249)
    expect(presses(t)).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(2) // +250
    expect(presses(t)).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(800) // +500, +750, +1000
    expect(presses(t)).toHaveLength(5)
    expect(presses(t)[4].reason).toMatch(/press 5\/5/)
    await vi.advanceTimersByTimeAsync(5000)
    expect(presses(t)).toHaveLength(5) // never more
  })

  it('in Seamless Mode the presses are spread from the end of the first fade to the end of the transition', async () => {
    const t = setup((c) => {
      cross(c)
      c.transitions.crossGroupMode = 'seamless'
      c.plugin = { imagePath: '', fadeMs: 800, holdMs: 3500, riskAcceptedObs: '' } // 5100 ms in total
    })
    t.flags.pluginUsable = true
    await t.c.initSession()
    await flush()
    t.c.handleEvent('CurrentPreviewSceneChanged', { sceneName: READER })
    await flush()
    const t0 = Date.now()
    t.c.handleEvent('SceneTransitionStarted', { transitionName: 'My Seamless' })
    expect(t.sent[0].fireAt! - t0).toBe(800)
    // follow-ups: 4300 ms span / 4 gaps = 1075 ms apart, the last one at +800 + 4300 = 5100 ms
    await vi.advanceTimersByTimeAsync(800 + 1074)
    expect(presses(t)).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(2)
    expect(presses(t)).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(4300 - 1075 + 10)
    expect(presses(t)).toHaveLength(5)
  })

  it('a newer preset command cancels the presses that have not happened yet', async () => {
    const t = setup(cross)
    await t.c.initSession()
    await flush()
    t.c.handleEvent('CurrentProgramSceneChanged', { sceneName: READER }) // quick-fire: fixed 300 ms gap
    await vi.advanceTimersByTimeAsync(10)
    expect(presses(t)).toHaveLength(1)
    t.c.handleEvent('CurrentProgramSceneChanged', { sceneName: TABLE }) // a different preset now
    await vi.advanceTimersByTimeAsync(5000)
    expect(presses(t)).toHaveLength(1) // Preset 2 is never pressed again
    expect(t.sent.filter((s) => s.presetId === 'Preset3')).toHaveLength(5)
  })

  it('without a transition (Resync, other programs) the presses are presetClickGapMs apart', async () => {
    const t = setup((c) => {
      cross(c)
      c.emeet.presetClickGapMs = 300
    })
    await t.c.initSession()
    await flush()
    t.c.handleEvent('CurrentProgramSceneChanged', { sceneName: READER })
    await vi.advanceTimersByTimeAsync(299)
    expect(presses(t)).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(2)
    expect(presses(t)).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(1000)
    expect(presses(t)).toHaveLength(5)
  })

  it('tracking is clicked with the first press only', async () => {
    const t = setup((c) => {
      cross(c)
      c.tracking.enableClick = { x: 10, y: 20 }
      c.sceneTracking = { [READER]: true }
    })
    await t.c.initSession()
    t.c.handleEvent('CurrentProgramSceneChanged', { sceneName: READER })
    expect(t.sent[0].clicks.map((k) => [k.x, k.y])).toEqual([[1025, 764], [10, 20]])
    await vi.advanceTimersByTimeAsync(2000)
    expect(t.sent.slice(1).every((s) => s.clicks.length === 1 && s.clicks[0].x === 1025)).toBe(true)
  })

  it('the shipped default is 5 presses, 300 ms apart when there is no transition', () => {
    const d = defaultConfig()
    expect([d.emeet.presetClickCount, d.emeet.presetClickGapMs]).toEqual([5, 300])
  })
})

describe('Verification press after a camera-moving transition (what Resync does by hand)', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  const withVerify = (c: AppConfig) => {
    c.ptz.verifyAfterMs = 600
    c.ptz.fireOffsetMs = 0
  }
  const run = async (t: ReturnType<typeof setup>, target = READER) => {
    await t.c.initSession()
    await flush()
    t.c.handleEvent('CurrentPreviewSceneChanged', { sceneName: target })
    await flush()
    t.c.handleEvent('SceneTransitionStarted', { transitionName: 'Fade to Black' })
    t.c.handleEvent('CurrentProgramSceneChanged', { sceneName: target })
    t.c.handleEvent('SceneTransitionEnded', { transitionName: 'Fade to Black' })
    await flush()
  }

  it('presses the live scene preset once more, forced and single, 600 ms after the transition ends', async () => {
    const t = setup(withVerify)
    await run(t)
    const before = t.sent.length // the early press
    await vi.advanceTimersByTimeAsync(599)
    expect(t.sent.length).toBe(before)
    await vi.advanceTimersByTimeAsync(2)
    expect(t.sent.length).toBe(before + 1)
    const v = t.sent.at(-1)!
    expect(v.presetId).toBe('Preset2')
    expect(v.clicks).toHaveLength(1)
    expect(v.reason).toMatch(/verification press/)
    await vi.advanceTimersByTimeAsync(5000)
    expect(t.sent.length).toBe(before + 1) // exactly one
  })

  it('does nothing for a same-preset transition, when switched off, or if a new transition started meanwhile', async () => {
    const same = setup(withVerify)
    await run(same, CLOSE) // FULL -> CLOSE: both Preset1
    const n = same.sent.length
    await vi.advanceTimersByTimeAsync(2000)
    expect(same.sent.length).toBe(n)

    const off = setup((c) => {
      withVerify(c)
      c.ptz.verifyAfterMs = 0
    })
    await run(off)
    const m = off.sent.length
    await vi.advanceTimersByTimeAsync(2000)
    expect(off.sent.length).toBe(m)

    const busy = setup(withVerify)
    await run(busy)
    busy.c.handleEvent('SceneTransitionStarted', { transitionName: 'Fade to Black' }) // operator transitions again at once
    await vi.advanceTimersByTimeAsync(2000)
    expect(busy.sent.some((x) => /verification press/.test(x.reason))).toBe(false)
  })
})
