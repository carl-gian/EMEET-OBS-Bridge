import { OBSWebSocket } from 'obs-websocket-js/json'
import type { AppConfig, ObsStatus } from '@shared/types'
import { obsUri } from '@core/config'
import type { Controller } from '@core/controller'
import type { Log, ObsBatchResult, ObsLink, ObsRequest } from '@core/types'

// General(1) | Scenes(4) | Transitions(16) | Ui(1024)
const EVENT_SUBSCRIPTIONS = (1 << 0) | (1 << 2) | (1 << 4) | (1 << 10)

const EVENTS = [
  'CurrentPreviewSceneChanged',
  'CurrentProgramSceneChanged',
  'SceneTransitionStarted',
  'SceneTransitionEnded',
  'StudioModeStateChanged',
  'CurrentSceneTransitionChanged',
  'CurrentSceneTransitionDurationChanged',
  'SceneListChanged',
  'ExitStarted'
] as const

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`Timed out: ${what}`)), ms)
    p.then(
      (v) => {
        clearTimeout(t)
        resolve(v)
      },
      (e) => {
        clearTimeout(t)
        reject(e)
      }
    )
  })
}

/** Connects to obs-websocket v5, reconnects forever with backoff, and feeds events to the Controller. */
export class ObsClient {
  status: ObsStatus = 'disconnected'
  lastError = ''
  onStatus?: () => void
  private ws: OBSWebSocket | null = null
  private stopped = true
  private wake: (() => void) | null = null
  private loopRunning = false

  readonly link: ObsLink

  constructor(private log: Log, private getConfig: () => AppConfig, private controller: Controller) {
    this.link = {
      call: (type, data) => {
        const ws = this.ws
        if (!ws || this.status !== 'connected') return Promise.reject(new Error('Not connected to OBS'))
        return withTimeout(ws.call(type as any, data as any), this.getConfig().obs.requestTimeoutSec * 1000, `request ${type}`)
      },
      batch: async (requests: ObsRequest[]) => {
        const ws = this.ws
        if (!ws || this.status !== 'connected') throw new Error('Not connected to OBS')
        const res = await withTimeout(ws.callBatch(requests as any), this.getConfig().obs.requestTimeoutSec * 1000, 'request batch')
        return res as unknown as ObsBatchResult[]
      }
    }
  }

  private setStatus(s: ObsStatus, err = '') {
    this.status = s
    this.lastError = err
    this.onStatus?.()
  }

  start() {
    this.stopped = false
    if (!this.loopRunning) void this.loop()
  }

  stop() {
    this.stopped = true
    this.wake?.()
    try {
      void this.ws?.disconnect()
    } catch {
      /* ignore */
    }
  }

  /** Drop the current connection (if any) and reconnect right away - used after the URL/password changes. */
  reconnect() {
    this.log.info('Reconnecting to OBS ...')
    this.wake?.()
    try {
      void this.ws?.disconnect()
    } catch {
      /* ignore */
    }
  }

  private sleep(ms: number) {
    return new Promise<void>((resolve) => {
      const t = setTimeout(() => {
        this.wake = null
        resolve()
      }, ms)
      this.wake = () => {
        clearTimeout(t)
        this.wake = null
        resolve()
      }
    })
  }

  private async loop() {
    this.loopRunning = true
    let attempt = 0
    while (!this.stopped) {
      const cfg = this.getConfig()
      const uri = obsUri(cfg)
      this.setStatus('connecting')
      const ws = new OBSWebSocket()
      this.ws = ws
      let closedResolve!: () => void
      const closed = new Promise<void>((r) => (closedResolve = r))
      ws.on('ConnectionClosed', (e: any) => {
        this.log.debug(`WebSocket closed${e?.message ? `: ${e.message}` : ''}`)
        closedResolve()
      })
      ws.on('ConnectionError', (e: any) => this.log.debug(`WebSocket error: ${e?.message ?? e}`))
      for (const ev of EVENTS) {
        ws.on(ev as any, (data: any) => {
          try {
            this.controller.handleEvent(ev, data)
          } catch (e) {
            this.log.error(`Error handling OBS event ${ev}: ${(e as Error).stack ?? e}`)
          }
        })
      }

      try {
        attempt++
        this.log.debug(`Connecting to ${uri} (attempt ${attempt}) ...`)
        const info = await withTimeout(
          ws.connect(uri, cfg.obs.password || undefined, { rpcVersion: cfg.obs.rpcVersion, eventSubscriptions: EVENT_SUBSCRIPTIONS }),
          cfg.obs.connectTimeoutSec * 1000,
          `connecting to ${uri} (is the WebSocket server enabled in OBS?)`
        )
        this.log.info(`WebSocket connected: ${uri} (obs-websocket ${info.obsWebSocketVersion}, rpc ${info.negotiatedRpcVersion})`)
        attempt = 0
        this.setStatus('connected')
        await this.controller.initSession()
        await closed // stay here until the socket closes
        this.log.warn('Connection to OBS closed.')
      } catch (e) {
        const msg = (e as Error).message ?? String(e)
        const auth = /authentic/i.test(msg) || (e as any)?.code === 4009
        this.lastError = auth ? 'Wrong OBS WebSocket password' : msg
        if (auth) this.log.error('OBS rejected the password. Check Settings > OBS (and OBS: Tools > WebSocket Server Settings).')
        else if (attempt === 1 || attempt % 10 === 0) this.log.warn(`Could not connect to OBS: ${msg} - will keep trying.`)
        else this.log.debug(`Could not connect to OBS: ${msg}`)
      } finally {
        try {
          ws.removeAllListeners()
          void ws.disconnect().catch(() => {})
        } catch {
          /* ignore */
        }
        this.ws = null
        this.controller.onDisconnected()
        if (!this.stopped) this.setStatus('disconnected', this.lastError)
      }
      if (this.stopped) break
      const wait = Math.min(30, 2 ** Math.min(attempt, 5))
      this.log.debug(`Reconnecting in ${wait} s ...`)
      await this.sleep(wait * 1000)
    }
    this.loopRunning = false
  }
}
