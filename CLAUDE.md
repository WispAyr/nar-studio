# NAR Studio Director — Claude Instructions

This is an Electron + React + TypeScript desktop app for **Now Ayrshire Radio**'s studio. It controls 4× OBSBot Tiny 2 cameras, switches video, records ISO feeds per show, and streams to YouTube. It runs on **Windows**.

## Architecture

```
src/main/          ← Electron main process (Node.js, runs as privileged)
  index.ts         ← App bootstrap, window creation
  hid/
    obsbot.ts      ← OBSBot Tiny 2 USB HID protocol (PTZ, AI, presets, WB/exposure)
    index.ts       ← HID device manager — scans every 5s, manages 4 cameras
  obs.ts           ← OBS WebSocket client (obs-websocket-js v5), auto-reconnects
  schedule.ts      ← Polls siphon.wispayr.online/api/nar/schedule + /current every 60s
  recording.ts     ← Auto-starts/stops OBS recording at NAR show boundaries
  stream.ts        ← RTMP stream profiles (YouTube, Twitch, custom) via electron-store
  ipc.ts           ← All IPC handlers (main ↔ renderer bridge)

src/preload/
  index.ts         ← contextBridge — exposes window.studio API to renderer

src/renderer/      ← React UI (Vite, Tailwind, TypeScript)
  App.tsx          ← Root layout
  hooks/
    useSchedule.ts ← NAR show data + progress/countdown
    useOBS.ts      ← OBS state + cutTo()
    useCameras.ts  ← HID camera list
  components/
    schedule/ScheduleBanner.tsx   ← Top bar: ON AIR show, next show, clock
    audio/AudioPanel.tsx          ← Studio desk audio input, L/R VU meters, gain, mute
    multiview/MultiviewGrid.tsx   ← 2×2 camera grid
    multiview/CameraPreview.tsx   ← Single camera tile with live webcam feed + CUT overlay
    cameras/CameraControls.tsx    ← PTZ joystick, presets, AI tracking, WB/exposure
    router/VideoRouter.tsx        ← PGM/NDI/RTMP routing matrix
    stream/StreamPanel.tsx        ← RTMP profiles, Go Live / End Stream
    recording/RecordingPanel.tsx  ← Auto/manual record, elapsed timer, show quick-start
    layout/StatusBar.tsx          ← OBS state, camera count, REC/LIVE
```

## Running

```bash
npm install
npm run electron:dev    # Vite dev server + Electron together
```

**Prerequisites:**
- Node 20+
- OBS Studio 28+ — Tools → WebSocket Server Settings → Enable (default port 4455, no password needed on LAN)
- obs-ndi plugin for NDI in/out

## Key things to know

### OBSBot HID protocol (`src/main/hid/obsbot.ts`)
The protocol is reverse-engineered. VID `0x2B6D`, PID `0x0003`. Commands are 64-byte HID output reports. **This needs testing against a real device** — if PTZ/zoom/AI commands aren't working, check the CMD byte values and params against what OBSBot Center sends (use USBPcap or Wireshark with USBPcap to sniff). The `buildReport` function and CMD constants are the most likely place to tune.

### Audio routing
Audio comes from the **studio desk/mixer** (a Windows audio input device), NOT from the camera mics. The `AudioPanel` component:
- Enumerates `audioinput` devices via `navigator.mediaDevices`
- Captures the selected device with `AudioContext` for VU metering
- Tells OBS via IPC (`audio:set-device`) to use `wasapi_input_capture` with that device
- Mutes all four camera video sources in OBS so their built-in mics are silenced

### NAR schedule (`src/main/schedule.ts`)
Polls `https://siphon.wispayr.online/api/nar/schedule` and `/api/nar/current`. The siphon endpoint is public (no auth). Shows come from Now Ayrshire Radio's WordPress + ProRadio plugin. Fields: `uid`, `name`, `broadcaststart` (ISO 8601), `broadcastend`, `thumbnail`.

### Auto-recording (`src/main/recording.ts`)
Checks every 30s whether a NAR show is currently live. If yes and not recording → auto-starts OBS recording. When the show ends → auto-stops. Recording path: `Videos/NAR Studio/Recordings/<date>/<show-name-uid>/`. OBS records program output; ISO feeds need per-camera OBS scenes (CAM1–CAM4 are auto-created on first connect).

### OBS scenes
On first connect, `obs.ts` auto-creates scenes `CAM1`, `CAM2`, `CAM3`, `CAM4`, and `PROGRAM` if they don't exist. Each camera scene gets a `dshow_input` source. **The `video_device_id` will be blank on first run — go into OBS and set each camera source to the correct OBSBot device**, or extend `ensureScenes()` in `obs.ts` to enumerate and auto-assign.

### Stream profiles (`src/main/stream.ts`)
Stored in `electron-store` (`stream-profiles.json` in userData). Default profile points to YouTube. Stream key is entered in the Stream panel UI and saved to the store. Multiple profiles supported — pick one as active before going live.

### Video router
The router matrix in `VideoRouter.tsx` handles PGM cuts (via OBS scene switch). NDI routing is visual-only in the UI — actual NDI send/receive is handled by the obs-ndi OBS plugin. If you want programmatic NDI source control, add the `grandiose` npm package and wire it through a new `ndi.ts` main-process module.

## What still needs doing on Windows

1. **Test OBSBot HID** — plug in one camera, run `npm run electron:dev`, open DevTools console and check `[hid]` log lines. If the camera is found but PTZ doesn't respond, sniff the USB traffic from OBSBot Center to get the correct byte layout.

2. **OBS camera source assignment** — after first launch, open OBS (it'll be running minimised), go into each CAM1–CAM4 scene, and set the video capture device to the corresponding OBSBot camera. Or automate this in `ensureScenes()` by calling `GetInputList` and matching device names.

3. **Audio device** — select the studio desk/mixer from the Audio dropdown in the app. It'll appear by its WASAPI name. The selection persists in `localStorage`.

4. **NDI** — install [obs-ndi](https://github.com/obs-ndi/obs-ndi) plugin into OBS. NDI sources added to OBS will appear in the Video Router's OBS Scenes list automatically.

5. **Windows build** — once everything works in dev mode: `npm run build:win`. Produces an NSIS installer in `release/`.

## Environment / infrastructure

- Siphon endpoint: `https://siphon.wispayr.online` (public, no auth)
- OBS WebSocket: `ws://127.0.0.1:4455` (localhost, no auth by default)
- Stream profiles stored in Electron userData — back these up if reinstalling

## Style conventions

- Dark theme throughout: `surface-950` / `surface-900` / `surface-800` backgrounds
- Mono font (JetBrains Mono) everywhere
- Accent colours: `nar-red` (#e8003c) for PGM/live/record, `nar-green` for AI/connected, `nar-amber` for warnings/next show, `nar-blue` for selection
- No comments unless the why is non-obvious
- Keep IPC handlers in `ipc.ts` — don't scatter `ipcMain.handle` calls
