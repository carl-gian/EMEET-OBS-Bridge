import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http'
import type { AppConfig, AppState } from '@shared/types'
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
    const g = s.camera.group
    return void json(res, 200, {
      ...s,
      cameraLabel: g ? (cfg.presets[g]?.label ?? g) : null,
      programPreset: cfg.scenes[s.program] ?? null
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
  .row{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:7px 10px;background:var(--card);border:1px solid var(--line);border-radius:6px;margin-bottom:6px}
  .k{color:var(--dim)}
  .v{text-align:right;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
  .dot{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:6px;background:var(--dim)}
  .ok .dot{background:var(--ok)}.warn .dot{background:var(--warn)}.bad .dot{background:var(--bad)}
  .btns{display:flex;gap:6px;margin-top:10px}
  button{flex:1;padding:9px 6px;border:1px solid var(--line);border-radius:6px;background:var(--card);color:var(--text);font:inherit;cursor:pointer}
  button.primary{background:var(--accent);border-color:var(--accent);color:#fff}
  button:hover{filter:brightness(1.15)}button:disabled{opacity:.5;cursor:default}
  #msg{margin-top:8px;color:var(--dim);min-height:1.2em;text-align:center}
  .dry{background:var(--warn);color:#000;border-radius:4px;padding:1px 6px;font-weight:600;margin-left:6px}
</style></head><body>
  <div class="row" id="obsRow"><span class="k">OBS</span><span class="v"><span class="dot"></span><span id="obs">...</span></span></div>
  <div class="row" id="camRow"><span class="k">Camera helper</span><span class="v"><span class="dot"></span><span id="cam">...</span></span></div>
  <div class="row"><span class="k">Camera preset</span><span class="v" id="preset">-</span></div>
  <div class="row"><span class="k">Program</span><span class="v" id="program" title="">-</span></div>
  <div class="row"><span class="k">Preview</span><span class="v" id="preview" title="">-</span></div>
  <div class="btns">
    <button class="primary" id="resync">Resync camera</button>
    <button id="open">Configure scenes</button>
  </div>
  <div id="msg"></div>
<script>
  const $ = (id) => document.getElementById(id)
  const post = (p) => fetch(p, { method: 'POST', headers: { 'X-Emeet-Dock': '1' } }).then((r) => { if (!r.ok) throw new Error(r.status) })
  const setRow = (rowId, cls) => { $(rowId).className = 'row ' + cls }
  const setText = (id, t) => { $(id).textContent = t; $(id).title = t }
  let msgTimer
  const say = (t) => { $('msg').textContent = t; clearTimeout(msgTimer); msgTimer = setTimeout(() => ($('msg').textContent = ''), 3000) }

  async function tick() {
    try {
      const s = await (await fetch('/api/state', { cache: 'no-store' })).json()
      const o = s.obs.status
      $('obs').textContent = o === 'connected' ? 'Connected' : o === 'connecting' ? 'Connecting...' : 'Not connected'
      if (s.dryRun) { const b = document.createElement('span'); b.className = 'dry'; b.textContent = 'DRY RUN'; $('obs').appendChild(b) }
      setRow('obsRow', o === 'connected' ? (s.obs.studioMode ? 'ok' : 'warn') : o === 'connecting' ? 'warn' : 'bad')
      if (o === 'connected' && !s.obs.studioMode) $('obs').textContent += ' (Studio Mode off)'
      const d = s.camera.driver
      $('cam').textContent = d === 'ready' ? 'Ready' : d === 'mock' ? 'Mock' : d === 'starting' ? 'Starting...' : d === 'error' ? 'EMEET not found' : 'Stopped'
      setRow('camRow', d === 'ready' || d === 'mock' ? 'ok' : d === 'starting' ? 'warn' : 'bad')
      setText('preset', s.cameraLabel || 'none yet')
      setText('program', s.program || '-')
      setText('preview', s.preview || '-')
    } catch {
      $('obs').textContent = 'App not responding'; setRow('obsRow', 'bad')
    }
  }
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
