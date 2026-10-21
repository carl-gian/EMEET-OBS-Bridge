import { useMemo } from 'react'
import type { AppConfig, AppState } from '@shared/types'
import { normalizeSceneKey } from '@shared/scene'
import { presetNumber } from '@shared/presets'
import { HelpTip, Pill, Switch } from './ui'

interface Row {
  name: string // exact OBS name (or the saved name when OBS doesn't have it)
  inObs: boolean
  preset: string
  tracking: boolean
}

export default function SceneManager({ state, cfg, onCfg, onHelp }: { state: AppState; cfg: AppConfig; onCfg: (c: AppConfig) => void; onHelp: (topic: string) => void }) {
  const rows = useMemo<Row[]>(() => {
    const lookup = <T,>(rec: Record<string, T>, name: string): T | undefined => {
      if (name in rec) return rec[name]
      const k = normalizeSceneKey(name)
      for (const [n, v] of Object.entries(rec)) if (normalizeSceneKey(n) === k) return v
      return undefined
    }
    const out: Row[] = state.scenes.map((name) => ({
      name,
      inObs: true,
      preset: lookup(cfg.scenes, name) ?? '',
      tracking: !!lookup(cfg.sceneTracking, name)
    }))
    const seen = new Set(out.map((r) => normalizeSceneKey(r.name)))
    for (const [name, preset] of Object.entries(cfg.scenes)) {
      if (!seen.has(normalizeSceneKey(name))) {
        seen.add(normalizeSceneKey(name))
        out.push({ name, inObs: false, preset, tracking: !!lookup(cfg.sceneTracking, name) })
      }
    }
    return out
  }, [state.scenes, cfg.scenes, cfg.sceneTracking])

  const allIds = Object.keys(cfg.presets).sort((a, b) => presetNumber(a) - presetNumber(b))
  const shownIds = allIds.filter((id) => presetNumber(id) <= cfg.presetCount)
  const connected = state.obs.status === 'connected'
  const unset = rows.filter((r) => r.inObs && !r.preset).length
  const isProgram = (n: string) => normalizeSceneKey(n) === normalizeSceneKey(state.program)
  const isPreview = (n: string) => normalizeSceneKey(n) === normalizeSceneKey(state.preview) && !isProgram(n)

  return (
    <section className="flex h-full min-h-0 min-w-0 flex-col rounded-lg border border-line bg-panel">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <div>
          <h2 className="text-[15px] font-semibold">Scene Manager</h2>
          <p className="text-xs text-mute">
            {connected ? `${state.scenes.length} scenes from OBS` : 'Not connected to OBS - showing your saved scenes'}
          </p>
        </div>
      </div>

      {connected && unset > 0 && (
        <div className="mx-4 mt-3 flex items-center justify-between gap-3 rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">
          <span>
            {unset} scene{unset > 1 ? 's have' : ' has'} no EMEET preset yet, so the camera will not move for {unset > 1 ? 'them' : 'it'}.
          </span>
          <button onClick={() => onHelp('preset')} className="shrink-0 rounded-md border border-warn/60 px-2 py-1 font-semibold hover:bg-warn/20">
            Show me how
          </button>
        </div>
      )}

      <div className="grid grid-cols-[1fr_190px_80px] gap-3 border-b border-line px-4 py-2 text-xs uppercase tracking-wide text-mute">
        <div>OBS scene</div>
        <div>
          EMEET preset
          <HelpTip title="EMEET preset">
            Scenes with the same preset share one camera angle, so switching between them never moves the camera. Need more presets than are listed? Settings &gt; Camera &gt; Edit presets &gt; Add preset.
          </HelpTip>
        </div>
        <div className="text-center" title="Turn EMEET tracking on while this scene is live">
          Tracking
          <HelpTip title="Tracking" align="right">
            Tick to turn EMEET auto-tracking on when this scene goes live. Unticked scenes turn it off.
          </HelpTip>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {rows.length === 0 && <div className="p-6 text-center text-mute">No scenes yet. Start OBS and this list fills in by itself.</div>}
        {rows.map((r) => (
          <div key={r.name} className={`grid grid-cols-[1fr_190px_80px] items-center gap-3 border-b border-line/60 px-4 py-2 ${isProgram(r.name) ? 'bg-bad/10' : isPreview(r.name) ? 'bg-ok/10' : ''}`}>
            <div className="min-w-0">
              <div className="truncate text-[13px]" title={r.name}>
                {r.name}
              </div>
              <div className="mt-0.5 flex gap-1.5">
                {isProgram(r.name) && <Pill tone="bad">LIVE</Pill>}
                {isPreview(r.name) && <Pill tone="ok">PREVIEW</Pill>}
                {!r.inObs && connected && <Pill tone="warn">not in OBS</Pill>}
              </div>
            </div>
            <select
              value={r.preset}
              onChange={async (e) => onCfg(await window.api.setSceneMapping(r.name, e.target.value || null))}
              className="rounded-md border border-line bg-bg px-2 py-1.5 text-[13px] outline-none focus:border-accent"
            >
              <option value="">None</option>
              {allIds.filter((id) => shownIds.includes(id) || id === r.preset).map((id) => (
                <option key={id} value={id}>
                  {id.replace(/^Preset/, 'Preset ')} - {cfg.presets[id].label}
                </option>
              ))}
            </select>
            <div className="flex justify-center">
              <input
                type="checkbox"
                className="h-4 w-4 accent-[var(--color-accent)]"
                checked={r.tracking}
                title="Turn EMEET tracking on when this scene goes live"
                onChange={async (e) => onCfg(await window.api.setSceneTracking(r.name, e.target.checked))}
              />
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
