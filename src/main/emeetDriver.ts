import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import type { DriverStatus, EmeetCfg, PtzCommand } from '@shared/types'
import type { Log, PtzSink } from '@core/types'

export interface EmeetDriver extends PtzSink {
  status: DriverStatus
  hwnd?: string
  onStatus?: () => void
  start(emeet: EmeetCfg): void
  ensure(emeet: EmeetCfg): void
  listWindows(): void
  stop(): void
}

/** JSON on one ASCII line (non-ASCII escaped) so Windows PowerShell never mis-decodes the pipe. */
function asciiJson(v: unknown): string {
  return JSON.stringify(v).replace(/[\u007f-\uffff]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'))
}

export function workerScriptPath(): string {
  return app.isPackaged ? join(process.resourcesPath, 'ptz-worker.ps1') : join(app.getAppPath(), 'resources', 'ptz-worker.ps1')
}

/**
 * Windows driver: ONE long-running powershell.exe running ptz-worker.ps1. Commands go in as JSON lines on stdin,
 * results come back on stdout. The helper keeps the EMEET window handle, so a click is ~tens of ms after the command.
 */
export class PowerShellDriver implements EmeetDriver {
  status: DriverStatus = 'stopped'
  hwnd?: string
  onStatus?: () => void
  private proc: ChildProcessWithoutNullStreams | null = null
  private buf = ''
  private stopping = false
  private restartTimer: ReturnType<typeof setTimeout> | null = null
  private restarts = 0
  private lastEmeet: EmeetCfg | null = null
  private pending = new Map<number, PtzCommand>()

  constructor(private log: Log, private ptzLog: Log, private emeetLog: Log) {}

  private setStatus(s: DriverStatus) {
    this.status = s
    this.onStatus?.()
  }

  start(emeet: EmeetCfg) {
    this.lastEmeet = emeet
    this.stopping = false
    if (this.proc) return
    const script = workerScriptPath()
    if (!existsSync(script)) {
      this.log.error(`PTZ helper script is missing: ${script}`)
      this.setStatus('error')
      return
    }
    this.setStatus('starting')
    this.log.info(`Starting PTZ helper: powershell.exe -File "${script}"`)
    const p = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    })
    this.proc = p
    p.stdout.setEncoding('utf8')
    p.stderr.setEncoding('utf8')
    p.stdout.on('data', (d: string) => this.onData(d))
    p.stderr.on('data', (d: string) => {
      for (const l of d.split(/\r?\n/)) if (l.trim()) this.ptzLog.error(`helper stderr: ${l}`)
    })
    p.stdin.on('error', () => {})
    p.on('error', (e) => {
      this.log.error(`Could not start powershell.exe: ${e.message}`)
      this.proc = null
      this.setStatus('error')
    })
    p.on('exit', (code) => {
      this.proc = null
      this.buf = ''
      this.pending.clear()
      if (this.stopping) {
        this.setStatus('stopped')
        return
      }
      this.setStatus('error')
      this.restarts++
      const wait = Math.min(30000, 1000 * 2 ** Math.min(this.restarts, 5))
      this.log.error(`PTZ helper exited (code ${code}) - restarting in ${Math.round(wait / 1000)} s.`)
      this.restartTimer = setTimeout(() => this.lastEmeet && this.start(this.lastEmeet), wait)
    })
  }

  private onData(chunk: string) {
    this.buf += chunk
    let i: number
    while ((i = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, i).replace(/\r$/, '')
      this.buf = this.buf.slice(i + 1)
      if (line) this.onLine(line)
    }
  }

  private onLine(line: string) {
    const sp = line.indexOf(' ')
    const tag = sp < 0 ? line : line.slice(0, sp)
    const rest = sp < 0 ? '' : line.slice(sp + 1)
    switch (tag) {
      case 'READY':
        this.restarts = 0
        this.setStatus('ready')
        this.log.info('PTZ helper started (waiting for EMEET window check).')
        if (this.lastEmeet?.enabled) this.ensure(this.lastEmeet)
        break
      case 'LOG':
        this.emeetLog.info(rest) // starts with the helper's own HH:mm:ss.fff timestamp
        break
      case 'ENSURED': {
        const [h, title] = rest.split('|')
        this.hwnd = h
        this.log.info(`PTZ driver ready (hwnd ${h}, '${title}')`)
        this.onStatus?.()
        break
      }
      case 'DONE':
        try {
          const r = JSON.parse(rest)
          const cmd = this.pending.get(r.id)
          this.pending.delete(r.id)
          const lag = cmd ? Date.now() - cmd.issuedAt : undefined
          this.ptzLog.info(
            `${r.presetId ? `Preset ${r.presetId}` : 'Click'}${r.label ? ` (${r.label})` : ''}: ${r.clicks} click(s) sent, ${r.afterCmdMs} ms after command arrived` +
              (r.lateMs ? `, LATE by ${r.lateMs} ms` : '') +
              (lag !== undefined ? `; total since decision ${lag} ms` : '')
          )
        } catch {
          this.ptzLog.info(`DONE ${rest}`)
        }
        break
      case 'ERR':
        try {
          const e = JSON.parse(rest)
          if (e.cmd === 'ensure') this.ptzLog.error(`EMEET window check failed: ${e.error}`)
          else this.ptzLog.error(`Camera click failed (${e.cmd}${e.id ? ' #' + e.id : ''}): ${e.error}`)
        } catch {
          this.ptzLog.error(`Camera helper error: ${rest}`)
        }
        break
      case 'FATAL':
        this.log.error(rest)
        this.setStatus('error')
        break
      case 'PONG':
        break
      default:
        this.emeetLog.debug(line)
    }
  }

  private write(obj: unknown) {
    if (!this.proc || !this.proc.stdin.writable) {
      this.ptzLog.error('PTZ helper is not running - command dropped (it restarts automatically).')
      return false
    }
    this.proc.stdin.write(asciiJson(obj) + '\n')
    return true
  }

  send(cmd: PtzCommand) {
    this.lastEmeet = cmd.emeet
    if (!this.proc) this.start(cmd.emeet)
    this.pending.set(cmd.id, cmd)
    this.write({ cmd: 'click', ...cmd })
  }

  ensure(emeet: EmeetCfg) {
    this.lastEmeet = emeet
    this.write({ cmd: 'ensure', emeet })
  }

  listWindows() {
    this.write({ cmd: 'list' })
  }

  stop() {
    this.stopping = true
    if (this.restartTimer) clearTimeout(this.restartTimer)
    if (this.proc) {
      try {
        this.proc.stdin.write('{"cmd":"quit"}\n')
        this.proc.stdin.end()
      } catch {
        /* ignore */
      }
      const p = this.proc
      setTimeout(() => {
        try {
          p.kill()
        } catch {
          /* ignore */
        }
      }, 500)
    }
  }
}

