import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http'
import type { AppConfig, AppState } from '@shared/types'
import { normalizeSceneKey } from '@shared/scene'
import { presetNumber } from '@shared/presets'
import type { Logger } from './logger'

/**
 * Tiny local web server that powers the "EMEET Partner" dock inside OBS
 * (OBS > Docks > Custom Browser Docks > URL http://127.0.0.1:4577/dock).
 * It only LISTENS on 127.0.0.1 and runs outside OBS, so a problem here can never freeze OBS or delay a camera click.
 * It never touches the camera timing path: Resync just calls the same function as the tray menu item.
 */
export const DOCK_PORT = 4577

interface DockDeps {
  log: ReturnType<Logger['make']>
  getState: () => AppState
  getConfig: () => AppConfig
  resync: () => void
  openWindow: () => void
  setScenePreset: (scene: string, presetId: string | null) => void
  setSceneTracking: (scene: string, on: boolean) => void
}

const HOSTS = new Set([`127.0.0.1:${DOCK_PORT}`, `localhost:${DOCK_PORT}`])

export function startDock(d: DockDeps): Server {
  const server = createServer((req, res) => {
    try {
      handle(d, req, res)
    } catch (e) {
      d.log.error(`Dock request failed: ${(e as Error).message}`)
      res.writeHead(500).end()
    }
  })
  server.on('error', (e) => d.log.error(`OBS dock server could not start on port ${DOCK_PORT}: ${(e as Error).message}. The dock will not work; the rest of the app is fine.`))
  server.listen(DOCK_PORT, '127.0.0.1', () => d.log.info(`OBS dock ready: http://127.0.0.1:${DOCK_PORT}/dock`))
  return server
}

/** Reads a small JSON request body (max 4 KB). */
function readJson(req: IncomingMessage, done: (body: any) => void) {
  let raw = ''
  let tooBig = false
  req.on('data', (c) => {
    raw += c
    if (raw.length > 4096) tooBig = true
  })
  req.on('end', () => {
    if (tooBig) return done(null)
    try {
      done(JSON.parse(raw || '{}'))
    } catch {
      done(null)
    }
  })
}

function json(res: ServerResponse, code: number, body: unknown) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify(body))
}

function handle(d: DockDeps, req: IncomingMessage, res: ServerResponse) {
  // Block DNS-rebinding: only answer requests addressed to our own loopback host name.
  if (!HOSTS.has(String(req.headers.host ?? '').toLowerCase())) return void res.writeHead(403).end()
  const url = (req.url ?? '/').split('?')[0]

  if (req.method === 'GET' && (url === '/dock' || url === '/')) {
    return void res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }).end(DOCK_HTML)
  }
  if (req.method === 'GET' && url === '/api/state') {
    const s = d.getState()
    const cfg = d.getConfig()
    const key = normalizeSceneKey(s.preview)
    const lookup = <T,>(rec: Record<string, T>): T | undefined => {
      for (const [n, v] of Object.entries(rec)) if (normalizeSceneKey(n) === key) return v
      return undefined
    }
    const shown = Object.keys(cfg.presets)
      .filter((id) => presetNumber(id) <= cfg.presetCount)
      .sort((a, b) => presetNumber(a) - presetNumber(b))
      .map((id) => ({ id, label: cfg.presets[id].label }))
    return void json(res, 200, {
      obs: s.obs,
      camera: { driver: s.camera.driver },
      dryRun: s.dryRun,
      preview: s.preview,
      previewIsLive: !!s.preview && key === normalizeSceneKey(s.program),
      previewPreset: lookup(cfg.scenes) ?? null,
      previewTracking: !!lookup(cfg.sceneTracking),
      presets: shown
    })
  }
  if (req.method === 'POST' && (url === '/api/scene-preset' || url === '/api/scene-tracking')) {
    if (req.headers['x-emeet-dock'] !== '1') return void res.writeHead(403).end()
    return void readJson(req, (body) => {
      const s = d.getState()
      const scene = String(body?.scene ?? '')
      // Only the scene that is in Preview right now can be changed from the dock.
      if (!scene || normalizeSceneKey(scene) !== normalizeSceneKey(s.preview)) return json(res, 409, { ok: false, error: 'That scene is no longer in Preview.' })
      if (url === '/api/scene-preset') {
        const id = body?.presetId === null || body?.presetId === '' ? null : String(body?.presetId)
        const cfg = d.getConfig()
        if (id !== null && !(id in cfg.presets && presetNumber(id) <= cfg.presetCount)) return json(res, 400, { ok: false, error: 'Unknown preset.' })
        d.log.info(`Scene preset changed from the OBS dock: '${scene}' -> ${id ?? 'None'}`)
        d.setScenePreset(scene, id)
      } else {
        d.log.info(`Scene tracking changed from the OBS dock: '${scene}' -> ${body?.on === true ? 'ON' : 'off'}`)
        d.setSceneTracking(scene, body?.on === true)
      }
      json(res, 200, { ok: true })
    })
  }
  if (req.method === 'POST' && (url === '/api/resync' || url === '/api/open')) {
    // A custom header cannot be sent by another website without our permission (browsers block it), so random web pages can't press these.
    if (req.headers['x-emeet-dock'] !== '1') return void res.writeHead(403).end()
    if (url === '/api/resync') {
      d.log.info('Resync requested from the OBS dock.')
      d.resync()
    } else {
      d.log.info('Settings window requested from the OBS dock.')
      d.openWindow()
    }
    return void json(res, 200, { ok: true })
  }
  res.writeHead(404).end()
}

