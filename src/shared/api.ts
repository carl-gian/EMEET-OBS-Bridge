import type { LaunchInfo } from './changelog'
import type { AppConfig, AppState, DiagnosticsResult, LogEntry } from './types'

/** What the UI can ask the main process to do (exposed as window.api by the preload script). */
export interface Api {
  getState(): Promise<AppState>
  getLogs(): Promise<LogEntry[]>
  getConfig(): Promise<AppConfig>
  saveConfig(cfg: AppConfig): Promise<AppConfig>
  setSceneMapping(scene: string, presetId: string | null): Promise<AppConfig>
  setSceneTracking(scene: string, on: boolean): Promise<AppConfig>
  setTrackingEnabled(on: boolean): Promise<AppConfig>
  resync(): Promise<void>
  testClick(x: number, y: number, label: string): Promise<void>
  setDryRun(on: boolean): Promise<void>
  reconnect(): Promise<void>
  openLogs(): Promise<void>
  exportDiagnostics(): Promise<DiagnosticsResult>
  browseFile(title: string, extensions: string[]): Promise<string | null>
  clearLogView(): Promise<void>
  getLaunchInfo(): Promise<LaunchInfo>
  ackLaunchInfo(): Promise<void>
  onOpenHelp(cb: (topic: string) => void): () => void
  onState(cb: (s: AppState) => void): () => void
  onLog(cb: (e: LogEntry) => void): () => void
  onConfig(cb: (c: AppConfig) => void): () => void
}
