import { describe, it, expect, vi, afterAll } from 'vitest'
import { startDock, DOCK_PORT } from '../src/main/dock'

const log: any = { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }
const resync = vi.fn()
const openWindow = vi.fn()
const state: any = { obs: { status: 'connected', studioMode: true }, program: 'A', preview: 'B', camera: { group: 'Preset1', driver: 'ready' } }
const cfg: any = { presets: { Preset1: { label: 'Stage' } }, scenes: { A: 'Preset1' } }
const server = startDock({ log, getState: () => state, getConfig: () => cfg, resync, openWindow })
const base = `http://127.0.0.1:${DOCK_PORT}`
afterAll(() => server.close())

describe('OBS dock server', () => {
  it('serves the dock page and state with the preset label', async () => {
    expect(await (await fetch(`${base}/dock`)).text()).toContain('EMEET Partner')
    const s = await (await fetch(`${base}/api/state`)).json()
    expect(s.cameraLabel).toBe('Stage')
  })
  it('rejects POST without the dock header, accepts it with', async () => {
    expect((await fetch(`${base}/api/resync`, { method: 'POST' })).status).toBe(403)
    expect(resync).not.toHaveBeenCalled()
    expect((await fetch(`${base}/api/resync`, { method: 'POST', headers: { 'X-Emeet-Dock': '1' } })).status).toBe(200)
    expect(resync).toHaveBeenCalledTimes(1)
    await fetch(`${base}/api/open`, { method: 'POST', headers: { 'X-Emeet-Dock': '1' } })
    expect(openWindow).toHaveBeenCalledTimes(1)
  })
})
