import { useEffect, useState } from 'react'
import type { AppConfig, AppState, LogEntry } from '@shared/types'
import SceneManager from './components/SceneManager'
import ConsoleLog from './components/ConsoleLog'
import SettingsModal from './components/SettingsModal'
import { Button, Pill, Switch } from './components/ui'

export default function App() {
  const [state, setState] = useState<AppState | null>(null)
  const [cfg, setCfg] = useState<AppConfig | null>(null)
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [toast, setToast] = useState('')

  useEffect(() => {
    void window.api.getState().then(setState)
    void window.api.getConfig().then(setCfg)
    void window.api.getLogs().then(setLogs)
    const offs = [
      window.api.onState(setState),
      window.api.onConfig(setCfg),
      window.api.onLog((e) => setLogs((l) => (l.length >= 2000 ? [...l.slice(-1999), e] : [...l, e])))
    ]
    return () => offs.forEach((f) => f())
  }, [])

  const say = (m: string) => {
    setToast(m)
    setTimeout(() => setToast(''), 4000)
  }

  if (!state || !cfg) return <div className="p-6 text-mute">Loading ...</div>

  const obsTone = state.obs.status === 'connected' ? 'ok' : state.obs.status === 'connecting' ? 'warn' : 'bad'
  const obsText =
    state.obs.status === 'connected'
      ? `OBS connected${state.obs.obsVersion ? ` (${state.obs.obsVersion})` : ''}`
      : state.obs.status === 'connecting'
        ? 'Connecting to OBS ...'
        : `OBS not connected${state.obs.error ? ` - ${state.obs.error}` : ''}`
  const drvTone = state.camera.driver === 'ready' ? 'ok' : state.camera.driver === 'mock' ? 'mute' : state.camera.driver === 'starting' ? 'warn' : 'bad'
  const drvText =
    state.camera.driver === 'ready'
      ? `Camera helper ready${state.camera.hwnd ? ` (${state.camera.hwnd})` : ''}`
      : state.camera.driver === 'mock'
        ? 'Camera: mock (not Windows)'
        : state.camera.driver === 'starting'
          ? 'Camera helper starting ...'
          : 'Camera helper not running'

  return (
    <div className="flex h-full flex-col gap-3 p-3">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-line bg-panel px-4 py-2.5">
        <div className="mr-2">
          <div className="text-[15px] font-semibold leading-tight">OBS Master Controller</div>
          <div className="text-[11px] text-mute">build {state.version}</div>
        </div>
        <Pill tone={obsTone}>
          <span className="h-1.5 w-1.5 rounded-full bg-current" />
          {obsText}
        </Pill>
        {state.obs.status === 'connected' && !state.obs.studioMode && <Pill tone="bad">Studio Mode is OFF</Pill>}
        <Pill tone={drvTone}>{drvText}</Pill>
        <div className="text-xs text-mute">
          Camera preset: <span className="text-ink">{state.camera.group ?? 'unknown'}</span> · Tracking:{' '}
          <span className="text-ink">{state.camera.tracking ? 'on' : 'off'}</span>
          {state.bridgeState !== 'Idle' && <span className="ml-2 text-warn">Bridge: {state.bridgeState}</span>}
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-3">
          <Switch checked={state.dryRun} onChange={(v) => window.api.setDryRun(v)} label={<span title="Log decisions only; send nothing to OBS or the camera">Dry run</span>} />
          <Button
            onClick={async () => {
              await window.api.resync()
              say('Resync sent for the live scene')
            }}
            title="Click the live scene's camera preset again"
          >
            Resync camera
          </Button>
          <Button onClick={() => window.api.openLogs()}>Open logs</Button>
          <Button
            onClick={async () => {
              const r = await window.api.exportDiagnostics()
              if (r.ok) say('Diagnostics saved - send me that zip')
              else if (r.error) say('Export failed: ' + r.error)
            }}
          >
            Export diagnostics
          </Button>
          <Button kind="primary" onClick={() => setSettingsOpen(true)}>
            Settings
          </Button>
        </div>
      </header>

      <main className="grid min-h-0 flex-1 grid-cols-[minmax(420px,1fr)_minmax(380px,1fr)] gap-3">
        <SceneManager state={state} cfg={cfg} onCfg={setCfg} />
        <ConsoleLog
          entries={logs}
          onClear={() => {
            setLogs([])
            void window.api.clearLogView()
          }}
        />
      </main>

      {toast && <div className="fixed bottom-4 left-1/2 -translate-x-1/2 rounded-md border border-line bg-panel2 px-4 py-2 text-sm shadow-lg">{toast}</div>}
      {settingsOpen && <SettingsModal cfg={cfg} onClose={() => setSettingsOpen(false)} onSaved={setCfg} />}
    </div>
  )
}
