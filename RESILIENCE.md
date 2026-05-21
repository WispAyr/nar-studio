# NAR Studio Director — Resilience

How the app behaves when things go wrong, and what to harden. Last reviewed 2026-05-21.

## External dependencies

| Dependency | Used for | If unavailable |
|---|---|---|
| Cameras (USB UVC) | all video, PTZ, scene analysis | per-camera — app runs with however many are connected |
| MediaPipe WASM + face model (jsDelivr CDN + Google Storage) | scene analysis, AI tracking, AI Director | **fetched at startup over the internet** — offline ⇒ AI features never initialise |
| `siphon.wispayr.online` | schedule, current/next show, presenter | no auto-record-by-show, no auto-titles; last poll kept in memory only |
| OBS WebSocket (`localhost:4455`) | OBS engine only | built-in engine unaffected; auto-reconnects every 5 s |
| RTMP ingest (YouTube, etc.) | streaming | streaming only |
| FFmpeg, Poppins font | RTMP streaming, CG titles | **bundled with the app** — resilient |

## Failure modes — current handling

**Handled well**

- **Camera unplug / device in use** — `CameraStreamProvider` retries every 5 s and recovers automatically once the device is free (e.g. after OBS releases it).
- **OBS down** — `obsManager` reconnects every 5 s; the built-in engine doesn't need OBS at all.
- **Siphon API down (while running)** — the poller catches the error and keeps the last good schedule; the app keeps running.
- **Recording container** — recordings are WebM/Matroska, written streaming. A truncated WebM (crash/power loss) is usually still playable up to the cut-off — unlike MP4, which needs its trailer. This was a deliberate, resilient choice.
- **Recording disk errors** — `builtinRecorder` write streams surface `error` events (disk full, permissions) to the operator as a red "⚠ DISK" banner in the Recording panel. ISO files encode as VP8 (the program stays VP9) so program + 4 ISO cameras + a stream don't overload the CPU.
- **Stream drop / RTMP loss** — the built-in streamer detects an unexpected FFmpeg exit (RTMP/network drop) and auto-reconnects with exponential backoff (2→30 s), relaunching both FFmpeg and the MediaRecorder (FFmpeg needs a fresh WebM header). The operator sees an honest **LIVE → RECONNECTING → STREAM LOST** status instead of a stuck "LIVE" badge. A clean operator stop never triggers a reconnect.

**Gaps**

- **Offline at startup** — MediaPipe's WASM + model load from a CDN. No internet at launch ⇒ scene analysis, AI tracking and AI Director don't start (the rest of the app is fine). *This is the priority fix.*
- **Siphon down at startup** — last-good schedule lives only in memory, not on disk; a restart while siphon is unreachable means no show data until it returns.
- **Renderer crash** — no auto-recovery; a renderer crash blanks the app until it's manually restarted.
- **Power loss mid-recording** — the WebM survives mostly intact but loses duration/seek metadata. A UPS on the studio PC is the real mitigation.

## Hardening plan (priority order)

1. **Bundle MediaPipe offline** — ship the `tasks-vision` WASM and the face model with the app and load them from disk via a local protocol. Removes the CDN dependency entirely.
2. **Persist last-good schedule** — write each siphon poll result to disk and load it on startup, so an offline launch still has show data.
3. **Segmented recording** — start a new recording file every N minutes so a crash costs only the last segment, not the whole show.
4. **Renderer crash auto-recovery** — handle `webContents` `render-process-gone` by reloading the window, and log it.
5. **Compositor watchdog** — detect a stalled render loop or frozen camera feed and recover.
6. **Operational** — a UPS on the studio PC; note that the PC itself and the USB bus remain single points of failure.

*Done: stream auto-reconnect (built-in RTMP); recording disk-error surfacing + VP8 ISO encoding.*

## Single points of failure

- The studio PC — one machine runs everything.
- The USB bus — all four cameras and audio share it.
- The network — only for streaming and (currently) startup AI; item 1 removes the AI dependency.
