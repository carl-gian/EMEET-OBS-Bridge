import { existsSync, readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import os from 'os'
import AdmZip from 'adm-zip'
import type { AppConfig, AppState } from '@shared/types'

/** Config as plain JSON with every secret removed - safe to send. */
export function redactedConfig(cfg: AppConfig) {
  const c: any = JSON.parse(JSON.stringify(cfg))
  c.obs.password = c.obs.password ? '<set>' : '<empty>'
  return c
}

export function buildDiagnosticsZip(opts: {
  zipPath: string
  logDir: string
  cfg: AppConfig
  state: AppState
  versions: Record<string, string>
  configPath: string
}) {
  const zip = new AdmZip()
  if (existsSync(opts.logDir)) {
    for (const f of readdirSync(opts.logDir)) if (f.endsWith('.log')) zip.addLocalFile(join(opts.logDir, f), 'logs')
  }
  zip.addFile('config-redacted.json', Buffer.from(JSON.stringify(redactedConfig(opts.cfg), null, 2), 'utf8'))
  zip.addFile('state.json', Buffer.from(JSON.stringify(opts.state, null, 2), 'utf8'))
  const sys = [
    `Exported: ${new Date().toISOString()}`,
    ...Object.entries(opts.versions).map(([k, v]) => `${k}: ${v}`),
    `OS: ${os.type()} ${os.release()} (${os.arch()})`,
    `CPU: ${os.cpus()[0]?.model ?? '?'} x${os.cpus().length}`,
    `RAM: ${Math.round(os.totalmem() / 1048576)} MB`,
    `Config file: ${opts.configPath}`,
    `Config file exists: ${existsSync(opts.configPath)}`,
    `Config file size: ${existsSync(opts.configPath) ? readFileSync(opts.configPath).length : 0} bytes`
  ].join('\n')
  zip.addFile('system.txt', Buffer.from(sys, 'utf8'))
  zip.writeZip(opts.zipPath)
}
