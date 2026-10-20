import { useState } from 'react'
import type { AppConfig, Point } from '@shared/types'
import { Button, Field, NumInput, Select, Switch, TextInput } from './ui'

type Tab = 'general' | 'obs' | 'transitions' | 'camera'
const TABS: { id: Tab; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'obs', label: 'OBS' },
  { id: 'transitions', label: 'Transition Rules' },
  { id: 'camera', label: 'Camera' }
]

export default function SettingsModal({ cfg, onClose, onSaved }: { cfg: AppConfig; onClose: () => void; onSaved: (c: AppConfig) => void }) {
  const [tab, setTab] = useState<Tab>('general')
  const [d, setD] = useState<AppConfig>(() => JSON.parse(JSON.stringify(cfg)))
  const [showPw, setShowPw] = useState(false)
  const [msg, setMsg] = useState('')

  // update a deep copy of the draft
  const edit = (fn: (c: AppConfig) => void) =>
    setD((prev) => {
      const next: AppConfig = JSON.parse(JSON.stringify(prev))
      fn(next)
      return next
    })

  const save = async () => {
    const saved = await window.api.saveConfig(d)
    onSaved(saved)
    onClose()
  }

  const browse = async (title: string, ext: string[], set: (p: string) => void) => {
    const p = await window.api.browseFile(title, ext)
    if (p) set(p)
  }

  const pt = (p: Point | null): Point => p ?? { x: 0, y: 0 }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="flex h-[min(760px,100%)] w-[min(860px,100%)] flex-col rounded-xl border border-line bg-panel shadow-2xl">
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="text-base font-semibold">Settings</h2>
          <Button kind="ghost" onClick={onClose}>
            ✕
          </Button>
        </div>
        <div className="flex gap-1 border-b border-line px-4">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`border-b-2 px-3 py-2 text-[13px] font-medium ${tab === t.id ? 'border-accent text-ink' : 'border-transparent text-mute hover:text-ink'}`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {/* ------------------------------------------------------------ General */}
          {tab === 'general' && (
            <>
              <Field label="EMEET Studio path" hint="The EMEET Studio .exe. Used to open it automatically if it is not running when a camera click is needed.">
                <div className="flex gap-2">
                  <TextInput value={d.emeet.exePath} onChange={(v) => edit((c) => (c.emeet.exePath = v))} placeholder="C:\Program Files\EMEET Studio\Emeet.exe" mono />
                  <Button onClick={() => browse('Pick the EMEET Studio program', ['exe'], (p) => edit((c) => (c.emeet.exePath = p)))}>Browse</Button>
                </div>
              </Field>
              <Field label="OBS Studio path" hint="The OBS .exe (usually ...\obs-studio\bin\64bit\obs64.exe).">
                <div className="flex gap-2">
                  <TextInput value={d.general.obsPath} onChange={(v) => edit((c) => (c.general.obsPath = v))} placeholder="C:\Program Files\obs-studio\bin\64bit\obs64.exe" mono />
                  <Button onClick={() => browse('Pick OBS Studio', ['exe'], (p) => edit((c) => (c.general.obsPath = p)))}>Browse</Button>
                </div>
              </Field>
              <div className="mb-4 flex flex-col gap-3">
                <Switch checked={d.general.launchObsOnStart} onChange={(v) => edit((c) => (c.general.launchObsOnStart = v))} label="Open OBS when this app starts (if it is not already running)" />
                <Switch checked={d.general.startWithWindows} onChange={(v) => edit((c) => (c.general.startWithWindows = v))} label="Start with Windows" />
                <Switch checked={d.general.startMinimized} onChange={(v) => edit((c) => (c.general.startMinimized = v))} label="When started by Windows, stay hidden in the tray" />
              </div>
              <Field label="Log detail" hint="Debug records every OBS event and click - best while we are testing. Logs are in the logs folder (Open logs).">
                <Select value={d.logging.level} onChange={(v) => edit((c) => (c.logging.level = v as AppConfig['logging']['level']))} className="w-56">
                  <option value="Debug">Debug (everything)</option>
                  <option value="Info">Info</option>
                  <option value="Warn">Warnings + errors</option>
                  <option value="Error">Errors only</option>
                </Select>
              </Field>
              <Field label="Old PowerShell settings" hint="Imports presets, scenes, OBS address/password and timings from your old OBS-Master-Controller.config.json. Replaces the current settings.">
                <Button
                  onClick={async () => {
                    const r = await window.api.importLegacy()
                    if (r.ok && r.config) {
                      setD(JSON.parse(JSON.stringify(r.config)))
                      onSaved(r.config)
                      setMsg('Imported and saved.')
                    } else if (r.error) setMsg('Import failed: ' + r.error)
                  }}
                >
                  Import old config ...
                </Button>
              </Field>
            </>
          )}

          {/* ---------------------------------------------------------------- OBS */}
          {tab === 'obs' && (
            <>
              <p className="mb-4 text-xs text-mute">In OBS: Tools &gt; WebSocket Server Settings. Tick "Enable WebSocket server" and copy the port and password here.</p>
              <div className="flex gap-4">
                <div className="flex-1">
                  <Field label="Server address (URL)">
                    <TextInput value={d.obs.host} onChange={(v) => edit((c) => (c.obs.host = v))} placeholder="localhost" mono />
                  </Field>
                </div>
                <Field label="Port">
                  <NumInput value={d.obs.port} onChange={(v) => edit((c) => (c.obs.port = v))} />
                </Field>
              </div>
              <Field label="Password">
                <div className="flex gap-2">
                  <TextInput type={showPw ? 'text' : 'password'} value={d.obs.password} onChange={(v) => edit((c) => (c.obs.password = v))} placeholder="(leave empty if OBS has no password)" />
                  <Button onClick={() => setShowPw((s) => !s)}>{showPw ? 'Hide' : 'Show'}</Button>
                </div>
                <div className="mt-1 text-xs text-mute">Stored encrypted for your Windows account.</div>
              </Field>
              <div className="flex gap-4">
                <Field label="Connect timeout (seconds)">
                  <NumInput value={d.obs.connectTimeoutSec} onChange={(v) => edit((c) => (c.obs.connectTimeoutSec = v))} />
                </Field>
                <Field label="Request timeout (seconds)">
                  <NumInput value={d.obs.requestTimeoutSec} onChange={(v) => edit((c) => (c.obs.requestTimeoutSec = v))} />
                </Field>
              </div>
              <p className="text-xs text-mute">Saving reconnects to OBS right away. The app keeps retrying by itself if OBS is closed.</p>
            </>
          )}

          {/* -------------------------------------------------- Transition rules */}
          {tab === 'transitions' && (
            <>
              <Field label="Same preset (intra-group)" hint="Both scenes use the same camera preset. The camera is not touched.">
                <div className="flex items-end gap-3">
                  <div className="flex-1">
                    <div className="mb-1 text-xs text-mute">OBS transition name</div>
                    <TextInput value={d.transitions.intraGroup.name} onChange={(v) => edit((c) => (c.transitions.intraGroup.name = v))} />
                  </div>
                  <div>
                    <div className="mb-1 text-xs text-mute">Duration (ms)</div>
                    <NumInput value={d.transitions.intraGroup.durationMs} onChange={(v) => edit((c) => (c.transitions.intraGroup.durationMs = v))} />
                  </div>
                </div>
              </Field>

              <Field label="Different preset (cross-group)" hint="The target scene uses a different camera preset, so the camera has to move.">
                <div className="mb-3 grid gap-2">
                  <label className={`flex cursor-pointer gap-3 rounded-lg border p-3 ${d.transitions.crossGroupMode === 'fast' ? 'border-accent bg-accent/10' : 'border-line'}`}>
                    <input type="radio" checked={d.transitions.crossGroupMode === 'fast'} onChange={() => edit((c) => (c.transitions.crossGroupMode = 'fast'))} />
                    <span>
                      <span className="font-medium">Fast Mode</span> <span className="text-xs text-ok">(proven on your rig)</span>
                      <span className="block text-xs text-mute">
                        One fade (normally to black). The camera preset is clicked a moment after the transition starts, so the move is hidden by the dip to black.
                      </span>
                    </span>
                  </label>
                  <label className={`flex cursor-pointer gap-3 rounded-lg border p-3 ${d.transitions.crossGroupMode === 'blackBridge' ? 'border-accent bg-accent/10' : 'border-line'}`}>
                    <input type="radio" checked={d.transitions.crossGroupMode === 'blackBridge'} onChange={() => edit((c) => (c.transitions.crossGroupMode = 'blackBridge'))} />
                    <span>
                      <span className="font-medium">Black Bridge</span> <span className="text-xs text-warn">(experimental)</span>
                      <span className="block text-xs text-mute">
                        Fade to a black scene → camera moves → hold on black → fade to the target scene. Needs a scene in OBS named as below (just a black Color Source).
                      </span>
                    </span>
                  </label>
                </div>
                <div className="flex items-end gap-3">
                  <div className="flex-1">
                    <div className="mb-1 text-xs text-mute">OBS transition name (Fast Mode)</div>
                    <TextInput value={d.transitions.crossGroup.name} onChange={(v) => edit((c) => (c.transitions.crossGroup.name = v))} />
                  </div>
                  <div>
                    <div className="mb-1 text-xs text-mute">Duration (ms)</div>
                    <NumInput value={d.transitions.crossGroup.durationMs} onChange={(v) => edit((c) => (c.transitions.crossGroup.durationMs = v))} />
                  </div>
                  <div>
                    <div className="mb-1 text-xs text-mute">Camera click after start (ms)</div>
                    <NumInput value={d.ptz.fireOffsetMs} onChange={(v) => edit((c) => (c.ptz.fireOffsetMs = v))} />
                  </div>
                </div>
              </Field>

              <Field label="Black Bridge settings">
                <div className="flex items-end gap-3">
                  <div className="flex-1">
                    <div className="mb-1 text-xs text-mute">Black scene name in OBS</div>
                    <TextInput value={d.blackBridge.sceneName} onChange={(v) => edit((c) => (c.blackBridge.sceneName = v))} />
                  </div>
                  <div>
                    <div className="mb-1 text-xs text-mute">Hold on black (ms)</div>
                    <NumInput value={d.blackBridge.holdMs} onChange={(v) => edit((c) => (c.blackBridge.holdMs = v))} />
                  </div>
                </div>
                <div className="mt-1 text-xs text-mute">In Black Bridge mode the fade to black and the fade to the target both use the "same preset" transition above.</div>
              </Field>

              <details className="rounded-lg border border-line p-3">
                <summary className="cursor-pointer text-[13px] font-medium">Advanced</summary>
                <div className="mt-3 flex flex-col gap-3">
                  <Switch checked={d.behavior.requireStudioMode} onChange={(v) => edit((c) => (c.behavior.requireStudioMode = v))} label="Warn loudly when OBS Studio Mode is off" />
                  <Switch checked={d.behavior.clearSceneTransitionOverridesOnStart} onChange={(v) => edit((c) => (c.behavior.clearSceneTransitionOverridesOnStart = v))} label="Clear per-scene transition overrides when connecting to OBS" />
                  <Switch checked={d.behavior.reprimeOnTransitionEnd} onChange={(v) => edit((c) => (c.behavior.reprimeOnTransitionEnd = v))} label="Prepare the next transition as soon as one ends" />
                  <Switch checked={d.ptz.syncOnStartup} onChange={(v) => edit((c) => (c.ptz.syncOnStartup = v))} label="Click the live scene's camera preset when connecting to OBS" />
                  <div>
                    <div className="mb-1 text-xs text-mute">Scenes with no preset behave as</div>
                    <Select value={d.behavior.unknownScenePolicy} onChange={(v) => edit((c) => (c.behavior.unknownScenePolicy = v as 'intra' | 'cross'))} className="w-72">
                      <option value="intra">Same preset (plain fade, never clicks)</option>
                      <option value="cross">Different preset (cross-group transition)</option>
                    </Select>
                  </div>
                </div>
              </details>
            </>
          )}

          {/* ------------------------------------------------------------- Camera */}
          {tab === 'camera' && (
            <>
              <Field
                label="Preset buttons in EMEET Studio"
                hint="Screen coordinates (pixels) of each preset button when the EMEET window is at the position below. Use Test click to check - it clicks the button in the background."
              >
                <div className="overflow-hidden rounded-lg border border-line">
                  <div className="grid grid-cols-[90px_1fr_90px_90px_90px] gap-2 bg-panel2 px-3 py-1.5 text-xs uppercase tracking-wide text-mute">
                    <div>Preset</div>
                    <div>Label</div>
                    <div>X</div>
                    <div>Y</div>
                    <div />
                  </div>
                  {Object.entries(d.presets).map(([id, p]) => (
                    <div key={id} className="grid grid-cols-[90px_1fr_90px_90px_90px] items-center gap-2 border-t border-line px-3 py-1.5">
                      <div className="text-[13px] text-mute">{id.replace(/^Preset/, 'Preset ')}</div>
                      <TextInput value={p.label} onChange={(v) => edit((c) => (c.presets[id].label = v))} />
                      <NumInput width="w-full" value={p.x ?? null} allowEmpty onChange={(v) => edit((c) => (c.presets[id].x = v ?? undefined))} />
                      <NumInput width="w-full" value={p.y ?? null} allowEmpty onChange={(v) => edit((c) => (c.presets[id].y = v ?? undefined))} />
                      <Button disabled={p.x == null || p.y == null} onClick={() => window.api.testClick(p.x!, p.y!, `${id} ${p.label}`)}>
                        Test click
                      </Button>
                    </div>
                  ))}
                </div>
                <div className="mt-2 flex gap-2">
                  <Button
                    onClick={() =>
                      edit((c) => {
                        const n = Math.max(0, ...Object.keys(c.presets).map((k) => Number(k.replace('Preset', '')) || 0)) + 1
                        c.presets[`Preset${n}`] = { label: `Preset ${n}` }
                      })
                    }
                  >
                    Add preset
                  </Button>
                  <Button
                    onClick={() => {
                      const ids = Object.keys(d.presets)
                      const last = ids[ids.length - 1]
                      if (!last) return
                      if (Object.values(d.scenes).includes(last)) setMsg(`${last} is still used by a scene - set that scene to None first.`)
                      else edit((c) => void delete c.presets[last])
                    }}
                  >
                    Remove last
                  </Button>
                </div>
              </Field>

              <Field label="Tracking buttons" hint="Used by scenes that have the Tracking box ticked in the Scene Manager. Leave 'Off button' empty if one button switches tracking on and off.">
                <div className="grid grid-cols-[110px_90px_90px_90px] items-center gap-2">
                  <div className="text-[13px]">On button</div>
                  <NumInput width="w-full" allowEmpty value={d.tracking.enableClick?.x ?? null} onChange={(v) => edit((c) => (c.tracking.enableClick = v == null && d.tracking.enableClick?.y == null ? null : { ...pt(c.tracking.enableClick), x: v ?? 0 }))} />
                  <NumInput width="w-full" allowEmpty value={d.tracking.enableClick?.y ?? null} onChange={(v) => edit((c) => (c.tracking.enableClick = v == null && d.tracking.enableClick?.x == null ? null : { ...pt(c.tracking.enableClick), y: v ?? 0 }))} />
                  <Button disabled={!d.tracking.enableClick} onClick={() => window.api.testClick(d.tracking.enableClick!.x, d.tracking.enableClick!.y, 'Tracking ON/toggle button')}>
                    Test click
                  </Button>
                  <div className="text-[13px]">Off button</div>
                  <NumInput width="w-full" allowEmpty value={d.tracking.disableClick?.x ?? null} onChange={(v) => edit((c) => (c.tracking.disableClick = v == null && d.tracking.disableClick?.y == null ? null : { ...pt(c.tracking.disableClick), x: v ?? 0 }))} />
                  <NumInput width="w-full" allowEmpty value={d.tracking.disableClick?.y ?? null} onChange={(v) => edit((c) => (c.tracking.disableClick = v == null && d.tracking.disableClick?.x == null ? null : { ...pt(c.tracking.disableClick), y: v ?? 0 }))} />
                  <Button disabled={!d.tracking.disableClick} onClick={() => window.api.testClick(d.tracking.disableClick!.x, d.tracking.disableClick!.y, 'Tracking OFF button')}>
                    Test click
                  </Button>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-6">
                  <div>
                    <div className="mb-1 text-xs text-mute">Wait after the preset click (ms)</div>
                    <NumInput value={d.tracking.delayAfterPresetMs} onChange={(v) => edit((c) => (c.tracking.delayAfterPresetMs = v))} />
                  </div>
                  <Switch checked={d.tracking.assumeInitiallyOn} onChange={(v) => edit((c) => (c.tracking.assumeInitiallyOn = v))} label="EMEET tracking is already ON when this app starts" />
                </div>
              </Field>

              <Field label="EMEET Studio window" hint="The app moves the EMEET window here (without focusing it) before clicking, so the coordinates above stay correct.">
                <div className="flex flex-wrap items-end gap-3">
                  {(['x', 'y', 'width', 'height'] as const).map((k) => (
                    <div key={k}>
                      <div className="mb-1 text-xs text-mute">{k === 'x' ? 'Left (X)' : k === 'y' ? 'Top (Y)' : k === 'width' ? 'Width' : 'Height'}</div>
                      <NumInput value={d.emeet.layout[k]} onChange={(v) => edit((c) => (c.emeet.layout[k] = v))} />
                    </div>
                  ))}
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-6">
                  <Switch checked={d.emeet.keepBehind} onChange={(v) => edit((c) => (c.emeet.keepBehind = v))} label="Keep EMEET behind other windows" />
                  <Switch checked={d.ptz.enabled} onChange={(v) => edit((c) => (c.ptz.enabled = v))} label="Camera automation on" />
                </div>
              </Field>

              <details className="rounded-lg border border-line p-3">
                <summary className="cursor-pointer text-[13px] font-medium">Advanced (window lookup and click timing)</summary>
                <div className="mt-3 flex flex-wrap gap-4">
                  <div>
                    <div className="mb-1 text-xs text-mute">Process name</div>
                    <TextInput value={d.emeet.processName} onChange={(v) => edit((c) => (c.emeet.processName = v))} />
                  </div>
                  <div>
                    <div className="mb-1 text-xs text-mute">Window title contains (optional)</div>
                    <TextInput value={d.emeet.windowTitleLike} onChange={(v) => edit((c) => (c.emeet.windowTitleLike = v))} />
                  </div>
                  <div>
                    <div className="mb-1 text-xs text-mute">Button hold (ms)</div>
                    <NumInput value={d.emeet.clickHoldMs} onChange={(v) => edit((c) => (c.emeet.clickHoldMs = v))} />
                  </div>
                  <div>
                    <div className="mb-1 text-xs text-mute">Pause between clicks (ms)</div>
                    <NumInput value={d.emeet.clickDelayMs} onChange={(v) => edit((c) => (c.emeet.clickDelayMs = v))} />
                  </div>
                  <div>
                    <div className="mb-1 text-xs text-mute">Wait for EMEET to open (s)</div>
                    <NumInput value={d.emeet.launchTimeoutSec} onChange={(v) => edit((c) => (c.emeet.launchTimeoutSec = v))} />
                  </div>
                </div>
              </details>
            </>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-line px-5 py-3">
          <div className="text-xs text-warn">{msg}</div>
          <div className="flex gap-2">
            <Button onClick={onClose}>Cancel</Button>
            <Button kind="primary" onClick={save}>
              Save
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
