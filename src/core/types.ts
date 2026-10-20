import type { AppConfig, PtzCommand } from '@shared/types'

export interface Log {
  debug(msg: string): void
  info(msg: string): void
  warn(msg: string): void
  error(msg: string): void
}

/** Where camera commands go (PowerShell helper on Windows, a mock elsewhere). */
export interface PtzSink {
  send(cmd: PtzCommand): void
}

export interface ObsRequest {
  requestType: string
  requestData?: Record<string, unknown>
}
export interface ObsBatchResult {
  requestType: string
  requestStatus: { result: boolean; code: number; comment?: string }
}

/** The small slice of obs-websocket the controller needs (easy to fake in tests). */
export interface ObsLink {
  call(type: string, data?: Record<string, unknown>): Promise<any>
  batch(requests: ObsRequest[]): Promise<ObsBatchResult[]>
}

export interface Deps {
  obs: ObsLink
  ptzSink: PtzSink
  ptzLog: Log
  log: Log
  getConfig: () => AppConfig
  now?: () => number
  onChange?: () => void
}
