# Driving Unreal Engine from NAR Studio

NAR Studio uses Unreal Engine for visualizations through the same pattern broadcast facilities use Disguise / Notch / vMix with UE: **two processes, two pipes**.

```
NAR Studio ── OSC (UDP) ──→ Unreal Engine ── NDI / Spout / SDI ──→ NAR Studio camera input
   (control)                     (render)                              (video)
```

- **Out**: NAR Studio emits BPM, beat, level and band energies over OSC at 30 Hz. The Unreal project subscribes and drives Niagara emitters, material parameters, camera shake, Sequencer cues, anything you wire to it.
- **In**: Unreal outputs its viewport over NDI (free) or Spout (Windows, zero-copy). A virtual-webcam tool exposes that as a regular video device, and NAR Studio picks it up as one of CAM 1–4.

You get Niagara, Lumen, Nanite, MetaHumans, the marketplace, all of it. The WebGL viz still has a role for low-latency overlays (slate, captions, meters), it just stops being the only path.

## Prerequisites

- **Unreal Engine 5.3 or newer** — install via the Epic Games Launcher.
- **NDI Tools 5+** — <https://ndi.video/tools/>. Includes Webcam Input which exposes any NDI source as a Windows webcam.
- An empty Unreal project: choose the **Film / Video & Live Events** template; that ships with the Sequencer and broadcast presets pre-configured.

The plugins below are free; enable each from `Edit → Plugins`:

| Plugin | Source | Purpose |
| --- | --- | --- |
| **NDI IO** | NDI Tools installer | Output the level viewport as an NDI source |
| **OSC** | Engine (built-in) | Receive the metric stream from NAR Studio |
| **Niagara** | Engine (default on) | The particle systems most of this drives |

Restart the editor after enabling plugins.

## In NAR Studio

1. Open the **Viz** tab in the right panel.
2. Scroll to **External Engine · OSC**.
3. Enable **OUT**.
4. Leave **host** at `127.0.0.1` for a same-machine setup (recommended); set it to the UE host's LAN IP if Unreal runs on a separate render box.
5. Leave **port** at `9000`.

The rate readout should show ~270 msg/s once enabled (9 metrics × 30 Hz). If the visualizer detects a beat the discrete `/nar/beat` event fires once per onset on top of that.

## In Unreal — receiving OSC

1. Create a new **Empty Actor** Blueprint, name it `BP_NarOscReceiver`, drop it into the level.
2. In its **Construction Script**:
   - Create an OSC Server reference: `Create OSC Server → Receive From: 0.0.0.0, Port: 9000, Start Listening: true`.
   - Bind the server's **OnOscMessageReceived** event.
3. In the event:
   - From `Message`, call **Get Address**. Branch on the address string.
   - For each address (see schema below), call **Get Float** / **Get Int32** on the first argument and store it in a Blueprint variable.

Variables you'll want exposed on this actor (all `float` unless noted):

```
Bpm, BpmLocked, Level, Bass, Mid, Treble, Centroid, BeatPhase, Lufs
BeatCounter (int)   ← latched from /nar/beat; reads as +1 each onset
```

## OSC address schema

| Address | Type | Range | What it means |
| --- | --- | --- | --- |
| `/nar/bpm` | float | 60–200 | Current tempo. Smoothed in NAR Studio. |
| `/nar/bpmLocked` | float | 0/1 | 1 when the phase tracker has locked onto a grid. |
| `/nar/level` | float | 0–1 | Perceptual loudness. Smoothed. |
| `/nar/bass` | float | 0–1 | Low-band energy (sub + kick range). |
| `/nar/mid` | float | 0–1 | Mid-band energy (snare, body of music). |
| `/nar/treble` | float | 0–1 | High-band energy (cymbals, sibilance). |
| `/nar/centroid` | float | 0–1 | Spectral centroid — perceived brightness. |
| `/nar/beatPhase` | float | 0–1 | Sawtooth through the current beat (rises 0→1, snaps back on the next beat). |
| `/nar/lufs` | float | -60–0 | Momentary K-weighted loudness, LU. |
| `/nar/beat` | int | counter | Increments once per detected onset — perfect for spawn-on-beat. |

