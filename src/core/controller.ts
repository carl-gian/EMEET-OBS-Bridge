import type { AppConfig } from '@shared/types'
import { buildGroupMap, decide, normalizeSceneKey, resolveGroup, type Decision } from './decision'
import { PtzDispatcher } from './ptzDispatcher'
import type { Deps, ObsRequest } from './types'
import { PLUGIN_KIND, withPlugin } from './plugin'

type Key = 'intraGroup' | 'crossGroup'
interface Resolved {
  name: string | null
  kind: string | null
}

/**
 * The decision engine / state machine. A faithful port of the PowerShell controller's event handling
 * (Fast Mode, quick-fire, manual resync, priming). Seamless Mode uses our OBS plugin transition (fade to a picture, hold, fade to the next scene):
 * the plugin does the visuals inside OBS and this controller only selects it, configures it and times the camera click.
 * It never touches Electron, the network or Win32 directly - everything goes through `Deps`.
 */
export class Controller {
  readonly ptz: PtzDispatcher

  // ---- state (see CLAUDE.md section 7) ----
  programScene = ''
  previewScene = ''
  studioMode = false
  obsScenes: string[] = []
  obsVersion = ''
  wsVersion = ''
  /** Filled in from OBS: is our plugin's transition kind loaded, and does a transition of that kind exist in the Scene Transitions panel? */
  pluginKindLoaded = false
  pluginInstanceFound = false

  private transitionInFlight = false
  private transitionInFlightSince = 0
  private pendingCrossCheck: { origin: string; earlyGroup: string | null } | null = null
  private appliedTransitionName = ''
  private appliedDurationMs = -1
  private ownSets = new Map<string, number>() // values WE sent recently (their echo events are expected)
  private resolved: Record<Key, Resolved> = { intraGroup: { name: null, kind: null }, crossGroup: { name: null, kind: null } }
  private groupMap = new Map<string, string>()
  private ready = false
  private _dryRun = false

  constructor(private d: Deps) {
    this.ptz = new PtzDispatcher(d.ptzSink, d.ptzLog, d.getConfig, d.now)
    this.rebuildGroupMap(false)
  }

  private get cfg(): AppConfig {
    return withPlugin(this.d.getConfig(), this.d.getPluginUsable?.() ?? false)
  }
  private now() {
    return (this.d.now ?? Date.now)()
  }
  private changed() {
    this.d.onChange?.()
  }

  get dryRun() {
    return this._dryRun
  }
  set dryRun(v: boolean) {
    this._dryRun = v
    this.ptz.dryRun = v
    this.d.log.info(`Dry run ${v ? 'ON - decisions are logged, nothing is sent to OBS or the camera' : 'OFF'}`)
    this.changed()
  }

  // ---------------------------------------------------------------- config ----
  rebuildGroupMap(announce = true) {
    const { map, dupes } = buildGroupMap(this.cfg)
    this.groupMap = map
    for (const dup of dupes) this.d.log.warn(`Duplicate scene mapping: ${dup}`)
    if (announce) this.d.log.info('Scene -> preset map rebuilt from settings.')
  }

  /** Call when the owner changes settings. Mappings apply instantly; transitions re-prime. */
  onConfigChanged() {
    this.rebuildGroupMap()
    if (this.ready) {
      this.appliedTransitionName = '' // force the next prime to re-send with the new durations/names
      this.appliedDurationMs = -1
      void this.resolveTransitionNames().then(() => {
        this.logCrossMode()
        this.changed()
        if (!this.transitionInFlight) this.primeForCurrentPair('settings changed')
      })
    }
  }

  group(scene?: string | null) {
    return resolveGroup(this.groupMap, scene)
  }

