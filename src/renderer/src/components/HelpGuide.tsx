import { useEffect, useState, type ReactNode } from 'react'
import { CHANGELOG, compareVersions } from '@shared/changelog'
import { Button } from './ui'

type Topic = { id: string; title: string; body: ReactNode }

function Cursor({ className }: { className: string }) {
  return (
    <svg className={`hg-cursor hg-run ${className}`} viewBox="0 0 24 24" fill="#fff" stroke="#000" strokeWidth="1.2">
      <path d="M4 2l16 9-7 2-3 7z" />
    </svg>
  )
}

function Steps({ items }: { items: string[] }) {
  return (
    <ol className="mt-4 space-y-2 text-[13px]">
      {items.map((t, i) => (
        <li key={i} className={`hg-run hg-cap${i + 1} flex gap-2`}>
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent text-[11px] font-bold text-white">{i + 1}</span>
          <span>{t}</span>
        </li>
      ))}
    </ol>
  )
}

/** Animated mock: choose a camera preset for a scene in the Scene Manager. */
function DemoScenePreset() {
  return (
    <>
      <div className="hg-stage" aria-hidden>
        <div className="hg-abs left-3 top-2 text-[11px] uppercase tracking-wide text-mute">OBS scene</div>
        <div className="hg-abs left-[250px] top-2 text-[11px] uppercase tracking-wide text-mute">Camera preset</div>
        <div className="hg-abs left-3 top-[62px] w-[220px] truncate text-[13px]">READER SETUP (Watchtower &amp; CBS)</div>
        <div className="hg-abs left-3 top-[112px] w-[220px] truncate text-[13px] text-mute">TABLE (For Standing)</div>
        <div className="hg-box hg1-flash hg-run" style={{ left: 250, top: 60, width: 160, height: 30 }}>
          <span className="hg1-before hg-run hg-abs">None</span>
          <span className="hg1-after hg-run hg-abs">Preset 2 - Reader</span>
        </div>
        <div className="hg-box" style={{ left: 250, top: 110, width: 160, height: 30 }}>
          Preset 3 - Table
        </div>
        <div className="hg1-list hg-run hg-abs z-10 overflow-hidden rounded-md border border-line bg-panel2" style={{ left: 250, top: 92, width: 160 }}>
          <div className="px-2 py-1.5">None</div>
          <div className="whitespace-nowrap px-2 py-1.5">Preset 1 - Stage</div>
          <div className="hg1-item hg-run px-2 py-1.5">Preset 2 - Reader</div>
        </div>
        <Cursor className="hg1-cursor" />
      </div>
      <Steps items={['Find the scene in the Scene Manager list.', 'Open its "Camera preset" drop-down.', 'Pick the preset (camera angle) that scene should use. It saves by itself.']} />
    </>
  )
}

/** Animated mock: show more presets via Settings > Camera. */
function DemoAddPreset() {
  const tabs = ['General', 'OBS', 'Transition Rules', 'Camera']
  return (
    <>
      <div className="hg-stage" aria-hidden>
        <div className="hg-abs left-0 top-0 flex h-[36px] w-full gap-1 border-b border-line px-2">
          {tabs.map((t) => (
            <div key={t} className={`flex items-center rounded-t px-2.5 text-[12px] ${t === 'Camera' ? 'hg2-tab hg-run text-mute' : 'text-mute'}`}>
              {t}
            </div>
          ))}
        </div>
        {[1, 2, 3].map((n) => (
          <div key={n} className="hg-abs left-3 flex h-[26px] w-[414px] items-center border-b border-line/60 px-1" style={{ top: 44 + (n - 1) * 28 }}>
            <span className="w-[80px]">Preset {n}</span>
            <span className="text-mute">x, y</span>
          </div>
        ))}
        <div className="hg2-row hg-run hg-abs left-3 flex h-[26px] w-[414px] items-center border-b border-ok/60 bg-ok/10 px-1" style={{ top: 128 }}>
          <span className="w-[80px]">Preset 4</span>
          <span className="text-mute">x, y</span>
        </div>
        <div className="hg-box hg2-btn1 hg-run" style={{ left: 12, top: 162, height: 30, width: 120 }}>
          Edit presets
        </div>
        <div className="hg-box hg2-btn2 hg-run" style={{ left: 12, top: 162, height: 30, width: 120 }}>
          Add preset 4
        </div>
        <div className="hg-box hg2-save hg-run" style={{ left: 350, top: 162, height: 30, width: 76, justifyContent: 'center' }}>
          Save
        </div>
        <Cursor className="hg2-cursor" />
      </div>
      <Steps items={['Open Settings and go to the Camera tab.', 'Press "Edit presets", then "Add preset" (up to 8 presets; coordinates are preloaded).', 'Press Save. The new preset now appears in every scene\'s drop-down.']} />
    </>
  )
}

