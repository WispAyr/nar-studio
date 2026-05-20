import { app, BrowserWindow, ipcMain, session, protocol, net } from 'electron'
import path from 'path'
import { pathToFileURL } from 'url'
import { registerIpcHandlers } from './ipc'
import { obsManager } from './obs'
import { hidManager } from './hid'
import { schedulePoller } from './schedule'
import { recordingManager } from './recording'
import { cgAssets } from './cgAssets'

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

  cgAssets.init()
  protocol.handle('cg', request => {
    const url = new URL(request.url)
    const file = cgAssets.resolve(url.hostname, decodeURIComponent(url.pathname.replace(/^\//, '')))
    return file
      ? net.fetch(pathToFileURL(file).toString())
      : new Response('Not found', { status: 404 })
  })

  createWindow()
  cgAssets.watch(() => mainWindow?.webContents.send('cg:changed'))
  registerIpcHandlers(ipcMain)

  // Start background services
  await obsManager.connect()
  hidManager.start()
  schedulePoller.start()
  recordingManager.init()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', async () => {
  await recordingManager.stopAll()
  hidManager.stop()
  schedulePoller.stop()
  if (process.platform !== 'darwin') app.quit()
})

export function getMainWindow() { return mainWindow }
