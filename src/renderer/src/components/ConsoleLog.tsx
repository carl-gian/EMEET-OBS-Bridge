import { useEffect, useMemo, useRef, useState } from 'react'
import type { LogEntry, LogLevel } from '@shared/types'
import { Button } from './ui'

const RANK: Record<LogLevel, number> = { Debug: 0, Info: 1, Warn: 2, Error: 3 }
const COLOR: Record<LogLevel, string> = { Debug: 'text-mute', Info: 'text-ink', Warn: 'text-warn', Error: 'text-bad' }
const SRC: Record<string, string> = { APP: 'text-accent', OBS: 'text-ok', PTZ: 'text-warn', EMEET: 'text-warn' }

export default function ConsoleLog({ entries, onClear }: { entries: LogEntry[]; onClear: () => void }) {
  const [level, setLevel] = useState<LogLevel>('Info')
  const [follow, setFollow] = useState(true)
  const box = useRef<HTMLDivElement>(null)
  const shown = useMemo(() => entries.filter((e) => RANK[e.level] >= RANK[level]), [entries, level])

  const toBottom = () => {
    if (box.current) box.current.scrollTop = box.current.scrollHeight
  }
  useEffect(() => {
    if (follow) toBottom()
  }, [shown, follow])
  // Follow turns itself off when you scroll up, and back on when you reach the bottom again.
  const onScroll = () => {
    const el = box.current
    if (!el) return
    setFollow(el.scrollHeight - el.scrollTop - el.clientHeight < 24)
  }

  return (
    <section className="relative flex h-full min-h-0 min-w-0 flex-col rounded-lg border border-line bg-panel">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <h2 className="text-[15px] font-semibold">Console Log</h2>
        <div className="flex items-center gap-2">
          <select value={level} onChange={(e) => setLevel(e.target.value as LogLevel)} className="rounded-md border border-line bg-bg px-2 py-1 text-xs">
            <option value="Debug">Debug (everything)</option>
            <option value="Info">Info</option>
            <option value="Warn">Warnings + errors</option>
            <option value="Error">Errors only</option>
          </select>
          <label className="flex items-center gap-1 text-xs text-mute">
            <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} /> Follow
          </label>
          <Button kind="ghost" onClick={() => navigator.clipboard.writeText(shown.map((e) => `${e.ts} [${e.level}] [${e.source}] ${e.msg}`).join('\n'))}>
            Copy
          </Button>
          <Button kind="ghost" onClick={onClear}>
            Clear
          </Button>
        </div>
      </div>
      <div
        ref={box}
        onScroll={onScroll}
        className="min-h-0 flex-1 overflow-y-auto px-3 py-2 font-mono text-[12px] leading-[1.45]"
      >
        {shown.length === 0 && <div className="p-4 text-center text-mute">Nothing logged yet.</div>}
        {shown.map((e, i) => (
          <div key={i} className={`whitespace-pre-wrap break-words ${COLOR[e.level]}`}>
            <span className="text-mute">{e.ts.slice(11)} </span>
            <span className={SRC[e.source] ?? ''}>[{e.source}]</span> {e.msg}
          </div>
        ))}
      </div>
      {!follow && (
        <button
          onClick={() => {
            setFollow(true)
            toBottom()
          }}
          className="absolute bottom-3 right-5 rounded-full bg-accent px-3 py-1.5 text-xs font-semibold text-white shadow-lg hover:brightness-110"
        >
          ↓ Jump to latest
        </button>
      )}
    </section>
  )
}