  // ----------------------------------------------------------- session setup ----
  async initSession() {
    this.ready = false
    const log = this.d.log

    const ver = await this.safeCall('GetVersion')
    if (ver) {
      this.obsVersion = ver.obsVersion
      this.wsVersion = ver.obsWebSocketVersion
      log.info(`OBS ${ver.obsVersion}  /  obs-websocket ${ver.obsWebSocketVersion}`)
    }

    const sm = await this.safeCall('GetStudioModeEnabled')
    this.studioMode = !!sm?.studioModeEnabled
    if (!this.studioMode) {
      log.error('OBS Studio Mode is OFF. EMEET-OBS Bridge needs Studio Mode to work smoothly: turn it on in OBS (the "Studio Mode" button under the Controls panel).')
    }

    await this.refreshSceneList()

    const missing: string[] = []
    for (const [scene, pid] of Object.entries(this.cfg.scenes)) {
      if (this.cfg.presets[pid] && !this.obsScenes.includes(scene)) missing.push(`'${scene}' (${pid})`)
    }
    if (missing.length) log.error('Configured scenes not present in OBS (exact name must match): ' + missing.join('; '))
    else log.info('All configured scene names matched OBS exactly.')

    const unmapped = this.obsScenes.filter((s) => !this.group(s))
    if (unmapped.length) log.info('Scenes not mapped to any preset (treated as intra-group, plain fade): ' + unmapped.join(' | '))

    await this.resolveTransitionNames()
    this.logCrossMode()

    const cur = await this.safeCall('GetCurrentSceneTransition')
    if (cur) {
      this.appliedTransitionName = cur.transitionName
      this.appliedDurationMs = Number(cur.transitionDuration)
      log.info(`OBS current transition: '${cur.transitionName}' [${cur.transitionKind}] ${cur.transitionDuration} ms`)
    }

    if (this.cfg.behavior.clearSceneTransitionOverridesOnStart) await this.clearSceneOverrides()

    const p = await this.safeCall('GetCurrentProgramScene')
    const v = this.studioMode ? await this.safeCall('GetCurrentPreviewScene') : null
    this.programScene = p?.currentProgramSceneName ?? p?.sceneName ?? ''
    this.previewScene = v?.currentPreviewSceneName ?? v?.sceneName ?? this.programScene
    log.info(`Program = '${this.programScene}'   Preview = '${this.previewScene}'`)
    log.info(
      `Resolved settings: intra '${this.cfg.transitions.intraGroup.name}' ${this.cfg.transitions.intraGroup.durationMs} ms | cross '${this.cfg.transitions.crossGroup.name}' ${this.cfg.transitions.crossGroup.durationMs} ms | mode ${this.cfg.transitions.crossGroupMode} | camera click offset ${this.cfg.ptz.fireOffsetMs} ms`
    )

    this.ready = true
    this.primeForCurrentPair('startup')
    if (this.cfg.ptz.syncOnStartup) this.resyncPtz()
    this.changed()
  }

  /** Called when the connection to OBS drops. */
  onDisconnected() {
    this.ready = false
    this.transitionInFlight = false
    this.pendingCrossCheck = null
    this.pluginKindLoaded = false
    this.pluginInstanceFound = false
    this.changed()
  }

  private async safeCall(type: string, data?: Record<string, unknown>) {
    try {
      return await this.d.obs.call(type, data)
    } catch (e) {
      this.d.log.warn(`Request '${type}' failed: ${(e as Error).message}`)
      return null
    }
  }

  async refreshSceneList() {
    const scenes = await this.safeCall('GetSceneList')
    const list: { sceneName: string; sceneIndex: number }[] = scenes?.scenes ?? []
    // OBS returns bottom-to-top; show them in the same order as the OBS scene list.
    this.obsScenes = [...list].sort((a, b) => b.sceneIndex - a.sceneIndex).map((s) => s.sceneName)
    this.changed()
  }