All metrics are 32-bit big-endian floats on the wire (OSC 1.0 spec). One message per metric, no OSC bundles, one UDP packet per dispatch. NAR Studio fires 30 dispatches per second.

## Wiring metrics to visuals

A starter Niagara setup that already feels great with just BPM + beat + bass:

- **Emitter spawn rate**: `40 + Level * 600`
- **Burst event** on `BeatCounter` change: spawn 200 particles
- **Lifetime**: `0.6 + (1 - Treble) * 1.5` — high-end snappy, low-end slow
- **Initial velocity**: scale `100 * (1 + Bass * 4)`
- **Colour ramp**: lerp by `Centroid` — blue at 0 (dark), amber at 0.5, red at 1 (bright)
- **Camera shake** at the level: amplitude = `Bass * 0.05`
- **Material emissive**: multiply by `1 + Level * 3`

For Lumen scenes, animate `PostProcessVolume → Exposure Compensation` by `Bass * -0.5` and you get the "lights pulse with the bass" effect baked in physically rather than as a hack.

## Returning video to NAR Studio

### NDI path (recommended — software only, any machine)

1. In Unreal, add an **NDI Broadcast Configuration** actor to the level.
2. Set it to output the **active viewport**, 1920×1080 @ 30 fps.
3. Save and Play in Editor — the level viewport is now an NDI source on the LAN, named after your machine.
4. On the NAR Studio machine, run **NDI Tools → Webcam Input**, pick the Unreal source from the dropdown. It now appears as a Windows webcam named "NewTek NDI Video".
5. In NAR Studio's camera selection, point one of CAM 1–4 at the NDI Video device.

Latency: ~3–5 frames end to end. For music visuals that's invisible.

### Spout path (zero-copy, same machine, Windows only)

1. Install the **Spout** plugin for UE5 from the Marketplace (free).
2. Drop a `Spout Sender` component into the level; set name to `nar-unreal`.
3. Install **SpoutCam** (`spout.zeal.co`) — exposes any Spout sender as a webcam.
4. In NAR Studio, point a camera slot at SpoutCam.

Sub-frame latency, but Windows-only and won't work over the network.

### SDI / HDMI (broadcast-grade, costs hardware)

Decklink card out from the UE machine, capture card on the NAR Studio machine. Same as the existing PTZ camera path — NAR Studio doesn't know it's Unreal, it just sees another camera. Zero latency, max quality, $300–$1000 per pair of cards.

## Going live with Unreal as the visualizer

Once the round-trip works:

1. Add the NDI Webcam Input (or SpoutCam) as a permanent camera in NAR Studio.
2. In the Switcher view it now sits alongside CAM 1–4 — clicking the tile cuts it to air.
3. The Director can use it like any other source. The Pace tracker keeps the OSC stream flowing so Unreal stays musically locked.

When you want to come back to the built-in WebGL visualizer, press `V` (or click the Viz tile). The visualizer keeps running in the background, so cuts are instant.

## Troubleshooting

**Rate counter shows 0 msg/s in NAR Studio.** UDP socket couldn't bind to the target. Most often a firewall rule. Confirm `127.0.0.1:9000` is reachable by running `Test-NetConnection 127.0.0.1 -Port 9000` (it'll fail unless something's listening, which is fine — we just want no firewall block).

**Rate is healthy but Unreal sees nothing.** Two likely culprits:
- The OSC Server actor in Unreal needs **Start Listening = true** explicitly (the default is false).
- Windows Defender Firewall is silently dropping inbound UDP to the UE process. Allow `UnrealEditor.exe` and your packaged UE app on private networks.

**Unreal NDI source doesn't appear in NDI Webcam Input.** The NDI Broadcast Configuration must be in a level that's actively *playing* (PIE or runtime build) — it doesn't broadcast from a paused editor view.

**Beat looks consistent but BPM drifts.** Pace tracker hasn't locked yet — the BPM Locked indicator (BRT/LUFS strip) shows `bpmLocked = 0`. Give it ~10 seconds of stable music; the lock survives breakdowns and builds once it has it.

**Visuals feel a frame behind.** Add an output delay of one frame in NAR Studio's Director if you need exact lip-sync with the cameras; otherwise it's invisible.
