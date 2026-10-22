import { describe, it, expect, vi, afterAll } from 'vitest'
import { startDock, DOCK_PORT } from '../src/main/dock'

const log: any = { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }
const resync = vi.fn()
const openWindow = vi.fn()
const setScenePreset = vi.fn()
const setSceneTracking = vi.fn()
const state: any = {
  obs: { status: 'connected', studioMode: true },
  program: 'Table',
  preview: 'Podium ---- (talks)',
  camera: { group: 'Preset1', driver: 'ready' }
}
const cfg: any = {
  presetCount: 3,
  presets: { Preset1: { label: 'Stage' }, Preset2: { label: 'Reader' }, Preset3: { label: 'Table' }, Preset4: { label: 'Four' } },
  scenes: { 'Podium----(talks)': 'Preset1' },
  sceneTracking: { 'Podium----(talks)': true }
}
const server = startDock({ log, getState: () => state, getConfig: () => cfg, resync, openWindow, setScenePreset, setSceneTracking })
const base = `http://127.0.0.1:${DOCK_PORT}`
const H = { 'X-Emeet-Dock': '1', 'Content-Type': 'application/json' }
const post = (path: string, body: unknown) => fetch(`${base}${path}`, { method: 'POST', headers: H, body: JSON.stringify(body) })
afterAll(() => server.close())

describe('OBS dock server', () => {
  it('serves the dock page', async () => {
    const html = await (await fetch(`${base}/dock`)).text()
    expect(html).toContain('Scene in Preview')
    expect(html).not.toContain('id="program"')
  })
  it('reports the Preview scene, its preset and tracking, and only the presets in use', async () => {
    const s = await (await fetch(`${base}/api/state`)).json()
    expect(s.preview).toBe('Podium ---- (talks)')
    expect(s.previewPreset).toBe('Preset1')
    expect(s.previewTracking).toBe(true)
    expect(s.previewIsLive).toBe(false)
    expect(s.presets.map((p: any) => p.id)).toEqual(['Preset1', 'Preset2', 'Preset3'])
    expect(s.camera.driver).toBe('ready')
  })
  it('rejects POST without the dock header, accepts it with', async () => {
    expect((await fetch(`${base}/api/resync`, { method: 'POST' })).status).toBe(403)
    expect(resync).not.toHaveBeenCalled()
    expect((await fetch(`${base}/api/resync`, { method: 'POST', headers: { 'X-Emeet-Dock': '1' } })).status).toBe(200)
    expect(resync).toHaveBeenCalledTimes(1)
    await fetch(`${base}/api/open`, { method: 'POST', headers: { 'X-Emeet-Dock': '1' } })
    expect(openWindow).toHaveBeenCalledTimes(1)
  })
  it('changes the preset and tracking of the Preview scene only', async () => {
    expect((await fetch(`${base}/api/scene-preset`, { method: 'POST', body: '{}' })).status).toBe(403)
    expect((await post('/api/scene-preset', { scene: 'Podium ---- (talks)', presetId: 'Preset2' })).status).toBe(200)
    expect(setScenePreset).toHaveBeenCalledWith('Podium ---- (talks)', 'Preset2')
    expect((await post('/api/scene-preset', { scene: 'Podium ---- (talks)', presetId: null })).status).toBe(200)
    expect(setScenePreset).toHaveBeenLastCalledWith('Podium ---- (talks)', null)
    expect((await post('/api/scene-tracking', { scene: 'Podium ---- (talks)', on: true })).status).toBe(200)
    expect(setSceneTracking).toHaveBeenCalledWith('Podium ---- (talks)', true)
    // not in Preview, or a preset that is not in use -> refused, nothing changes
    setScenePreset.mockClear()
    expect((await post('/api/scene-preset', { scene: 'Table', presetId: 'Preset1' })).status).toBe(409)
    expect((await post('/api/scene-preset', { scene: 'Podium ---- (talks)', presetId: 'Preset4' })).status).toBe(400)
    expect((await post('/api/scene-preset', { scene: 'Podium ---- (talks)', presetId: 'Nope' })).status).toBe(400)
    expect(setScenePreset).not.toHaveBeenCalled()
  })
})