  private async resolveTransitionNames() {
    const resp = await this.safeCall('GetSceneTransitionList')
    if (!resp) {
      this.d.log.error('GetSceneTransitionList failed - cannot resolve transitions.')
      return
    }
    const list: { transitionName: string; transitionKind: string }[] = resp.transitions ?? []
    this.pluginInstanceFound = list.some((t) => t.transitionKind === PLUGIN_KIND)
    const kinds = await this.safeCall('GetTransitionKindList')
    this.pluginKindLoaded = (kinds?.transitionKinds ?? []).includes(PLUGIN_KIND)
    for (const key of ['intraGroup', 'crossGroup'] as const) {
      const c = this.cfg.transitions[key]
      let hit = list.find((t) => t.transitionName === c.name)
      let how = 'name'
      if (hit) {
        if (c.kind && hit.transitionKind !== c.kind)
          this.d.log.warn(`'${hit.transitionName}' is a '${hit.transitionKind}' transition, not the configured kind '${c.kind}'. Using it anyway.`)
      } else {
        let byKind = list.filter((t) => t.transitionKind === c.kind)
        if (key === 'crossGroup' && byKind.length > 1) {
          const pref = byKind.filter((t) => /black|dip|fade\s*to/i.test(t.transitionName))
          if (pref.length) byKind = pref
        }
        hit = byKind[0]
        how = 'kind'
      }
      if (!hit) {
        this.d.log.error(
          `No transition found for '${key}' (name '${c.name}' / kind '${c.kind}'). In OBS: Scene Transitions -> '+' -> create it (cross-group: 'Fade to Color', black).`
        )
        this.resolved[key] = { name: null, kind: null }
      } else {
        if (how === 'kind' && hit.transitionKind !== PLUGIN_KIND) this.d.log.warn(`No transition named '${c.name}'; falling back to '${hit.transitionName}' (kind ${hit.transitionKind}).`)
        this.resolved[key] = { name: hit.transitionName, kind: hit.transitionKind }
        this.d.log.info(`Resolved ${key} -> '${hit.transitionName}' [${hit.transitionKind}] (by ${how})`)
      }
    }
  }

  private async clearSceneOverrides() {
    let cleared = 0
    for (const s of this.obsScenes) {
      const o = await this.safeCall('GetSceneSceneTransitionOverride', { sceneName: s })
      if (!o) continue
      if (o.transitionName || o.transitionDuration) {
        if (this._dryRun) {
          this.d.log.info(`(DryRun) would clear override on '${s}'`)
          continue
        }
        await this.safeCall('SetSceneSceneTransitionOverride', { sceneName: s, transitionName: null, transitionDuration: null })
        this.d.log.info(`Cleared scene transition override on '${s}' (was '${o.transitionName}' / ${o.transitionDuration} ms).`)
        cleared++
      }
    }
    this.d.log.info(`Scene-transition-override sweep complete: ${cleared} cleared.`)
  }

  /** One log line saying what happens when the camera has to move. */
  private logCrossMode() {
    const raw = this.d.getConfig()
    const usable = this.d.getPluginUsable?.() ?? false
    if (raw.transitions.crossGroupMode === 'seamless') {
      if (usable)
        this.d.log.info(`Cross-group mode: Seamless (OBS plugin: fade ${raw.plugin.fadeMs} ms, hold ${raw.plugin.holdMs} ms, fade ${raw.plugin.fadeMs} ms; camera click ${raw.plugin.fadeMs} ms after the transition starts).`)
      else this.d.log.warn('Seamless Mode is selected but the OBS plugin is not ready (see the plugin badge / Settings > Transition Rules). Using Fast Mode until it is.')
    } else {
      this.d.log.info('Cross-group mode: Fast Mode (camera click ' + (raw.ptz.fireOffsetMs > 0 ? raw.ptz.fireOffsetMs + ' ms after the transition starts' : 'immediately when the transition starts') + ').')
    }
  }

  // ------------------------------------------------------------------ priming ----
  private currentDecision(): Decision {
    return decide(this.cfg, this.groupMap, this.programScene, this.previewScene)
  }