const P = ({ children }: { children: ReactNode }) => <p className="mb-3 text-[13px] leading-relaxed">{children}</p>
const H = ({ children }: { children: ReactNode }) => <h3 className="mb-2 mt-4 text-[13px] font-semibold">{children}</h3>

function WhatsNew({ since }: { since: string | null }) {
  return (
    <>
      {CHANGELOG.map((e) => (
        <div key={e.version} className="mb-4">
          <div className="mb-1 flex items-center gap-2 text-[13px] font-semibold">
            Version {e.version}
            <span className="text-[11px] font-normal text-mute">{e.date}</span>
            {since && compareVersions(e.version, since) > 0 && <span className="rounded-full bg-ok/20 px-2 py-0.5 text-[10px] font-semibold text-ok">NEW</span>}
          </div>
          <ul className="list-disc space-y-1 pl-5 text-[13px]">
            {e.items.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ul>
        </div>
      ))}
    </>
  )
}

const TOPICS = (since: string | null): Topic[] => [
  { id: 'whatsnew', title: "What's new", body: <WhatsNew since={since} /> },
  {
    id: 'start',
    title: 'Start here',
    body: (
      <>
        <P>EMEET–OBS Bridge watches OBS Studio. When you switch to a scene that needs a different camera angle, it clicks the matching preset button in EMEET Studio for you, in the background.</P>
        <H>Checklist before a meeting</H>
        <ul className="mb-3 list-disc space-y-1 pl-5 text-[13px]">
          <li>OBS is open, <b>Studio Mode is on</b>, and the header says "Connected".</li>
          <li>EMEET Studio is open and the header says the camera helper is ready.</li>
          <li>Every scene has a camera preset chosen in the Scene Manager.</li>
          <li>The screen is <b>1920 x 1080</b> (other resolutions are not supported yet).</li>
        </ul>
        <P>Use the topics on the left. The two animated guides show how to give a scene a preset and how to add more presets.</P>
      </>
    )
  },
  { id: 'preset', title: 'Set a preset for a scene', body: <DemoScenePreset /> },
  {
    id: 'more',
    title: 'Add more presets',
    body: (
      <>
        <DemoAddPreset />
        <P>
          <span className="mt-3 block" />
          New presets use the position of the matching button in EMEET Studio. Check each one with <b>Test click</b>. Remove a preset only after every scene using it is set to None.
        </P>
      </>
    )
  },
  {
    id: 'transitions',
    title: 'How transitions and the camera work',
    body: (
      <>
        <P>Scenes that share a preset form a group (the same camera angle).</P>
        <ul className="mb-3 list-disc space-y-1.5 pl-5 text-[13px]">
          <li><b>Same group:</b> a plain 1 s Fade. The camera is not touched.</li>
          <li><b>Different group, Fast Mode:</b> Fade to Black, and the camera preset is clicked as the transition starts.</li>
          <li><b>Different group, Seamless Mode:</b> fade to a black scene, move the camera while it is black, hold, then fade to your scene. Pick it in Settings &gt; Transition Rules.</li>
          <li><b>Another program changes the scene:</b> the camera is clicked as soon as OBS reports it.</li>
          <li><b>Press Transition when Program and Preview are the same scene:</b> re-clicks that scene's preset (a manual resync).</li>
        </ul>
        <P>The camera is never clicked twice for the same preset in a row.</P>
      </>
    )
  },
  {
    id: 'tracking',
    title: 'Tracking',
    body: (
      <>
        <P>Tick the <b>Tracking</b> box next to a scene to turn EMEET's auto-tracking on whenever that scene goes live. Scenes without the tick turn it off again.</P>
        <P>The tracking on/off button positions are in Settings &gt; Camera &gt; Tracking buttons.</P>
      </>
    )
  },
  {
    id: 'dock',
    title: 'OBS dock',
    body: (
      <>
        <P>A small panel inside OBS with status, Resync and Open settings.</P>
        <ol className="mb-3 list-decimal space-y-1 pl-5 text-[13px]">
          <li>Open Settings &gt; OBS and copy the dock name and URL.</li>
          <li>In OBS choose <b>Docks &gt; Custom Browser Docks</b>, paste both, press Apply, then Close.</li>
        </ol>
        <P>The dock only works while this app is running.</P>
      </>
    )
  },
  {
    id: 'trouble',
    title: 'Troubleshooting',
    body: (
      <>
        <ul className="mb-3 list-disc space-y-1.5 pl-5 text-[13px]">
          <li><b>OBS not connected:</b> check OBS's WebSocket server is on, then the address, port and password in Settings &gt; OBS.</li>
          <li><b>Camera does not move:</b> is EMEET Studio open? Is Dry run off? Try Test click in Settings &gt; Camera.</li>
          <li><b>Click in the wrong place:</b> the screen is probably not 1920 x 1080, or scaling changed.</li>
          <li><b>A scene never moves the camera:</b> it has no preset, or its name differs from OBS (see the log).</li>
        </ul>
        <P>Still stuck? Press <b>Export diagnostics</b> in the top bar and send the zip.</P>
      </>
    )
  },
  {
    id: 'app',
    title: 'Tray and updates',
    body: (
      <>
        <P>Closing the window keeps the app running in the tray. Right-click the tray icon for Show window, Resync, logs and Quit. The app can start hidden (Settings &gt; General).</P>
        <P>New versions download in the background and are installed only when you choose <b>Restart to update</b> in the tray menu, so they never interrupt a live meeting.</P>
      </>
    )
  }
]

export default function HelpGuide({ onClose, initial = 'start', since = null }: { onClose: () => void; initial?: string; since?: string | null }) {
  const [id, setId] = useState(initial)
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', esc)
    return () => document.removeEventListener('keydown', esc)
  }, [onClose])
  const topics = TOPICS(since)
  const topic = topics.find((t) => t.id === id) ?? topics[0]
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-label="Help" className="flex h-[min(620px,100%)] w-[min(820px,100%)] flex-col rounded-xl border border-line bg-panel shadow-2xl">
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="text-base font-semibold">Help</h2>
          <Button kind="ghost" onClick={onClose}>
            ✕
          </Button>
        </div>
        <div className="flex min-h-0 flex-1">
          <nav className="w-[210px] shrink-0 overflow-y-auto border-r border-line p-2">
            {topics.map((t) => (
              <button
                key={t.id}
                onClick={() => setId(t.id)}
                className={`mb-0.5 block w-full rounded-md px-3 py-2 text-left text-[13px] ${t.id === id ? 'bg-accent/20 text-ink' : 'text-mute hover:bg-panel2 hover:text-ink'}`}
              >
                {t.title}
              </button>
            ))}
          </nav>
          <div className="min-w-0 flex-1 overflow-y-auto p-5">
            <h2 className="mb-3 text-[15px] font-semibold">{topic.title}</h2>
            {topic.body}
          </div>
        </div>
      </div>
    </div>
  )
}
