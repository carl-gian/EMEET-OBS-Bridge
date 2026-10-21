import { useEffect, useState } from 'react'
import type { AppConfig, AppState, LogEntry } from '@shared/types'
import type { LaunchInfo } from '@shared/changelog'
import SceneManager from './components/SceneManager'
import ConsoleLog from './components/ConsoleLog'
import SettingsModal from './components/SettingsModal'
import HelpGuide from './components/HelpGuide'
import { Button, HelpTip, Pill } from './components/ui'

const SEAMLESS_LABEL: Record<string, string> = {
  Armed: 'armed - press Transition',
  FadingToBlack: 'fading to black',
  Holding: 'holding on black',
  FadingIn: 'fading to target'
}

function CameraIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M23 7l-7 5 7 5V7z" />
      <rect x="1" y="5" width="15" height="14" rx="2" />
    </svg>
  )
}

export default function App() {
  const [state, setState] = useState<AppState | null>(null)
  const [cfg, setCfg] = useState<AppConfig | null>(null)
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [consoleOpen, setConsoleOpen] = useState(false) // hidden at every start
  const [helpTopic, setHelpTopic] = useState<string | null>(null)
  const [launch, setLaunch] = useState<LaunchInfo | null>(null)
  const openHelp = (topic = 'start') => setHelpTopic(topic)
  const closeHelp = () => {
    setHelpTopic(null)
    if (launch && launch.kind !== 'normal') {
      void window.api.ackLaunchInfo()
      setLaunch(null)
    }
  }
  // First run: welcome help. First run after an update: What's new.
  useEffect(() => {
    void window.api.getLaunchInfo().then((l) => {
      setLaunch(l)
      if (l.kind === 'first-run') setHelpTopic('start')
      else if (l.kind === 'updated') setHelpTopic('whatsnew')
    })
    return window.api.onOpenHelp((t) => setHelpTopic(t || 'start'))
  }, [])
  useEffect(() => {
    const f1 = (e: KeyboardEvent) => {
      if (e.key === 'F1') {
        e.preventDefault()
        setHelpTopic((t) => t ?? 'start')
      }
    }
    document.addEventListener('keydown', f1)
    return () => document.removeEventListener('keydown', f1)
  }, [])
  const [toast, setToast] = useState('')
  const [resyncSent, setResyncSent] = useState(false)

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
      ? 'EMEET software detected'
      : state.camera.driver === 'mock'
        ? 'EMEET check unavailable (not Windows)'
        : state.camera.driver === 'starting'
          ? 'Looking for EMEET software ...'
          : 'EMEET software not detected'

  const resync = async () => {
    await window.api.resync()
    setResyncSent(true)
    setTimeout(() => setResyncSent(false), 1800)
  }

  return (
    <div className="flex h-full flex-col gap-3 p-3">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-line bg-panel px-4 py-2.5">
        <div className="mr-2">
          <div className="text-[15px] font-semibold leading-tight">EMEET–OBS Bridge</div>
          <div className="text-[11px] text-mute">build {state.version}</div>
        </div>
        <Pill tone={obsTone}>
          <span className="h-1.5 w-1.5 rounded-full bg-current" />
          {obsText}
        </Pill>
        {state.obs.status === 'connected' && !state.obs.studioMode && <Pill tone="bad">Studio Mode is OFF</Pill>}
        <Pill tone={drvTone}>{drvText}</Pill>
        {state.bridgeState !== 'Idle' && (
          <div className="text-xs text-warn">Seamless: {SEAMLESS_LABEL[state.bridgeState] ?? state.bridgeState}</div>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button
            onClick={resync}
            title="Click the live scene's camera preset again (use it if the camera is not where the live scene expects)"
            className={`inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-[14px] font-semibold text-white shadow-md transition active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${resyncSent ? 'bg-ok' : 'bg-accent hover:brightness-110'}`}
          >
            <CameraIcon />
            {resyncSent ? 'Sent ✓' : 'Resync camera'}
          </button>
          <HelpTip title="Resync camera" align="right">
            Clicks the camera preset of the scene that is live right now. Use it if the camera is not pointing where that scene expects, for example after someone moved it by hand.
          </HelpTip>
          <Button kind="ghost" onClick={() => setConsoleOpen((o) => !o)} title="Show or hide the live log of what the app is doing">
            {consoleOpen ? 'Hide console' : 'Open console'}
          </Button>
          <Button onClick={() => setSettingsOpen(true)}>Settings</Button>
          <HelpTip title="Settings" align="right">
            OBS connection, transitions, camera preset positions (and how to add more presets), tracking buttons and start-up options.
          </HelpTip>
          <Button kind="primary" onClick={() => openHelp()} title="Open the help guide (F1)">
            Help
          </Button>
        </div>
      </header>

      {state.dryRun && (
        <div className="flex items-center justify-between rounded-lg border border-warn/50 bg-warn/10 px-4 py-2 text-[13px] text-warn">
          <span>
            <b>DRY RUN is ON</b> - decisions are only written to the log. Nothing is sent to OBS or the camera.
          </span>
          <Button onClick={() => window.api.setDryRun(false)}>Turn off</Button>
        </div>
      )}

      {/* The page scrolls when the window is small; on a big window the two panels fill the height. */}
      <main className="min-h-0 flex-1 overflow-y-auto">
        <div className={`grid gap-3 lg:h-full lg:grid-rows-[minmax(0,1fr)] ${consoleOpen ? 'lg:grid-cols-2' : 'lg:grid-cols-1'}`}>
          <div className="h-[460px] min-h-0 lg:h-full">
            <SceneManager state={state} cfg={cfg} onCfg={setCfg} onHelp={openHelp} />
          </div>
          {consoleOpen && (
            <div className="h-[460px] min-h-0 lg:h-full">
              <ConsoleLog
                entries={logs}
                onClear={() => {
                  setLogs([])
                  void window.api.clearLogView()
                }}
              />
            </div>
          )}
        </div>
      </main>

      {toast && <div className="fixed bottom-4 left-1/2 -translate-x-1/2 rounded-md border border-line bg-panel2 px-4 py-2 text-sm shadow-lg">{toast}</div>}
      {helpTopic && <HelpGuide key={helpTopic} initial={helpTopic} since={launch?.kind === 'updated' ? launch.from : null} onClose={closeHelp} />}
      {settingsOpen && <SettingsModal onHelp={openHelp} cfg={cfg} dryRun={state.dryRun} onClose={() => setSettingsOpen(false)} onSaved={setCfg} />}
    </div>
  )
}