  private async applyTransitionState(dec: Decision, reason: string) {
    const resolved = this.resolved[dec.key]
    if (!resolved.name) {
      this.d.log.error(`Cannot prime: no transition resolved for '${dec.key}'.`)
      return
    }
    const name = resolved.name
    const dur = dec.durationMs
    if (this.appliedTransitionName === name && this.appliedDurationMs === dur) {
      this.d.log.debug(`Prime no-op (already '${name}' / ${dur} ms) [${reason}]`)
      return
    }
    this.d.log.info(`PRIME -> '${name}' / ${dur} ms   [${reason}]`)
    this.appliedTransitionName = name
    this.appliedDurationMs = dur
    this.ownSets.set('n:' + name, this.now())
    this.ownSets.set('d:' + dur, this.now())
    if (this._dryRun) {
      this.d.log.info('        (DryRun: nothing sent)')
      return
    }
    const reqs: ObsRequest[] = [{ requestType: 'SetCurrentSceneTransition', requestData: { transitionName: name } }]
    // Our plugin sets its own duration (2 x fade + hold); OBS refuses a duration for such a transition.
    if (resolved.kind !== PLUGIN_KIND) reqs.push({ requestType: 'SetCurrentSceneTransitionDuration', requestData: { transitionDuration: dur } })
    const cfgKind = this.cfg.transitions[dec.key].kind
    if (dec.settings && resolved.kind === cfgKind) {
      reqs.push({ requestType: 'SetCurrentSceneTransitionSettings', requestData: { transitionSettings: dec.settings, overlay: true } })
    }
    try {
      const results = await this.d.obs.batch(reqs)
      for (const r of results ?? []) {
        if (r.requestStatus && !r.requestStatus.result) {
          // 606 = transition has no custom settings: harmless.
          const lvl = r.requestStatus.code === 606 ? 'debug' : 'warn'
          this.d.log[lvl](`Batch request '${r.requestType}' failed [${r.requestStatus.code}] ${r.requestStatus.comment ?? ''}`)
        }
      }
    } catch (e) {
      this.d.log.warn(`Prime batch failed: ${(e as Error).message}`)
    }
  }

  private primeForCurrentPair(reason: string) {
    if (!this.studioMode) {
      this.d.log.debug('Skipping prime: Studio Mode is off.')
      return
    }
    const dec = this.currentDecision()
    this.d.log.info(`DECISION ${dec.isCrossGroup ? 'CROSS-GROUP' : 'INTRA-GROUP'} '${dec.origin}' -> '${dec.target}'`)
    void this.applyTransitionState(dec, reason)
  }

  // ---------------------------------------------------------- event handlers ----
  handleEvent(type: string, data: any) {
    switch (type) {
      case 'CurrentPreviewSceneChanged':
        return this.onPreviewSceneChanged(data.sceneName)
      case 'SceneTransitionStarted':
        return this.onTransitionStarted(data.transitionName)
      case 'SceneTransitionEnded':
        return void this.onTransitionEnded(data.transitionName)
      case 'CurrentProgramSceneChanged':
        return this.onProgramSceneChanged(data.sceneName)
      case 'StudioModeStateChanged':
        this.studioMode = !!data.studioModeEnabled
        if (this.studioMode) this.d.log.info('Studio Mode turned ON.')
        else this.d.log.error('OBS Studio Mode was turned OFF. Turn it back on in OBS, or the camera and transitions will not follow your scenes properly.')
        if (this.studioMode && !this.transitionInFlight) {
          void this.safeCall('GetCurrentPreviewScene').then((v) => {
            this.previewScene = v?.currentPreviewSceneName ?? this.previewScene
            this.primeForCurrentPair('studio mode enabled')
            this.changed()
          })
        }
        return this.changed()
      case 'CurrentSceneTransitionChanged':
        // the user may just have added our plugin's transition in OBS: look again
        if (!this.pluginInstanceFound) void this.recheckPlugin()
        if (this.isOwnEcho('n:' + data.transitionName)) return this.d.log.debug(`Transition -> '${data.transitionName}' (our own prime)`)
        if (this.appliedTransitionName !== data.transitionName) {
          this.appliedTransitionName = data.transitionName
          this.d.log.warn(`Transition changed outside the controller -> '${data.transitionName}' (cache synced)`)
        }
        return
      case 'CurrentSceneTransitionDurationChanged':
        if (this.isOwnEcho('d:' + Number(data.transitionDuration))) return this.d.log.debug(`Transition duration -> ${data.transitionDuration} ms (our own prime)`)
        if (this.appliedDurationMs !== Number(data.transitionDuration)) {
          this.appliedDurationMs = Number(data.transitionDuration)
          this.d.log.warn(`Transition duration changed outside the controller -> ${data.transitionDuration} ms (cache synced)`)
        }
        return
      case 'SceneListChanged':
        this.d.log.warn('Scene list changed in OBS - refreshing the list.')
        return void this.refreshSceneList()
      case 'ExitStarted':
        return this.d.log.warn('OBS is shutting down - will keep retrying until it comes back.')
      default:
        this.d.log.debug(`Event '${type}'`)
    }
  }