/** macOS / dev driver: logs what a real click would do. */
export class MockDriver implements EmeetDriver {
  status: DriverStatus = 'mock'
  hwnd = '0xMOCK'
  onStatus?: () => void
  private timers = new Set<ReturnType<typeof setTimeout>>()
  constructor(private ptzLog: Log, private emeetLog: Log) {}
  start() {
    this.onStatus?.()
  }
  ensure() {
    this.emeetLog.info('[MOCK] ensure EMEET window (not on Windows - nothing done)')
  }
  listWindows() {
    this.emeetLog.info('[MOCK] list windows (not on Windows)')
  }
  send(cmd: PtzCommand) {
    const fire = () => {
      const late = cmd.fireAt ? Date.now() - cmd.fireAt : 0
      for (const c of cmd.clicks) this.emeetLog.info(`[MOCK] click screen(${c.x},${c.y}) ${c.note ?? ''}`)
      this.ptzLog.info(`[MOCK] ${cmd.presetId ?? 'tracking'}: ${cmd.clicks.length} click(s) ${cmd.fireAt ? `(${late >= 0 ? '+' : ''}${late} ms vs schedule)` : 'immediately'}`)
    }
    const wait = cmd.fireAt ? cmd.fireAt - Date.now() : 0
    if (wait > 0) {
      const t = setTimeout(() => {
        this.timers.delete(t)
        fire()
      }, wait)
      this.timers.add(t)
    } else fire()
  }
  stop() {
    for (const t of this.timers) clearTimeout(t)
    this.timers.clear()
  }
}
