import { useEffect, useState, type ReactNode } from 'react'
import { Button } from './ui'

const DOCK_NAME = 'EMEET Partner'
const DOCK_URL = 'http://127.0.0.1:4577/dock'

type Spot = 'menu' | 'studio' | 'scenes' | 'dock' | 'preset' | 'transition' | 'resync' | null

/** A small picture of OBS with our dock on the right. `spot` pulses the part the step is about. */
function ObsMock({ spot, dockOpen, dropOpen, live }: { spot: Spot; dockOpen: boolean; dropOpen?: boolean; live?: 'preview' | 'program' }) {
  const ring = (s: Spot) => (spot === s ? 'tut-pulse' : '')
  return (
    <div className="tut-obs" aria-hidden>
      <div className={`tut-bar ${ring('menu')}`}>
        <span>File</span>
        <span>Edit</span>
        <span>View</span>
        <span className={spot === 'menu' ? 'text-accent' : ''}>Docks</span>
        <span>Tools</span>
      </div>
      <div className="tut-body">
        <div className="tut-main">
          <div className="tut-screens">
            <div className="tut-screen">
              <div className="tut-cap">Preview</div>
              <div className={`tut-pic ${live === 'preview' ? 'tut-pic-b' : ''}`} />
            </div>
            <div className={`tut-trans ${ring('transition')}`}>Transition</div>
            <div className="tut-screen">
              <div className="tut-cap">Program (live)</div>
              <div className={`tut-pic ${live === 'program' ? 'tut-pic-b' : ''}`} />
            </div>
          </div>
          <div className="tut-bottom">
            <div className={`tut-scenes ${ring('scenes')}`}>
              <div className="tut-cap">Scenes</div>
              <div className="tut-row">READER SETUP</div>
              <div className={`tut-row ${spot === 'scenes' || spot === 'preset' || spot === 'transition' ? 'tut-sel' : ''}`}>TABLE</div>
              <div className="tut-row">FULL STAGE</div>
            </div>
            <div className={`tut-studio ${ring('studio')}`}>
              <div className="tut-cap">Controls</div>
              <div className="tut-btn">Studio Mode</div>
            </div>
          </div>
        </div>
        {dockOpen && (
          <div className={`tut-dock ${ring('dock')}`}>
            <div className="tut-cap">EMEET Partner</div>
            <div className="tut-badges">
              <span className="tut-ok">OBS connected</span>
              <span className="tut-ok">EMEET detected</span>
            </div>
            <div className="tut-cap mt-2">Scene in Preview</div>
            <div className="tut-scene">TABLE</div>
            <div className={`tut-select ${ring('preset')}`}>Preset 3 - Table ▾</div>
            {dropOpen && (
              <div className="tut-drop">
                <div>Preset 1 - Stage</div>
                <div>Preset 2 - Reader</div>
                <div className="tut-sel">Preset 3 - Table</div>
              </div>
            )}
            <div className={`tut-btn mt-2 ${ring('resync')}`}>Resync camera</div>
          </div>
        )}
      </div>
    </div>
  )
}

const Copy = ({ label, value }: { label: string; value: string }) => {
  const [done, setDone] = useState(false)
  return (
    <div className="mt-2 flex items-center gap-2 text-[12px]">
      <span className="w-[74px] text-mute">{label}</span>
      <code className="flex-1 truncate rounded bg-bg px-2 py-1 font-mono">{value}</code>
      <Button
        onClick={() => {
          void navigator.clipboard.writeText(value).then(() => {
            setDone(true)
            setTimeout(() => setDone(false), 1500)
          })
        }}
      >
        {done ? 'Copied!' : 'Copy'}
      </Button>
    </div>
  )
}

interface Step {
  title: string
  text: ReactNode
  spot: Spot
  dockOpen: boolean
  dropOpen?: boolean
  live?: 'preview' | 'program'
}

