import { createWriteStream, existsSync, mkdirSync, renameSync, statSync, unlinkSync, type WriteStream } from 'fs'
import { join } from 'path'
import type { LogEntry, LogLevel, LogSource } from '@shared/types'
import type { Log } from '@core/types'

const RANK: Record<LogLevel, number> = { Debug: 0, Info: 1, Warn: 2, Error: 3 }
const MAX_BYTES = 5 * 1024 * 1024
const KEEP = 5

function stamp(d = new Date()): string {
  const p = (n: number, w = 2) => String(n).padStart(w, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`
}

/** A rolling log file. app.log -> app.1.log -> ... (5 x 5 MB). */
class RollingFile {
  private stream: WriteStream | null = null
  private bytes = 0
  constructor(private dir: string, private name: string) {
    this.open()
  }
  private path(i = 0) {
    return join(this.dir, i === 0 ? `${this.name}.log` : `${this.name}.${i}.log`)
  }
  private open() {
    try {
      if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true })
      this.bytes = existsSync(this.path()) ? statSync(this.path()).size : 0
      this.stream = createWriteStream(this.path(), { flags: 'a', encoding: 'utf8' })
      this.stream.on('error', () => {})
    } catch {
      this.stream = null
    }
  }
  private rotate() {
    try {
      this.stream?.end()
      for (let i = KEEP - 1; i >= 0; i--) {
        const from = this.path(i)
        if (!existsSync(from)) continue
        if (i === KEEP - 1) unlinkSync(from)
        else renameSync(from, this.path(i + 1))
      }
    } catch {
      /* ignore */
    }
    this.open()
  }
  write(line: string) {
    if (!this.stream) return
    this.stream.write(line + '\n')
    this.bytes += Buffer.byteLength(line) + 1
    if (this.bytes > MAX_BYTES) this.rotate()
  }
  close() {
    this.stream?.end()
  }
}

export class Logger {
  level: LogLevel = 'Debug'
  private ring: LogEntry[] = []
  private app: RollingFile
  private ptz: RollingFile
  onEntry?: (e: LogEntry) => void

  constructor(readonly dir: string) {
    this.app = new RollingFile(dir, 'app')
    this.ptz = new RollingFile(dir, 'ptz')
  }

  write(level: LogLevel, source: LogSource, msg: string) {
    if (RANK[level] < RANK[this.level]) return
    const entry: LogEntry = { ts: stamp(), level, source, msg }
    this.ring.push(entry)
    if (this.ring.length > 2000) this.ring.splice(0, this.ring.length - 2000)
    const line = `${entry.ts} [${level.toUpperCase().padEnd(5)}] [${source}] ${msg}`
    this.app.write(line)
    // PTZ lines are ALSO kept in their own file so click timing can be audited on its own.
    if (source === 'PTZ' || source === 'EMEET') this.ptz.write(line)
    this.onEntry?.(entry)
  }

  tail(): LogEntry[] {
    return this.ring.slice()
  }

  clearView() {
    this.ring = []
  }

  make(source: LogSource): Log {
    return {
      debug: (m) => this.write('Debug', source, m),
      info: (m) => this.write('Info', source, m),
      warn: (m) => this.write('Warn', source, m),
      error: (m) => this.write('Error', source, m)
    }
  }

  close() {
    this.app.close()
    this.ptz.close()
  }
}
