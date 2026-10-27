import type { AppConfig } from '@shared/types'
import { presetClicks } from './config'
import { normalizeSceneKey } from './decision'
import type { Log, PtzSink } from './types'
import type { PtzClick } from '@shared/types'

export interface InvokeOpts {
  fireAt?: number // absolute unix ms
  force?: boolean // bypass the "camera already on that preset" dedupe
}

/**
 * Decides WHAT to click (preset and/or tracking button) and hands it to the driver.
 * Holds the camera state used for dedupe:
 *   cameraGroup  = preset last sent (set at DISPATCH time so the confirm path dedupes against the early fire)
 *   tracking     = whether we believe EMEET tracking is currently ON
 */
export class PtzDispatcher {
  cameraGroup: string | null = null
  tracking = false
  dryRun = false
  private seq = 0
  private warnedNoTrackingClick = false

  constructor(
    private sink: PtzSink,
    private log: Log,
    private getConfig: () => AppConfig,
    private now: () => number = Date.now
  ) {
    this.tracking = getConfig().tracking.assumeInitiallyOn
  }

  /** Called on config reload: if the owner changed the "assume tracking is on" startup guess before any click, follow it. */
  resetTrackingGuess() {
    this.tracking = this.getConfig().tracking.assumeInitiallyOn
  }

  desiredTracking(scene: string): boolean {
    const cfg = this.getConfig()
    // No master switch: a scene's own Tracking tick in the Scene Manager is the only control.
    const key = normalizeSceneKey(scene)
    for (const [name, on] of Object.entries(cfg.sceneTracking)) if (on && normalizeSceneKey(name) === key) return true
    return false
  }

  /**
   * @param groupId preset id for the scene (null = scene has no preset: no preset click, tracking may still apply)
   * @returns true if a command was dispatched
   */
  invoke(groupId: string | null, scene: string, reason: string, opts: InvokeOpts = {}): boolean {
    const cfg = this.getConfig()
    if (!cfg.ptz.enabled || !cfg.emeet.enabled) {
      this.log.warn('PTZ/EMEET automation disabled in settings - nothing sent.')
      return false
    }

    const clicks: PtzClick[] = []
    let presetSent = false
    let label = ''

    if (groupId) {
      const preset = cfg.presets[groupId]
      label = preset?.label ?? groupId
      if (!preset) {
        this.log.error(`Unknown preset '${groupId}'.`)
      } else if (!opts.force && groupId === this.cameraGroup) {
        this.log.info(`PTZ: camera already on '${groupId}' (${label}) - preset click skipped [${reason}]`)
      } else {
        const pc = presetClicks(preset)
        if (pc.length === 0) {
          this.log.warn(`Preset '${groupId}' (${label}) has no x/y in settings - camera NOT moved.`)
        } else {
          // Press the preset button several times (the EMEET app sometimes ignores one press): the whole preset sequence is
          // repeated presetClickCount times, with presetClickGapMs before each repeat. Tracking is clicked after the last one.
          const times = Math.max(1, cfg.emeet.presetClickCount ?? 1)
          const gap = cfg.emeet.presetClickGapMs ?? 300
          for (let r = 0; r < times; r++) {
            pc.forEach((c, i) =>
              clicks.push({
                ...c,
                ...(r > 0 && i === 0 ? { delayMs: gap } : {}),
                note: `preset ${groupId}${i > 0 ? ` #${i + 1}` : ''}${r > 0 ? ` (press ${r + 1}/${times})` : times > 1 ? ` (press 1/${times})` : ''}`
              })
            )
          }
          presetSent = true
        }
      }
    }

    // Tracking button (EMEET auto-follow), per scene.
    const want = this.desiredTracking(scene)
    let trackingClicked = false
    if (want !== this.tracking) {
      const c = want ? cfg.tracking.enableClick : cfg.tracking.disableClick ?? cfg.tracking.enableClick
      if (!c) {
        if (!this.warnedNoTrackingClick) {
          this.log.warn('Tracking click coordinates are not set (Settings > Camera) - tracking not changed.')
          this.warnedNoTrackingClick = true
        }
      } else {
        clicks.push({ x: c.x, y: c.y, delayMs: presetSent ? cfg.tracking.delayAfterPresetMs : 0, note: want ? 'tracking ON' : 'tracking OFF' })
        trackingClicked = true
      }
    }

    if (clicks.length === 0) return false

    // Update state at dispatch time.
    if (presetSent) this.cameraGroup = groupId
    if (trackingClicked) this.tracking = want

    const wait = opts.fireAt ? Math.max(0, opts.fireAt - this.now()) : 0
    const what = [presetSent ? `preset '${groupId}' (${label})` : null, trackingClicked ? `tracking ${want ? 'ON' : 'OFF'}` : null]
      .filter(Boolean)
      .join(' + ')
    const timing = opts.fireAt ? `click in ${wait} ms` : 'click now'

    if (this.dryRun) {
      this.log.info(`PTZ -> ${what} (DryRun: nothing sent) [${reason}]`)
      return true
    }

    this.sink.send({
      id: ++this.seq,
      label,
      presetId: presetSent ? groupId : null,
      reason,
      issuedAt: this.now(),
      fireAt: opts.fireAt,
      clicks,
      emeet: cfg.emeet
    })
    this.log.info(`PTZ -> ${what} sent to worker, ${timing} [${reason}]`)
    return true
  }
}