const STEPS: Step[] = [
  {
    title: 'Add the dock to OBS (one time)',
    spot: 'menu',
    dockOpen: false,
    text: (
      <>
        <p>In OBS choose <b>Docks &gt; Custom Browser Docks...</b>, paste the name and the URL, press <b>Apply</b>, then <b>Close</b>. Keep this app running.</p>
        <Copy label="Dock name" value={DOCK_NAME} />
        <Copy label="Dock URL" value={DOCK_URL} />
      </>
    )
  },
  {
    title: 'Turn on Studio Mode',
    spot: 'studio',
    dockOpen: true,
    text: <p>Press <b>Studio Mode</b> in the OBS Controls panel. You then get two screens: <b>Preview</b> (what you prepare) and <b>Program</b> (what everyone sees).</p>
  },
  {
    title: '1. Pick the scene',
    spot: 'scenes',
    dockOpen: true,
    text: <p>Click the next scene in the OBS <b>Scenes</b> list. It goes into <b>Preview</b>, and the dock now shows its name under "Scene in Preview".</p>
  },
  {
    title: '2. Choose its camera preset',
    spot: 'preset',
    dockOpen: true,
    dropOpen: true,
    text: <p>In the dock, open the preset drop-down and pick the EMEET camera angle for that scene. It saves by itself. Scenes with the same preset share one camera angle.</p>
  },
  {
    title: '3. Press Transition',
    spot: 'transition',
    dockOpen: true,
    live: 'program',
    text: (
      <p>
        Press <b>Transition</b> in OBS. The scene fades in and the camera moves to its preset on its own. Same preset as the live scene: plain fade, camera untouched. Different preset: fade to black while the camera moves.
      </p>
    )
  },
  {
    title: 'If the camera looks wrong',
    spot: 'resync',
    dockOpen: true,
    text: <p>Press <b>Resync camera</b> in the dock. It clicks the live scene's preset again, for example if someone moved the camera by hand. That is all you need during a meeting.</p>
  }
]

export default function Tutorial({ onClose }: { onClose: () => void }) {
  const [i, setI] = useState(0)
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowRight') setI((n) => Math.min(n + 1, STEPS.length - 1))
      else if (e.key === 'ArrowLeft') setI((n) => Math.max(n - 1, 0))
    }
    document.addEventListener('keydown', key)
    return () => document.removeEventListener('keydown', key)
  }, [onClose])
  const s = STEPS[i]
  const last = i === STEPS.length - 1
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-label="OBS tutorial" className="flex max-h-full w-[min(760px,100%)] flex-col rounded-xl border border-line bg-panel shadow-2xl">
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="text-base font-semibold">OBS tutorial for JW AV operators</h2>
          <Button kind="ghost" onClick={onClose}>✕</Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <ObsMock key={i} spot={s.spot} dockOpen={s.dockOpen} dropOpen={s.dropOpen} live={s.live} />
          <div className="mt-4 text-[11px] uppercase tracking-wide text-mute">Step {i + 1} of {STEPS.length}</div>
          <h3 className="mb-1 text-[15px] font-semibold">{s.title}</h3>
          <div className="space-y-2 text-[13px] leading-relaxed">{s.text}</div>
        </div>
        <div className="flex items-center justify-between border-t border-line px-5 py-3">
          <div className="flex gap-1.5">
            {STEPS.map((_, n) => (
              <button key={n} aria-label={`Step ${n + 1}`} onClick={() => setI(n)} className={`h-2 w-2 rounded-full ${n === i ? 'bg-accent' : 'bg-line hover:bg-mute'}`} />
            ))}
          </div>
          <div className="flex gap-2">
            <Button disabled={i === 0} onClick={() => setI(i - 1)}>Back</Button>
            <Button kind="primary" onClick={() => (last ? onClose() : setI(i + 1))}>{last ? 'Done' : 'Next'}</Button>
          </div>
        </div>
      </div>
    </div>
  )
}