  private isOwnEcho(key: string): boolean {
    const t = this.ownSets.get(key)
    return t !== undefined && this.now() - t < 5000
  }

  private onPreviewSceneChanged(scene: string) {
    this.previewScene = scene
    this.d.log.debug(`Preview -> '${scene}'`)
    this.changed()

    if (this.transitionInFlight) {
      const stuckFor = (this.now() - this.transitionInFlightSince) / 1000
      const limit = this.cfg.transitions.crossGroup.durationMs / 1000 + 10
      if (stuckFor > limit) {
        this.d.log.warn(`Watchdog: transition flagged in-flight for ${Math.round(stuckFor)} s - clearing flag.`)
        this.transitionInFlight = false
      } else {
        this.d.log.debug('        (transition in flight: priming deferred to SceneTransitionEnded)')
        return
      }
    }
    this.primeForCurrentPair(`preview changed to '${scene}'`)
  }

  private onTransitionStarted(transitionName: string) {
    this.transitionInFlight = true
    this.transitionInFlightSince = this.now()

    const dec = this.currentDecision()
    this.d.log.info(`TRANSITION STARTED '${transitionName}'  (${dec.origin} -> ${dec.target})`)

    const expected = this.resolved[dec.key].name ?? dec.transitionName
    const latchOk = expected === transitionName
    if (!latchOk) {
      this.d.log.warn(
        `        !! LATCH MISMATCH: OBS latched '${transitionName}', expected '${expected}' - Preview may be stale (e.g. a scene set directly by another tool such as Meeting Media Manager) so this cut may use the wrong effect/duration.`
      )
    }

    if (dec.origin && normalizeSceneKey(dec.origin) === normalizeSceneKey(dec.target)) {
      // Program was already duplicated into Preview and the operator pressed Transition again: manual resync.
      this.d.log.info(`        SAME-SCENE RETRANSITION on '${dec.origin}' -> treating as manual PTZ resync.`)
      this.pendingCrossCheck = null
      this.ptz.invoke(this.group(dec.origin), dec.origin, 'manual resync (retransition on duplicated preview)', { force: true })
      return
    }

    // The real target is only certain once OBS confirms it via CurrentProgramSceneChanged.
    this.pendingCrossCheck = { origin: this.programScene, earlyGroup: null }

    // EARLY FIRE (Fast Mode): launch the camera click now so it lands ~fireOffsetMs into the fade.
    if (dec.isCrossGroup && latchOk) {
      this.pendingCrossCheck.earlyGroup = dec.targetGroup
      const off = this.cfg.ptz.fireOffsetMs
      this.ptz.invoke(dec.targetGroup, dec.target, off > 0 ? `early fire at transition start (click at +${off} ms)` : 'early fire at transition start (immediate)', {
        fireAt: off > 0 ? this.now() + off : undefined
      })
    }
    this.d.log.info('        ' + (dec.isCrossGroup ? 'expecting CROSS-GROUP -> PTZ preset once confirmed' : 'expecting INTRA-GROUP, no preset click'))
    this.changed()
  }

