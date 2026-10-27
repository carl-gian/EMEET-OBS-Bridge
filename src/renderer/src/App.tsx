import { useEffect, useState } from 'react'
import type { AppConfig, AppState, LogEntry, PluginInfo } from '@shared/types'
import type { SettingsTab } from './components/SettingsModal'
import type { LaunchInfo } from '@shared/changelog'
import SceneManager from './components/SceneManager'
import ConsoleLog from './components/ConsoleLog'
import SettingsModal from './components/SettingsModal'
import HelpGuide from './components/HelpGuide'
import Tutorial from './components/Tutorial'
import { Button, HelpTip, Pill } from './components/ui'

type BadgeTone = 'ok' | 'warn' | 'bad' | 'accent'
const BADGE_CLASS: Record<BadgeTone, string> = { ok: 'bg-ok/15 text-ok', warn: 'bg-warn/15 text-warn', bad: 'bg-bad/15 text-bad', accent: 'bg-accent/20 text-accent' }

/** What the OBS plugin badge says (null = nothing worth showing). Seamless users see more than Fast Mode users. */
function pluginBadge(p: PluginInfo, seamless: boolean): { tone: BadgeTone; text: string } | null {
  switch (p.status) {
    case 'ready':
      return seamless ? { tone: 'ok', text: 'OBS plugin ready' } : null
    case 'not-installed':
      return seamless ? { tone: 'warn', text: 'OBS plugin not installed' } : null
    case 'needs-transition':
      return seamless ? { tone: 'warn', text: 'Add the plugin transition in OBS' } : null
    case 'restart-obs':
      return { tone: 'warn', text: 'Restart OBS to load the plugin' }
    case 'update-available':
      return { tone: 'accent', text: `Plugin update ${p.latestVersion} available` }
    case 'obs-newer':
      return { tone: 'bad', text: `OBS ${p.obsVersion}: plugin built for ${p.builtForObs}` }
    case 'obs-older':
      return { tone: 'bad', text: `Update OBS to ${p.builtForObs} (plugin)` }
    case 'risk-accepted':
      return { tone: 'warn', text: `Plugin: own risk (OBS ${p.obsVersion})` }
    case 'bridge-too-old':
      return { tone: 'warn', text: 'Plugin needs a newer Bridge' }
    default:
      return null
  }
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
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('general')
  const openSettings = (tab: SettingsTab = 'general') => {
    setSettingsTab(tab)
    setSettingsOpen(true)
  }
  const [consoleOpen, setConsoleOpen] = useState(false) // hidden at every start
  const [helpTopic, setHelpTopic] = useState<string | null>(null)
  const [tutorialOpen, setTutorialOpen] = useState(false)
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
    const offs = [window.api.onOpenHelp((t) => setHelpTopic(t || 'start')), window.api.onOpenSettings((t) => openSettings((t as SettingsTab) || 'general'))]
    return () => offs.forEach((f) => f())
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
        <Pill tone={drvTone}>{drvText}</Pill>
        <button
          onClick={() => setTutorialOpen(true)}
          title="A short step-by-step guide to using the OBS dock with this app"
          className="inline-flex items-center gap-1.5 rounded-full border border-accent/60 bg-accent/15 px-3 py-1 text-xs font-semibold text-accent hover:bg-accent/25"
        >
          ▶ OBS tutorial for JW AV operators
        </button>
        {state.update.status === 'ready' && (
          <button
            onClick={() => void window.api.installUpdate()}
            title="A new version is downloaded. Click to restart and update (do not do this during a live meeting)."
            className="inline-flex items-center gap-1.5 rounded-full bg-accent px-3 py-1 text-xs font-semibold text-white shadow ring-2 ring-accent/40 hover:brightness-110"
          >
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />
            Update {state.update.version} ready - restart to install
          </button>
        )}
        {state.update.status === 'downloading' && (
          <Pill tone="warn">
            Downloading update {state.update.version} ... {state.update.percent}%
          </Pill>
        )}
        {(() => {
          const b = pluginBadge(state.plugin, cfg.transitions.crossGroupMode === 'seamless')
          return b ? (
            <button
              onClick={() => openSettings('transitions')}
              title="OBS plugin for Seamless Mode - click to open its settings"
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium hover:brightness-125 ${BADGE_CLASS[b.tone]}`}
            >
              <span className="h-1.5 w-1.5 rounded-full bg-current" />
              {b.text}
            </button>
          ) : null
        })()}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button
            onClick={resync}
            title="Click the live scene's EMEET preset again (use it if the camera is not where the live scene expects)"
            className={`inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-[14px] font-semibold text-white shadow-md transition active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${resyncSent ? 'bg-ok' : 'bg-accent hover:brightness-110'}`}
          >
            <CameraIcon />
            {resyncSent ? 'Sent ✓' : 'Resync camera'}
          </button>
          <HelpTip title="Resync camera" align="right">
            Clicks the EMEET preset of the scene that is live right now. Use it if the camera is not pointing where that scene expects, for example after someone moved it by hand.
          </HelpTip>
          <Button kind="ghost" onClick={() => setConsoleOpen((o) => !o)} title="Show or hide the live log of what the app is doing">
            {consoleOpen ? 'Hide console' : 'Open console'}
          </Button>
          <Button onClick={() => openSettings()}>Settings</Button>
          <HelpTip title="Settings" align="right">
            OBS connection, transitions, EMEET preset positions (and how to add more presets), tracking buttons and start-up options.
          </HelpTip>
          <Button kind="primary" onClick={() => openHelp()} title="Open the help guide (F1)">
            Help
          </Button>
        </div>
      </header>

      {state.obs.status === 'connected' && !state.obs.studioMode && (
        <div role="alert" className="rounded-lg border border-bad/60 bg-bad/10 px-4 py-2.5 text-[13px] text-bad">
          <b>OBS Studio Mode is off.</b> Turn it on in OBS (the <b>Studio Mode</b> button in the Controls panel). EMEET–OBS Bridge needs it to work smoothly, so
          transitions and camera presets will not follow your scenes properly until it is on.
        </div>
      )}

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
      {helpTopic && <HelpGuide key={helpTopic} initial={helpTopic} entries={launch?.kind === 'updated' ? launch.entries : undefined} onClose={closeHelp} />}
      {tutorialOpen && <Tutorial onClose={() => setTutorialOpen(false)} />}
      {settingsOpen && <SettingsModal onHelp={openHelp} plugin={state.plugin} initialTab={settingsTab} cfg={cfg} dryRun={state.dryRun} onClose={() => setSettingsOpen(false)} onSaved={setCfg} />}
    </div>
  )
}
