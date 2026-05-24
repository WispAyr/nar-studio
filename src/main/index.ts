import { app, BrowserWindow, ipcMain, session, protocol, net } from 'electron'
import path from 'path'
import { pathToFileURL } from 'url'
import { registerIpcHandlers } from './ipc'
import { obsManager } from './obs'
import { hidManager } from './hid'
import { schedulePoller } from './schedule'
import { recordingManager } from './recording'
import { builtinRecorder } from './builtinRecorder'
import { builtinStreamer } from './builtinStreamer'
import { complianceLogger } from './complianceLogger'
import { healthMonitor } from './healthMonitor'
import { unrealLauncher, registerUnrealLauncherEvents, bindUnrealLauncherShutdown } from './unrealLauncher'
import { myriadBridge } from './myriadBridge'
import { cgAssets } from './cgAssets'
import { vizShaders } from './vizShaders'
import { popoutWindows } from './popoutWindows'

// The cg:// scheme serves CG assets to the renderer; privileged so assets
// drawn onto the program canvas don't taint it (recording needs captureStream).
protocol.registerSchemesAsPrivileged([
  { scheme: 'cg', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
])

let mainWindow: BrowserWindow | null = null

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1920,
    height: 1080,
    minWidth: 1400,
    minHeight: 800,
    backgroundColor: '#070708',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#0f0f12',
      symbolColor: '#ffffff',
      height: 32,
    },
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    title: 'NAR Studio Director',
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
    mainWindow.webContents.openDevTools({ mode: 'detach' })
    mainWindow.webContents.on('console-message', (_e, _level, message) => {
      console.log('[renderer]', message)
    })
  } else {
    mainWindow.loadFile(path.join(__dirname, '../../dist/index.html'))
  }

  mainWindow.on('closed', () => { mainWindow = null })
}

app.whenReady().then(async () => {
  // Local studio app — grant camera / microphone / display-capture requests.
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(true))
  session.defaultSession.setPermissionCheckHandler(() => true)

  // WebHID — let the renderer talk to a Stream Deck directly. Grant the
  // device the renderer asks for (the library already filters to Stream Decks).
  session.defaultSession.setDevicePermissionHandler(() => true)
  session.defaultSession.on('select-hid-device', (_event, details, callback) => {
    callback(details.deviceList[0]?.deviceId)
  })

  cgAssets.init()
  protocol.handle('cg', request => {
    const url = new URL(request.url)
    const file = cgAssets.resolve(url.hostname, decodeURIComponent(url.pathname.replace(/^\//, '')))
    return file
      ? net.fetch(pathToFileURL(file).toString())
      : new Response('Not found', { status: 404 })
  })

  vizShaders.init()
  createWindow()
  cgAssets.watch(() => mainWindow?.webContents.send('cg:changed'))
  vizShaders.watch(() => mainWindow?.webContents.send('viz-shaders:changed'))
  // FFmpeg lost the RTMP link — tell the renderer so it can reconnect.
  builtinStreamer.on('ended', () => mainWindow?.webContents.send('stream:ended'))
  // FFmpeg progress line — health widget consumes this at ~1 Hz.
  builtinStreamer.on('stats', s => mainWindow?.webContents.send('stream:stats', s))
  // A recording file failed to write (disk full, permissions) — warn the operator.
  builtinRecorder.on('error', (msg: string) => mainWindow?.webContents.send('rec:error', msg))
  registerIpcHandlers(ipcMain)

  // Start background services
  await obsManager.connect()
  hidManager.start()
  schedulePoller.start()
  recordingManager.init()
  complianceLogger.startBackgroundSweep()
  // Myriad MM_TRIGGER bridge — forward parsed events + raw packets to the
  // renderer for the inspector UI. Wire-up only; the renderer decides what
  // to do with each event (binding lives in the renderer's MyriadBridgeProvider).
  myriadBridge.on('event', e => mainWindow?.webContents.send('myriad:event', e))
  // Raw packets are stringified as latin1 + clipped to 256 chars so a noisy
  // Myriad can't flood the renderer with megabyte payloads.
  myriadBridge.on('raw', (buf: Buffer) => mainWindow?.webContents.send('myriad:raw', buf.toString('latin1').slice(0, 256)))
  // If the operator previously opted in, restart the listener on app boot.
  if (myriadBridge.getStatus().enabled) myriadBridge.start()
  healthMonitor.on('alert', a => mainWindow?.webContents.send('health:alert', a))
  healthMonitor.start()
  registerUnrealLauncherEvents(status => mainWindow?.webContents.send('unreal:status', status))
  bindUnrealLauncherShutdown()
  popoutWindows.closeAllOnQuit()
  // Optional auto-launch — only fires if the operator opted in.
  unrealLauncher.bootIfRequested()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', async () => {
  await recordingManager.stopAll()
  builtinRecorder.stopAll()
  complianceLogger.stopAll()
  hidManager.stop()
  schedulePoller.stop()
  myriadBridge.stop()
  if (process.platform !== 'darwin') app.quit()
})

export function getMainWindow() { return mainWindow }
