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
  mutate?.(cfg)
  const sent: PtzCommand[] = []
  const calls: { type: string; data?: any }[] = []
  const batches: any[][] = []
  const logs: string[] = []
  let program = FULL
  const obs: ObsLink = {
    async call(type, data) {
      calls.push({ type, data })
      switch (type) {
        case 'GetVersion': return { obsVersion: '32', obsWebSocketVersion: '5.7.4' }
        case 'GetStudioModeEnabled': return { studioModeEnabled: true }
        case 'GetSceneList': return { scenes: [FULL, CLOSE, READER, TABLE, BLACK].map((n, i) => ({ sceneName: n, sceneIndex: i })) }
        case 'GetSceneTransitionList': return { transitions: [{ transitionName: 'Fade', transitionKind: 'fade_transition' }, { transitionName: 'Fade to Black', transitionKind: 'fade_to_color_transition' }] }
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
  const c = new Controller({ obs, ptzSink: { send: (cmd) => sent.push(cmd) }, ptzLog: log, log, getConfig: () => cfg })
  return { c, cfg, sent, calls, batches, logs, setProgram: (s: string) => (program = s) }
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
    expect(prime.some((r) => r.requestType === 'SetCurrentSceneTransitionSettings')).toBe(true)

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
  it('per-scene tracking: ON clicked after the preset click, OFF when leaving, nothing when master is off', async () => {
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
    t.cfg.tracking.enabled = false
    t.c.handleEvent('CurrentProgramSceneChanged', { sceneName: READER })
    expect(t.sent[2].clicks).toHaveLength(1) // preset only
  })

  it('same-preset scenes still switch tracking', async () => {
    const t = setup((c) => {
      c.tracking.enabled = true
      c.tracking.enableClick = { x: 10, y: 20 } // toggle button (no separate disable)
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

describe('Controller - Seamless Mode', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())
  const seamless = (c: AppConfig) => {
    c.transitions.crossGroupMode = 'seamless'
  }

  it('remembers the target, fades to black (800), clicks when black is reached, holds 3 s, fades to the target (800)', async () => {
    const t = setup(seamless)
    await t.c.initSession()
    await flush()
    t.c.handleEvent('CurrentPreviewSceneChanged', { sceneName: READER })
    expect(t.c.bridgeState).toBe('Armed')
    await flush()
    expect(t.calls.some((c) => c.type === 'SetCurrentPreviewScene' && c.data.sceneName === BLACK)).toBe(true)
    const toBlack = t.batches.at(-1)!
    expect(toBlack[0].requestData.transitionName).toBe('Fade')
    expect(toBlack[1].requestData.transitionDuration).toBe(800)

    t.c.handleEvent('SceneTransitionStarted', { transitionName: 'Fade' })
    expect(t.c.bridgeState).toBe('FadingToBlack')
    expect(t.sent).toHaveLength(0) // no click yet - black not reached

    t.c.handleEvent('CurrentProgramSceneChanged', { sceneName: BLACK })
    t.c.handleEvent('SceneTransitionEnded', { transitionName: 'Fade' })
    expect(t.c.bridgeState).toBe('Holding')
    expect(t.sent).toHaveLength(1) // click right after the fade to black
    expect(t.sent[0].presetId).toBe('Preset2')
    expect(t.sent[0].fireAt).toBeUndefined()

    await vi.advanceTimersByTimeAsync(2999)
    expect(t.c.bridgeState).toBe('Holding')
    await vi.advanceTimersByTimeAsync(1)
    expect(t.c.bridgeState).toBe('FadingIn')
    expect(t.batches.at(-1)![1].requestData.transitionDuration).toBe(800)
    expect(t.calls.some((c) => c.type === 'TriggerStudioModeTransition')).toBe(true)

    t.c.handleEvent('CurrentProgramSceneChanged', { sceneName: READER })
    t.c.handleEvent('SceneTransitionEnded', { transitionName: 'Fade' })
    await flush()
    expect(t.c.bridgeState).toBe('Idle')
    expect(t.sent).toHaveLength(1) // no second click
  })

  it('another program switching the scene while armed cancels seamless (no stray click from it)', async () => {
    const t = setup(seamless)
    await t.c.initSession()
    t.c.handleEvent('CurrentPreviewSceneChanged', { sceneName: READER })
    t.c.handleEvent('SceneTransitionStarted', { transitionName: 'Fade' })
    t.c.handleEvent('CurrentProgramSceneChanged', { sceneName: TABLE }) // not black
    expect(t.c.bridgeState).toBe('Idle')
    expect(t.sent.map((s) => s.presetId)).toEqual(['Preset3']) // only the quick-fire for the real scene
  })

  it('falls back to Fast Mode when the black scene is missing in OBS', async () => {
    const t = setup((c) => {
      seamless(c)
      c.seamless.sceneName = 'NOPE'
    })
    await t.c.initSession()
    t.c.handleEvent('CurrentPreviewSceneChanged', { sceneName: READER })
    expect(t.c.bridgeState).toBe('Idle')
  })
})