  private async onTransitionEnded(transitionName: string) {
    this.transitionInFlight = false
    this.d.log.debug(`TRANSITION ENDED '${transitionName}'`)

    if (this.pendingCrossCheck) {
      // CurrentProgramSceneChanged never arrived during the transition: ask OBS what is live now.
      this.d.log.warn('        No confirmed program-scene change seen during transition - verifying directly.')
      const { origin, earlyGroup } = this.pendingCrossCheck
      this.pendingCrossCheck = null
      const cur = await this.safeCall('GetCurrentProgramScene')
      const now: string | undefined = cur?.currentProgramSceneName ?? cur?.sceneName
      if (now && origin && normalizeSceneKey(now) !== normalizeSceneKey(origin)) {
        this.programScene = now
        const dec = decide(this.cfg, this.groupMap, origin, now)
        this.d.log.info(`        VERIFIED ${dec.isCrossGroup ? 'CROSS-GROUP' : 'INTRA-GROUP'}  '${origin}' -> '${now}'`)
        this.confirmTarget(dec, earlyGroup, 'verified after transition')
      }
    }
    if (this.cfg.behavior.reprimeOnTransitionEnd) this.primeForCurrentPair('transition ended (resync)')
    this.changed()
  }

  /** Shared "OBS told us the real target" logic: fix a wrong early guess / fire a missed cross-group click. */
  private confirmTarget(dec: Decision, earlyGroup: string | null, why: string) {
    if (earlyGroup) {
      if (earlyGroup === dec.targetGroup) this.d.log.info(`        Early PTZ click for '${earlyGroup}' matches confirmed target - nothing more to do.`)
      else {
        this.d.log.warn(`        Early PTZ guess '${earlyGroup}' was WRONG - correcting to '${dec.targetGroup}'.`)
        this.ptz.invoke(dec.targetGroup, dec.target, `correction (${why})`)
      }
    } else if (dec.isCrossGroup) {
      this.ptz.invoke(dec.targetGroup, dec.target, `program scene changed (${why})`)
    } else {
      // Same preset: no camera move, but the tracking button may still need to follow the scene.
      this.ptz.invoke(null, dec.target, `tracking follows scene (${why})`)
    }
  }

  private onProgramSceneChanged(scene: string) {
    const old = this.programScene
    this.programScene = scene
    this.d.log.debug(`Program -> '${scene}'`)
    if (normalizeSceneKey(old) !== normalizeSceneKey(scene)) {
      // QUICK-FIRE: immediate; deduped against the early fire by cameraGroup. Scenes with no preset still
      // run the tracking check (no preset click is ever sent for them).
      this.ptz.invoke(this.group(scene), scene, 'program scene changed (quick-fire)')
    }

    if (this.pendingCrossCheck && old && normalizeSceneKey(old) !== normalizeSceneKey(scene)) {
      const dec = decide(this.cfg, this.groupMap, old, scene)
      this.d.log.info(`        CONFIRMED ${dec.isCrossGroup ? 'CROSS-GROUP' : 'INTRA-GROUP'}  '${old}' -> '${scene}'`)
      this.confirmTarget(dec, this.pendingCrossCheck.earlyGroup, 'confirmed target')
      this.pendingCrossCheck = null
    }

    if (!this.transitionInFlight && this.cfg.behavior.reprimeOnTransitionEnd) this.primeForCurrentPair('program changed')
    this.changed()
  }

  // ------------------------------------------------------------------ actions ----
  /** Click the current program scene's preset once (tray / button). Bypasses the dedupe. */
  resyncPtz() {
    const scene = this.programScene
    if (!scene) {
      this.d.log.warn('Resync: program scene unknown (not connected to OBS yet).')
      return
    }
    this.d.log.info(`Manual resync for '${scene}'`)
    this.ptz.invoke(this.group(scene), scene, 'manual resync', { force: true })
  }

  dispose() {
    /* nothing to clean up: the controller owns no timers */
  }

  /** Ask OBS again whether our plugin is loaded and its transition exists (after the user installs it or adds the transition). */
  async recheckPlugin() {
    if (!this.ready) return
    await this.resolveTransitionNames()
    this.changed()
  }

  /** The transition the plugin's settings are applied to; null when OBS has no transition of our kind. */
  get pluginTransitionName(): string | null {
    return this.resolved.crossGroup.kind === PLUGIN_KIND ? this.resolved.crossGroup.name : null
  }
}
