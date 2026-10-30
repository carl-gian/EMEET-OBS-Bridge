import type { AppConfig } from '@shared/types'
import { presetClicks } from './config'
import { normalizeSceneKey } from './decision'
import type { Log, PtzSink } from './types'
import type { PtzClick } from '@shared/types'

export interface InvokeOpts {
  fireAt?: number // absolute unix ms
  force?: boolean // bypass the "camera already on that preset" dedupe
  /**
   * How long the extra presses may be spread over (ms, counted from the first press): during a transition this is the time left until the
   * transition ends, so the preset button is pressed again and again while the picture is covered. Without it the fixed gap setting is used.
   */
  spanMs?: number
  /** One press only (no repeats) - used for the verification press after a transition. */
  single?: boolean
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
  /** Timers of the extra presses still to come. A new preset command cancels them (stale presses must never move the camera back). */
  private repeats: ReturnType<typeof setTimeout>[] = []

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
    this.cancelRepeats()
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
          pc.forEach((c, i) => clicks.push({ ...c, note: i === 0 ? `preset ${groupId}` : `preset ${groupId} #${i + 1}` }))
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

    if (presetSent) this.cancelRepeats() // a new preset command makes any older extra presses stale
    const presetClicksNow = presetSent ? presetClicks(cfg.presets[groupId!]) : []
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
    if (presetSent && !opts.single) this.scheduleRepeats(groupId!, label, presetClicksNow, cfg, wait, opts.spanMs, reason)
    return true
  }

  /**
   * "Press it again, just to be sure": the first press goes out with the command; the other presses (presetClickCount - 1) are separate
   * single-press commands sent later, spread over the transition (or presetClickGapMs apart when there is no transition). They are separate
   * so the worker is never busy for seconds, and so a newer command can cancel the ones that have not happened yet.
   */
  private scheduleRepeats(groupId: string, label: string, pc: PtzClick[], cfg: AppConfig, firstInMs: number, spanMs: number | undefined, reason: string) {
    const times = Math.max(1, cfg.emeet.presetClickCount ?? 1)
    if (times <= 1 || pc.length === 0) return
    const fixedGap = cfg.emeet.presetClickGapMs ?? 300
    const gap = spanMs !== undefined && spanMs > 0 ? Math.min(5000, Math.max(100, Math.round(spanMs / (times - 1)))) : fixedGap
    for (let n = 1; n < times; n++) {
      const t = setTimeout(() => {
        this.repeats = this.repeats.filter((x) => x !== t)
        if (this.dryRun) return
        const id = ++this.seq
        this.sink.send({
          id,
          label,
          presetId: groupId,
          reason: `press ${n + 1}/${times} [${reason}]`,
          issuedAt: this.now(),
          clicks: pc.map((c, i) => ({ ...c, delayMs: i === 0 ? 0 : c.delayMs, note: `preset ${groupId} (press ${n + 1}/${times})${i > 0 ? ` #${i + 1}` : ''}` })),
          emeet: cfg.emeet
        })
        this.log.info(`PTZ -> preset '${groupId}' (${label}) press ${n + 1}/${times}`)
      }, firstInMs + n * gap)
      this.repeats.push(t)
    }
  }

  /** Forget the extra presses that have not happened yet (new preset command, shutdown). */
  cancelRepeats() {
    for (const t of this.repeats) clearTimeout(t)
    this.repeats = []
  }
}
