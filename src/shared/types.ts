// Types shared by the main process, preload and the UI.

export type LogLevel = 'Debug' | 'Info' | 'Warn' | 'Error'
export type LogSource = 'APP' | 'OBS' | 'PTZ' | 'EMEET'

export interface LogEntry {
  ts: string // "YYYY-MM-DD HH:mm:ss.SSS"
  level: LogLevel
  source: LogSource
  msg: string
}

export interface Point {
  x: number
  y: number
}

/** One click inside the EMEET window. Coordinates are SCREEN pixels unless space = 'client'. */
export interface PresetClick extends Point {
  delayMs?: number
  space?: 'screen' | 'client'
}

export interface PresetCfg {
  label: string
  x?: number
  y?: number
  clicks?: PresetClick[] // optional multi-click sequence (overrides x/y)
}

export interface TransitionCfg {
  name: string
  kind: string
  durationMs: number
  settings: Record<string, unknown> | null
}

export type CrossGroupMode = 'fast' | 'seamless'

export interface AppConfig {
  configVersion: number
  general: {
    obsPath: string
    launchObsOnStart: boolean
    /** Start minimized to the tray instead of showing the window. */
    startHidden: boolean
    /** Launch this app when the user signs in to Windows. */
    startWithWindows: boolean
  }
  obs: {
    host: string
    port: number
    password: string
    rpcVersion: number
    requestTimeoutSec: number
    connectTimeoutSec: number
  }
  presets: Record<string, PresetCfg> // always Preset1..Preset8 (coordinates preloaded)
  presetCount: number // how many presets are shown/usable (3..8)
  scenes: Record<string, string> // exact OBS scene name -> preset id
  sceneTracking: Record<string, boolean> // exact OBS scene name -> use EMEET tracking
  transitions: {
    crossGroupMode: CrossGroupMode
    intraGroup: TransitionCfg
    crossGroup: TransitionCfg
  }
  /** Seamless Mode: our OBS plugin fades to this picture, holds it, then fades to the next scene. */
  plugin: {
    imagePath: string // copy kept in the app's data folder; '' = plain black
    fadeMs: number // each of the two fades (default 800)
    holdMs: number // how long the picture stays (default 3500)
    riskAcceptedObs: string // OBS version the user chose to carry on with although the plugin was built for another ('' = none)
  }
  ptz: { enabled: boolean; fireOffsetMs: number; syncOnStartup: boolean } // fireOffsetMs: 0 = click as soon as OBS reports the transition started
  tracking: {
    enabled: boolean // master switch ("Enable Tracking")
    enableClick: Point | null
    disableClick: Point | null // null = the enable button is a toggle
    assumeInitiallyOn: boolean
    delayAfterPresetMs: number
  }
  emeet: {
    enabled: boolean
    processName: string
    windowTitleLike: string
    exePath: string
    /** Open EMEET Studio when this app starts, and again if it is closed when a camera click is needed. Off = never launch it. */
    launchOnStart: boolean
    layout: { x: number; y: number; width: number; height: number }
    launchTimeoutSec: number
    coordSpace: 'screen' | 'client'
    keepBehind: boolean
    sendToChildWindow: boolean
    sendMouseActivate: boolean
    clickHoldMs: number
    clickDelayMs: number
    /** Press each EMEET preset button this many times (camera ignores a press now and then), with presetClickGapMs between presses. */
    presetClickCount: number
    presetClickGapMs: number
  }
  behavior: {
    requireStudioMode: boolean
    clearSceneTransitionOverridesOnStart: boolean
    unknownScenePolicy: 'intra' | 'cross'
    reprimeOnTransitionEnd: boolean
  }
  logging: { level: LogLevel }
}

export type EmeetCfg = AppConfig['emeet']

/** A command sent to the EMEET driver (PowerShell helper on Windows, a mock on macOS). */
export interface PtzClick extends PresetClick {
  note?: string
}
export interface PtzCommand {
  id: number
  label: string
  presetId: string | null
  reason: string
  issuedAt: number // unix ms when the controller decided
  fireAt?: number // absolute unix ms; click is held until then
  clicks: PtzClick[]
  emeet: EmeetCfg
}

export type ObsStatus = 'disconnected' | 'connecting' | 'connected'
export type DriverStatus = 'mock' | 'stopped' | 'starting' | 'ready' | 'error'

export type UpdateStatus = 'idle' | 'checking' | 'downloading' | 'ready' | 'up-to-date' | 'error' | 'disabled'
export interface UpdateInfo {
  status: UpdateStatus
  version: string // the new version, once one has been found
  percent: number // download progress 0-100
}

export type PluginStatusName =
  | 'unknown'
  | 'not-installed'
  | 'needs-transition'
  | 'restart-obs'
  | 'ready'
  | 'update-available'
  | 'obs-newer'
  | 'obs-older'
  | 'risk-accepted'
  | 'bridge-too-old'

/** Everything the UI needs to show about the OBS plugin. */
export interface PluginInfo {
  status: PluginStatusName
  usable: boolean
  installedVersion: string // '' = not installed
  builtForObs: string // OBS version the installed plugin was built for
  latestVersion: string // newest plugin on GitHub ('' = not checked / unreachable)
  latestObs: string // OBS version that newest plugin is built for
  obsVersion: string // OBS version running now
  busy: '' | 'checking' | 'installing'
  error: string
  obsRunning: boolean
}

export interface AppState {
  version: string
  platform: string
  obs: {
    status: ObsStatus
    obsVersion?: string
    wsVersion?: string
    studioMode: boolean
    error?: string
  }
  program: string
  preview: string
  scenes: string[]
  camera: {
    group: string | null
    tracking: boolean
    driver: DriverStatus
    hwnd?: string
  }
  dryRun: boolean
  plugin: PluginInfo
  update: UpdateInfo
}

export interface HoldingCardResult {
  ok: boolean
  cfg?: AppConfig
  error?: string
}

export interface DiagnosticsResult {
  ok: boolean
  path?: string
  /** The email app was opened with the message already written (the user attaches the zip). */
  emailOpened?: boolean
  error?: string
}

// IPC channel names
export const IPC = {
  getState: 'state:get',
  state: 'state:push',
  logPush: 'log:push',
  getLogs: 'log:get',
  getConfig: 'config:get',
  saveConfig: 'config:save',
  setSceneMapping: 'config:scene-mapping',
  setSceneTracking: 'config:scene-tracking',
  setTrackingEnabled: 'config:tracking-enabled',
  resync: 'ptz:resync',
  testClick: 'ptz:test-click',
  setDryRun: 'app:dry-run',
  reconnect: 'obs:reconnect',
  openLogs: 'app:open-logs',
  exportDiagnostics: 'app:export-diagnostics',
  sendDiagnostics: 'app:send-diagnostics',
  browseFile: 'app:browse-file',
  clearLogsView: 'log:clear',
  openSettings: 'ui:open-settings',
  pluginCheck: 'plugin:check',
  pluginInstall: 'plugin:install',
  pluginRisk: 'plugin:risk',
  openObs: 'plugin:open-obs',
  getLaunchInfo: 'app:launch-info',
  ackLaunchInfo: 'app:launch-ack',
  openHelp: 'ui:open-help',
  chooseHoldingCard: 'card:choose',
  removeHoldingCard: 'card:remove',
  holdingCardPreview: 'card:preview',
  installUpdate: 'update:install',
  checkUpdate: 'update:check'
} as const