const DOCK_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>EMEET Partner</title>
<style>
  :root{color-scheme:dark;--bg:#16181d;--card:#1f232b;--line:#2d333d;--text:#e6e8ec;--dim:#8b93a1;--ok:#3fb950;--warn:#d29922;--bad:#f85149;--accent:#3b82f6}
  *{box-sizing:border-box}
  body{margin:0;padding:10px;background:var(--bg);color:var(--text);font:13px/1.35 "Segoe UI",system-ui,sans-serif}
  .badges{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px}
  .badge{display:inline-flex;align-items:center;gap:6px;padding:3px 9px;border-radius:999px;font-size:12px;font-weight:600;background:#2a2f38;color:var(--dim)}
  .badge i{width:8px;height:8px;border-radius:50%;background:currentColor}
  .badge.ok{background:rgba(63,185,80,.15);color:var(--ok)}
  .badge.warn{background:rgba(210,153,34,.16);color:var(--warn)}
  .badge.bad{background:rgba(248,81,73,.16);color:var(--bad)}
  .card{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:10px}
  .cap{font-size:11px;letter-spacing:.04em;text-transform:uppercase;color:var(--dim);margin-bottom:2px}
  .scene{font-size:14px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-bottom:10px}
  label.f{display:block;color:var(--dim);margin:0 0 4px}
  select{width:100%;padding:8px;border:1px solid var(--line);border-radius:6px;background:var(--bg);color:var(--text);font:inherit}
  select:focus{outline:2px solid var(--accent);outline-offset:1px}
  .chk{display:flex;align-items:center;gap:8px;margin-top:10px;cursor:pointer}
  .chk input{width:16px;height:16px;accent-color:var(--accent)}
  .empty{color:var(--dim);text-align:center;padding:14px 6px}
  .note{margin-top:10px;padding:7px 9px;border-radius:6px;font-size:12px;background:rgba(59,130,246,.12);color:#9cc0ff}
  .note.warn{background:rgba(210,153,34,.14);color:var(--warn)}
  .btns{display:flex;gap:6px;margin-top:10px}
  button{flex:1;padding:7px 6px;border:1px solid var(--line);border-radius:6px;background:var(--card);color:var(--text);font:inherit;cursor:pointer}
  button:hover{filter:brightness(1.15)}button:disabled{opacity:.5;cursor:default}
  #msg{margin-top:8px;color:var(--dim);min-height:1.2em;text-align:center;font-size:12px}
  [hidden]{display:none!important}
</style></head><body>
  <div class="badges">
    <span class="badge" id="obsB"><i></i><span id="obs">OBS ...</span></span>
    <span class="badge" id="camB"><i></i><span id="cam">EMEET ...</span></span>
    <span class="badge warn" id="dry" hidden><i></i>Dry run</span>
  </div>
  <div class="card">
    <div class="cap">Scene in Preview</div>
    <div id="empty" class="empty">Pick a scene in Preview to choose its EMEET preset.</div>
    <div id="panel" hidden>
      <div class="scene" id="scene" title=""></div>
      <label class="f" for="preset">EMEET preset for this scene</label>
      <select id="preset"></select>
      <label class="chk"><input type="checkbox" id="track"> Turn on EMEET tracking for this scene</label>
      <div class="note" id="saved" hidden></div>
    </div>
  </div>
  <div class="btns">
    <button id="resync" title="Click the live scene's EMEET preset again">Resync camera</button>
    <button id="open" title="Open the EMEET–OBS Bridge window">Open app</button>
  </div>
  <div id="msg"></div>
<script>
  const $ = (id) => document.getElementById(id)
  const post = (p, body) => fetch(p, { method: 'POST', headers: { 'X-Emeet-Dock': '1', 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) }).then((r) => { if (!r.ok) throw new Error(r.status); return r })
  let msgTimer
  const say = (t) => { $('msg').textContent = t; clearTimeout(msgTimer); msgTimer = setTimeout(() => ($('msg').textContent = ''), 3500) }
  const badge = (id, cls, text) => { $(id + 'B').className = 'badge ' + cls; $(id).textContent = text }
  let shownScene = null   // the Preview scene the controls currently show
  let changed = false     // a change was made for this scene: keep the "applies on Transition" note
  let live = false

  function showNote() {
    const n = $('saved')
    if (live) { n.className = 'note warn'; n.textContent = changed ? 'Saved. This scene is live now, so press Resync camera to apply it.' : 'This scene is live now. Press Resync camera to apply a change.'; n.hidden = !changed && !live; return }
    n.className = 'note'
    n.textContent = 'Saved. The camera will use this when you press Transition.'
    n.hidden = !changed
  }

  async function tick() {
    try {
      const s = await (await fetch('/api/state', { cache: 'no-store' })).json()
      const o = s.obs.status
      badge('obs', o === 'connected' ? (s.obs.studioMode ? 'ok' : 'warn') : o === 'connecting' ? 'warn' : 'bad',
        o === 'connected' ? (s.obs.studioMode ? 'OBS connected' : 'OBS: Studio Mode off') : o === 'connecting' ? 'OBS connecting' : 'OBS not connected')
      const d = s.camera.driver
      badge('cam', d === 'ready' ? 'ok' : d === 'mock' ? '' : d === 'starting' ? 'warn' : 'bad',
        d === 'ready' ? 'EMEET detected' : d === 'mock' ? 'EMEET not checked' : d === 'starting' ? 'EMEET looking...' : 'EMEET not detected')
      $('dry').hidden = !s.dryRun
      const has = !!s.preview && o === 'connected'
      $('empty').hidden = has
      $('panel').hidden = !has
      if (!has) { shownScene = null; return }
      if (s.preview !== shownScene) { shownScene = s.preview; changed = false; $('saved').hidden = true }
      live = s.previewIsLive
      $('scene').textContent = s.preview; $('scene').title = s.preview
      const sel = $('preset')
      const sig = s.presets.map((p) => p.id + p.label).join('|')
      if (sel.dataset.sig !== sig) {
        sel.dataset.sig = sig
        sel.innerHTML = ''
        const none = document.createElement('option'); none.value = ''; none.textContent = 'Not set (camera will not move)'; sel.appendChild(none)
        for (const p of s.presets) { const op = document.createElement('option'); op.value = p.id; op.textContent = p.id.replace('Preset', 'Preset ') + ' - ' + p.label; sel.appendChild(op) }
      }
      // never overwrite what the operator is choosing right now
      if (document.activeElement !== sel) sel.value = s.previewPreset || ''
      if (document.activeElement !== $('track')) $('track').checked = s.previewTracking
      if (live || changed) showNote()
    } catch {
      badge('obs', 'bad', 'App not responding')
    }
  }
  async function change(path, body) {
    try { await post(path, body); changed = true; showNote(); tick() }
    catch { say('Could not save. Is the preview scene still selected?') ; tick() }
  }
  $('preset').onchange = () => change('/api/scene-preset', { scene: shownScene, presetId: $('preset').value || null })
  $('track').onchange = () => change('/api/scene-tracking', { scene: shownScene, on: $('track').checked })
  $('resync').onclick = async () => {
    $('resync').disabled = true
    try { await post('/api/resync'); say('Resync sent.') } catch { say('Could not reach the app.') }
    setTimeout(() => ($('resync').disabled = false), 800)
  }
  $('open').onclick = async () => {
    try { await post('/api/open'); say('Opened the app window.') } catch { say('Could not reach the app.') }
  }
  tick(); setInterval(tick, 1000)
</script></body></html>`
