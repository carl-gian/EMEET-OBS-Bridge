// A tiny fake OBS (obs-websocket v5, no password) so the app can be tried on a Mac without OBS.
//   npm run fake-obs            then type commands in this terminal:
//   list                        show scenes
//   p <n>                       put scene n in PREVIEW
//   t                           press the Transition button
//   g <n>                       set PROGRAM directly (like Meeting Media Manager does)
//   q                           quit
import { WebSocketServer } from 'ws'
import readline from 'node:readline'

const PORT = Number(process.env.PORT || 4455)
const scenes = [
  'CLOSE UP----------(For talks only)',
  'FULL STAGE----------(For Prayers and Switching Speaker)',
  'SEMI-CLOSE UP----------(For Chairmans & Discussions)',
  'PODIUM & DISPLAY----------(For Displaying Pictures)',
  'READER SETUP---------- (Watchtower & CBS)',
  'TABLE ----------- (For Standing)',
  'TABLE CLOSE UP (For Sitting)',
  'PODIUM & TABLE----------(Ministry Part Counseling)',
  'BLACK SCREEN'
]
const transitions = [
  { transitionName: 'Cut', transitionKind: 'cut_transition', transitionFixed: true, transitionConfigurable: false },
  { transitionName: 'Fade', transitionKind: 'fade_transition', transitionFixed: false, transitionConfigurable: false },
  { transitionName: 'Fade to Black', transitionKind: 'fade_to_color_transition', transitionFixed: false, transitionConfigurable: true }
]
let program = scenes[1]
let preview = scenes[0]
let current = { transitionName: 'Fade', transitionKind: 'fade_transition', transitionDuration: 300 }
let inFlight = false
const clients = new Set()

const wss = new WebSocketServer({ port: PORT, handleProtocols: (protocols, req) => { console.log('protocols offered:', [...protocols], 'header:', req.headers['sec-websocket-protocol']); return protocols.has('obswebsocket.json') ? 'obswebsocket.json' : false } })
const log = (...a) => console.log(new Date().toISOString().slice(11, 23), ...a)
const send = (ws, op, d) => ws.send(JSON.stringify({ op, d }))
const emit = (eventType, eventData = {}) => {
  log('EVENT', eventType, JSON.stringify(eventData))
  for (const ws of clients) send(ws, 5, { eventType, eventIntent: 1, eventData })
}

function runTransition(newProgram) {
  if (inFlight) return
  inFlight = true
  emit('SceneTransitionStarted', { transitionName: current.transitionName, transitionUuid: 'x' })
  // OBS reports the new program scene part-way through the fade
  setTimeout(() => {
    program = newProgram
    emit('CurrentProgramSceneChanged', { sceneName: program, sceneUuid: 'x' })
  }, Math.min(300, current.transitionDuration / 2))
  setTimeout(() => {
    inFlight = false
    emit('SceneTransitionEnded', { transitionName: current.transitionName, transitionUuid: 'x' })
    // like OBS: after a transition the old program goes to preview
    preview = program
    emit('CurrentPreviewSceneChanged', { sceneName: preview, sceneUuid: 'x' })
  }, current.transitionDuration)
}

function handle(type, data = {}) {
  switch (type) {
    case 'GetVersion': return { obsVersion: '32.2.2 (fake)', obsWebSocketVersion: '5.7.4' }
    case 'GetStudioModeEnabled': return { studioModeEnabled: true }
    case 'GetSceneList': return { currentProgramSceneName: program, currentPreviewSceneName: preview, scenes: scenes.map((n, i) => ({ sceneName: n, sceneIndex: scenes.length - 1 - i })) }
    case 'GetSceneTransitionList': return { currentSceneTransitionName: current.transitionName, transitions }
    case 'GetCurrentSceneTransition': return current
    case 'GetSceneSceneTransitionOverride': return { transitionName: null, transitionDuration: null }
    case 'SetSceneSceneTransitionOverride': return {}
    case 'GetCurrentProgramScene': return { currentProgramSceneName: program, sceneName: program }
    case 'GetCurrentPreviewScene': return { currentPreviewSceneName: preview, sceneName: preview }
    case 'SetCurrentSceneTransition': {
      const t = transitions.find((x) => x.transitionName === data.transitionName)
      if (!t) throw { code: 600, comment: 'No transition ' + data.transitionName }
      current = { ...current, transitionName: t.transitionName, transitionKind: t.transitionKind }
      emit('CurrentSceneTransitionChanged', { transitionName: t.transitionName })
      return {}
    }
    case 'SetCurrentSceneTransitionDuration':
      current.transitionDuration = data.transitionDuration
      emit('CurrentSceneTransitionDurationChanged', { transitionDuration: data.transitionDuration })
      return {}
    case 'SetCurrentSceneTransitionSettings':
      if (!current.transitionKind.includes('color')) throw { code: 606, comment: 'Transition does not support custom settings' }
      return {}
    case 'SetCurrentPreviewScene':
      preview = data.sceneName
      emit('CurrentPreviewSceneChanged', { sceneName: preview, sceneUuid: 'x' })
      return {}
    case 'SetCurrentProgramScene':
      runTransition(data.sceneName)
      return {}
    case 'TriggerStudioModeTransition':
      runTransition(preview)
      return {}
    default:
      throw { code: 204, comment: 'Unknown request ' + type }
  }
}

wss.on('connection', (ws) => {
  log('client connected')
  send(ws, 0, { obsWebSocketVersion: '5.7.4', rpcVersion: 1 })
  ws.on('close', () => { clients.delete(ws); log('client disconnected') })
  ws.on('message', (raw) => {
    const m = JSON.parse(raw.toString())
    if (m.op === 1) { clients.add(ws); send(ws, 2, { negotiatedRpcVersion: 1 }); return }
    const run = (req) => {
      try {
        const responseData = handle(req.requestType, req.requestData)
        return { requestType: req.requestType, requestId: req.requestId, requestStatus: { result: true, code: 100 }, responseData }
      } catch (e) {
        return { requestType: req.requestType, requestId: req.requestId, requestStatus: { result: false, code: e.code ?? 500, comment: e.comment ?? String(e) } }
      }
    }
    if (m.op === 6) { const r = run(m.d); log('REQ', m.d.requestType, r.requestStatus.result ? 'ok' : r.requestStatus.comment); send(ws, 7, r) }
    if (m.op === 8) {
      const results = m.d.requests.map(run)
      log('BATCH', m.d.requests.map((r) => r.requestType).join(', '))
      send(ws, 9, { requestId: m.d.requestId, results })
    }
  })
})
log(`Fake OBS listening on ws://localhost:${PORT} (no password)`)

const rl = readline.createInterface({ input: process.stdin })
rl.on('line', (line) => {
  const [c, a] = line.trim().split(/\s+/)
  const name = scenes[Number(a)]
  if (c === 'list') scenes.forEach((s, i) => console.log(i, s, s === program ? '<- PROGRAM' : s === preview ? '<- PREVIEW' : ''))
  else if (c === 'p' && name) { preview = name; emit('CurrentPreviewSceneChanged', { sceneName: name, sceneUuid: 'x' }) }
  else if (c === 't') runTransition(preview)
  else if (c === 'g' && name) runTransition(name)
  else if (c === 'q') process.exit(0)
  else console.log('commands: list | p <n> | t | g <n> | q')
})
