import { useState } from 'react'
import type { AppConfig, Point } from '@shared/types'
import { DEFAULT_PRESETS, MAX_PRESETS, MIN_PRESETS, presetNumber } from '@shared/presets'
import { Button, Field, HelpTip, NumInput, Select, Switch, TextInput } from './ui'

const DOCK_NAME = 'EMEET Partner'
const DOCK_URL = 'http://127.0.0.1:4577/dock'

type Tab = 'general' | 'obs' | 'transitions' | 'camera'
const TABS: { id: Tab; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'obs', label: 'OBS' },
  { id: 'transitions', label: 'Transition Rules' },
  { id: 'camera', label: 'Camera' }
]

const TAB_HELP: Record<Tab, string> = { general: 'app', obs: 'dock', transitions: 'transitions', camera: 'more' }

export default function SettingsModal({ cfg, dryRun, onClose, onSaved, onHelp }: { cfg: AppConfig; dryRun: boolean; onClose: () => void; onSaved: (c: AppConfig) => void; onHelp: (topic: string) => void }) {
  const [tab, setTab] = useState<Tab>('general')
  const [d, setD] = useState<AppConfig>(() => JSON.parse(JSON.stringify(cfg)))
  const [showPw, setShowPw] = useState(false)
  const [msg, setMsg] = useState('')
  const [unlocked, setUnlocked] = useState(false) // preset coordinates are locked until "Edit presets"
  const [confirmReset, setConfirmReset] = useState(false)

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

  const [copied, setCopied] = useState<'name' | 'url' | null>(null)
  const copyText = async (text: string, which: 'name' | 'url') => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(which)
      setTimeout(() => setCopied(null), 1500)
    } catch {
      /* clipboard blocked: the box is selectable, so the user can copy by hand */
    }
  }

  const browse = async (title: string, ext: string[], set: (p: string) => void) => {
    const p = await window.api.browseFile(title, ext)
    if (p) set(p)
  }

  const pt = (p: Point | null): Point => p ?? { x: 0, y: 0 }

  const presetIds = Object.keys(d.presets).sort((a, b) => presetNumber(a) - presetNumber(b))
  const shown = presetIds.filter((id) => presetNumber(id) <= d.presetCount)
  const highestUsed = Math.max(0, ...Object.values(d.scenes).map(presetNumber))

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4">
      <div className="flex h-[min(760px,100%)] w-[min(860px,100%)] flex-col rounded-xl border border-line bg-panel shadow-2xl">
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="text-base font-semibold">Settings</h2>
          <div className="flex items-center gap-2">
            <Button kind="ghost" onClick={() => onHelp(TAB_HELP[tab])} title="Open the help topic for this tab">
              ? Help with this tab
            </Button>
            <Button kind="ghost" onClick={onClose}>
              ✕
            </Button>
          </div>
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
              <Field label="EMEET Studio path" hint="Where EMEET Studio is installed. Only used if the switch below is on.">
                <div className="flex gap-2">
                  <TextInput value={d.emeet.exePath} onChange={(v) => edit((c) => (c.emeet.exePath = v))} placeholder="C:\Program Files\EMEET STUDIO\bin\64bit\EMEET STUDIO.exe" mono />
                  <Button onClick={() => browse('Pick the EMEET Studio program', ['exe'], (p) => edit((c) => (c.emeet.exePath = p)))}>Browse</Button>
                </div>
                <div className="mt-2">
                  <Switch checked={d.emeet.launchOnStart} onChange={(v) => edit((c) => (c.emeet.launchOnStart = v))} label="Open EMEET Studio when this app starts (and again if it is closed)" />
                </div>
              </Field>
              <Field label="OBS Studio path" hint="The OBS .exe (usually ...\obs-studio\bin\64bit\obs64.exe).">
                <div className="flex gap-2">
                  <TextInput value={d.general.obsPath} onChange={(v) => edit((c) => (c.general.obsPath = v))} placeholder="C:\Program Files\obs-studio\bin\64bit\obs64.exe" mono />
                  <Button onClick={() => browse('Pick OBS Studio', ['exe'], (p) => edit((c) => (c.general.obsPath = p)))}>Browse</Button>
                </div>
              </Field>
              <div className="mb-5">
                <Switch checked={d.general.launchObsOnStart} onChange={(v) => edit((c) => (c.general.launchObsOnStart = v))} label="Open OBS when this app starts (if it is not already running)" />
              </div>
              <div className="mb-5">
                <Switch checked={d.general.startWithWindows} onChange={(v) => edit((c) => (c.general.startWithWindows = v))} label="Start this app when Windows starts" />
              </div>
              <div className="mb-5">
                <Switch checked={d.general.startHidden} onChange={(v) => edit((c) => (c.general.startHidden = v))} label="Hide in the tray when this app starts" />
              </div>
              <Field label="Log detail" hint="Debug records every OBS event and click - best while we are testing. Logs are in the logs folder (Open logs).">
                <Select value={d.logging.level} onChange={(v) => edit((c) => (c.logging.level = v as AppConfig['logging']['level']))} className="w-56">
                  <option value="Debug">Debug (everything)</option>
                  <option value="Info">Info</option>
                  <option value="Warn">Warnings + errors</option>
                  <option value="Error">Errors only</option>
                </Select>
              </Field>
              <div className="rounded-lg border border-line p-3">
                <div className="flex items-center">
                  <Switch
                    checked={dryRun}
                    onChange={(v) => void window.api.setDryRun(v)}
                    label={
                      <span className="font-medium">
                        Dry run
                      </span>
                    }
                  />
                  <HelpTip title="Dry run">
                    When Dry run is ON, the app still watches OBS and writes every decision to the log (which transition it picked, which preset it would click), but it
                    sends <b>nothing</b> to OBS and <b>no clicks</b> to the camera. Use it to check your scene setup without moving the camera.
                    <br />
                    <br />
                    It switches itself OFF every time the app starts, and a yellow banner is shown while it is on.
                  </HelpTip>
                </div>
                <div className="mt-1 text-xs text-mute">Off by default. Takes effect immediately (no need to press Save).</div>
              </div>
              <div className="mt-5 rounded-lg border border-line p-3">
                <div className="mb-1 flex items-center text-sm font-medium">
                  Support
                  <HelpTip title="Support">
                    <b>Send diagnostics</b> prepares one zip and opens your email with the message ready; attach the zip and send. <b>Export diagnostics</b> just saves the zip where you choose. Either way the zip holds the logs, your settings (the OBS password is removed) and version numbers.
                    <b> Open logs folder</b> shows the raw log files.
                  </HelpTip>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    kind="primary"
                    onClick={async () => {
                      const r = await window.api.sendDiagnostics()
                      if (r.ok && r.emailOpened) setMsg('Your email app opened. Attach the highlighted zip file and press Send.')
                      else if (r.ok) setMsg('Diagnostics saved and shown in its folder. Send that zip file when asking for help.')
                      else if (r.error) setMsg('Could not prepare diagnostics: ' + r.error)
                    }}
                  >
                    Send diagnostics ...
                  </Button>
                  <Button
                    onClick={async () => {
                      const r = await window.api.exportDiagnostics()
                      if (r.ok) setMsg('Diagnostics saved. Send that zip when asking for help.')
                      else if (r.error) setMsg('Export failed: ' + r.error)
                    }}
                  >
                    Export diagnostics ...
                  </Button>
                  <Button onClick={() => void window.api.openLogs()}>Open logs folder</Button>
                </div>
              </div>
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

              <div className="mt-6 border-t border-line pt-4">
                <div className="mb-1 text-sm font-semibold">EMEET Partner dock for OBS</div>
                <p className="mb-3 text-xs text-mute">
                  Shows status and Resync / Configure buttons inside OBS. In OBS: <b>Docks &gt; Custom Browser Docks...</b>, paste the name and URL below, click <b>Apply</b>, then <b>Close</b>.
                  This app must be running for the dock to work.
                </p>
                <Field label="Dock name">
                  <div className="flex gap-2">
                    <TextInput value={DOCK_NAME} onChange={() => {}} mono />
                    <Button onClick={() => copyText(DOCK_NAME, 'name')}>{copied === 'name' ? 'Copied!' : 'Copy'}</Button>
                  </div>
                </Field>
                <Field label="Dock URL">
                  <div className="flex gap-2">
                    <TextInput value={DOCK_URL} onChange={() => {}} mono />
                    <Button kind="primary" onClick={() => copyText(DOCK_URL, 'url')}>{copied === 'url' ? 'Copied!' : 'Copy'}</Button>
                  </div>
                </Field>
              </div>
            </>
          )}

          {/* -------------------------------------------------- Transition rules */}
          {tab === 'transitions' && (
            <>
              <Field label="Same preset (intra-group)" hint="Both scenes use the same EMEET preset. The camera is not touched.">
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

              <Field label="Different preset (cross-group)" hint="The target scene uses a different EMEET preset, so the camera has to move.">
                <div className="mb-3 grid gap-2">
                  <label className={`flex cursor-pointer gap-3 rounded-lg border p-3 ${d.transitions.crossGroupMode === 'fast' ? 'border-accent bg-accent/10' : 'border-line'}`}>
                    <input type="radio" checked={d.transitions.crossGroupMode === 'fast'} onChange={() => edit((c) => (c.transitions.crossGroupMode = 'fast'))} />
                    <span>
                      <span className="font-medium">Fast Mode</span>
                      <span className="block text-xs text-mute">One fade (normally to black). The EMEET preset is clicked as soon as you press Transition in OBS, so the camera moves while the fade runs.</span>
                    </span>
                  </label>
                  <label className={`flex cursor-pointer gap-3 rounded-lg border p-3 ${d.transitions.crossGroupMode === 'seamless' ? 'border-accent bg-accent/10' : 'border-line'}`}>
                    <input type="radio" checked={d.transitions.crossGroupMode === 'seamless'} onChange={() => edit((c) => (c.transitions.crossGroupMode = 'seamless'))} />
                    <span>
                      <span className="font-medium">Seamless Mode</span>
                      <span className="block text-xs text-mute">
                        Pick a scene in Preview and the app remembers it. Press Transition: fade to the black scene → EMEET preset is clicked the moment black is reached → hold on
                        black → fade to the remembered scene. While armed, OBS Preview shows the black scene.
                      </span>
                    </span>
                  </label>
                </div>

                {d.transitions.crossGroupMode === 'fast' && (
                  <div className="flex items-end gap-3">
                    <div className="flex-1">
                      <div className="mb-1 text-xs text-mute">OBS transition name</div>
                      <TextInput value={d.transitions.crossGroup.name} onChange={(v) => edit((c) => (c.transitions.crossGroup.name = v))} />
                    </div>
                    <div>
                      <div className="mb-1 text-xs text-mute">Duration (ms)</div>
                      <NumInput value={d.transitions.crossGroup.durationMs} onChange={(v) => edit((c) => (c.transitions.crossGroup.durationMs = v))} />
                    </div>
                    <div>
                      <div className="mb-1 flex items-center text-xs text-mute">
                        Camera click delay (ms)
                        <HelpTip title="Camera click delay">
                          How long to wait, after OBS says the transition has started, before the EMEET preset button is clicked.
                          <br />
                          <br />
                          <b>0 = instant</b> (default): the click is sent the moment you press Transition in OBS, before the fade finishes and before the camera has moved.
                          <br />
                          <br />
                          Raise it (for example 200) if you want the picture to start fading first and the camera to move a little later. OBS only reports the start
                          after you press Transition, so the click can never happen earlier than that.
                        </HelpTip>
                      </div>
                      <NumInput value={d.ptz.fireOffsetMs} onChange={(v) => edit((c) => (c.ptz.fireOffsetMs = v))} />
                    </div>
                  </div>
                )}

                {d.transitions.crossGroupMode === 'seamless' && (
                  <>
                    <div className="mb-3">
                      <div className="mb-1 text-xs text-mute">Black scene name in OBS (a scene with just a black Color Source)</div>
                      <TextInput value={d.seamless.sceneName} onChange={(v) => edit((c) => (c.seamless.sceneName = v))} />
                    </div>
                    <div className="flex flex-wrap items-end gap-3">
                      <div>
                        <div className="mb-1 text-xs text-mute">1. Fade to black (ms)</div>
                        <NumInput value={d.seamless.fadeToBlackMs} onChange={(v) => edit((c) => (c.seamless.fadeToBlackMs = v))} />
                      </div>
                      <div>
                        <div className="mb-1 text-xs text-mute">2. Camera clicks, then hold on black (ms)</div>
                        <NumInput value={d.seamless.holdMs} onChange={(v) => edit((c) => (c.seamless.holdMs = v))} />
                      </div>
                      <div>
                        <div className="mb-1 text-xs text-mute">3. Fade to the scene (ms)</div>
                        <NumInput value={d.seamless.fadeInMs} onChange={(v) => edit((c) => (c.seamless.fadeInMs = v))} />
                      </div>
                    </div>
                    <div className="mt-2 text-xs text-mute">Both fades use the "same preset" transition above (its name). Scene changes made by other programs skip the black and only move the camera.</div>
                  </>
                )}
              </Field>

              <details className="rounded-lg border border-line p-3">
                <summary className="cursor-pointer text-[13px] font-medium">Advanced</summary>
                <div className="mt-3 flex flex-col gap-3">
                  <Switch checked={d.behavior.clearSceneTransitionOverridesOnStart} onChange={(v) => edit((c) => (c.behavior.clearSceneTransitionOverridesOnStart = v))} label="Clear per-scene transition overrides when connecting to OBS" />
                  <Switch checked={d.behavior.reprimeOnTransitionEnd} onChange={(v) => edit((c) => (c.behavior.reprimeOnTransitionEnd = v))} label="Prepare the next transition as soon as one ends" />
                  <Switch checked={d.ptz.syncOnStartup} onChange={(v) => edit((c) => (c.ptz.syncOnStartup = v))} label="Click the live scene's EMEET preset when connecting to OBS" />
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
                hint={
                  unlocked
                    ? 'Editing is ON. Screen coordinates (pixels) of each preset button when the EMEET window is at the position below. Press Done editing to lock them again.'
                    : 'Locked, so a stray click cannot change them. Press "Edit presets" to make changes. Test click still works.'
                }
              >
                <div className="overflow-hidden rounded-lg border border-line">
                  <div className="grid grid-cols-[90px_1fr_90px_90px_90px] gap-2 bg-panel2 px-3 py-1.5 text-xs uppercase tracking-wide text-mute">
                    <div>Preset</div>
                    <div>Label</div>
                    <div>X</div>
                    <div>Y</div>
                    <div />
                  </div>
                  {shown.map((id) => {
                    const p = d.presets[id]
                    return (
                      <div key={id} className="grid grid-cols-[90px_1fr_90px_90px_90px] items-center gap-2 border-t border-line px-3 py-1.5">
                        <div className="text-[13px] text-mute">{id.replace(/^Preset/, 'Preset ')}</div>
                        {unlocked ? (
                          <>
                            <TextInput value={p.label} onChange={(v) => edit((c) => (c.presets[id].label = v))} />
                            <NumInput width="w-full" value={p.x ?? null} allowEmpty onChange={(v) => edit((c) => (c.presets[id].x = v ?? undefined))} />
                            <NumInput width="w-full" value={p.y ?? null} allowEmpty onChange={(v) => edit((c) => (c.presets[id].y = v ?? undefined))} />
                          </>
                        ) : (
                          <>
                            <div className="truncate text-[13px]">{p.label}</div>
                            <div className="font-mono text-[13px]">{p.x ?? '-'}</div>
                            <div className="font-mono text-[13px]">{p.y ?? '-'}</div>
                          </>
                        )}
                        <Button disabled={p.x == null || p.y == null} onClick={() => window.api.testClick(p.x!, p.y!, `${id} ${p.label}`)}>
                          Test click
                        </Button>
                      </div>
                    )
                  })}
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {!unlocked ? (
                    <Button
                      onClick={() => {
                        setUnlocked(true)
                        setMsg('')
                      }}
                    >
                      🔒 Edit presets
                    </Button>
                  ) : (
                    <>
                      <Button
                        kind="primary"
                        onClick={() => {
                          setUnlocked(false)
                          setConfirmReset(false)
                        }}
                      >
                        Done editing
                      </Button>
                      <Button
                        disabled={d.presetCount >= MAX_PRESETS}
                        onClick={() => edit((c) => (c.presetCount = Math.min(MAX_PRESETS, c.presetCount + 1)))}
                        title={d.presetCount >= MAX_PRESETS ? 'All 8 presets are already shown' : `Show Preset ${d.presetCount + 1} (coordinates are preloaded)`}
                      >
                        Add preset {d.presetCount < MAX_PRESETS ? d.presetCount + 1 : ''}
                      </Button>
                      <HelpTip title="Add preset">
                        Shows the next preset (up to 8) in every scene's drop-down. Its click position is preloaded; check it with Test click, then Save.
                      </HelpTip>
                      <Button
                        disabled={d.presetCount <= MIN_PRESETS}
                        onClick={() => {
                          if (d.presetCount <= highestUsed) setMsg(`Preset ${d.presetCount} is still used by a scene - set that scene to None first.`)
                          else {
                            setMsg('')
                            edit((c) => (c.presetCount = Math.max(MIN_PRESETS, c.presetCount - 1)))
                          }
                        }}
                      >
                        Remove last
                      </Button>
                      {!confirmReset ? (
                        <Button onClick={() => setConfirmReset(true)}>Reset to defaults</Button>
                      ) : (
                        <span className="flex items-center gap-2 rounded-md border border-warn/50 px-2 py-1 text-xs text-warn">
                          Restore the original labels and coordinates of all 8 presets?
                          <Button
                            kind="primary"
                            onClick={() => {
                              edit((c) => (c.presets = JSON.parse(JSON.stringify(DEFAULT_PRESETS))))
                              setConfirmReset(false)
                              setMsg('Presets restored to the original labels and coordinates (click Save to keep).')
                            }}
                          >
                            Yes, restore
                          </Button>
                          <Button onClick={() => setConfirmReset(false)}>Cancel</Button>
                        </span>
                      )}
                    </>
                  )}
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
