# NAR Visualizer — Unreal Engine companion

A minimal UE 5 project that subscribes to NAR Studio Director's OSC metric stream and exposes every audio metric to Blueprints, Niagara, and Materials.

## Open it

```
Right-click NarVisualizer.uproject → "Generate Visual Studio project files"
Double-click NarVisualizer.uproject
```

The first launch will prompt to compile the `NarVisualizer` C++ module — click **Yes**. UE drives the build through its own toolchain; you don't need a separate `dotnet`/MSBuild invocation. A two-minute compile and you're in.

## Required engine plugins

These are all free; the `.uproject` already requests them but they need to be **installed** before they can be **enabled**:

- **OSC** — ships with the engine; just enabled via the `.uproject`. No download.
- **Niagara** — ships with the engine; on by default.
- **NDI IO** — install from <https://ndi.video/tools/> then `Edit → Plugins → Search "NDI" → Enable`. Restart the editor.

## Drop the receiver in your level

1. Make or open any level (`Content/Maps/MyMap`).
2. In the **Content Browser → C++ Classes → NarVisualizer**, drag `NarOscReceiver` into the scene.
3. Select the actor — in the **Details** panel:
   - `Listen Port` defaults to **9000** (matches NAR Studio's default).
   - `Listen Address` defaults to **0.0.0.0** (accept from any source).
   - Optionally pick a **Material Parameter Collection**: any material that references it will receive `Bpm`, `Bass`, `Mid`, etc. as live scalar parameters with no extra wiring.
   - Optionally drag your Niagara emitters into **Niagara Targets**: User Parameters named `User.Bpm`, `User.Bass`, … get poked automatically.

Play in editor (`Alt+P`). The actor's `B Connected` property flips true within a second of NAR Studio enabling its OSC bridge.

## Output to NAR Studio over NDI

1. Drop an **NDI Broadcast Configuration** actor into the level (`Place Actors → NDI IO`).
2. Source: **Active Viewport**, format **1920×1080 30fps**, name e.g. `NAR-UE`.
3. Run.
4. On the NAR Studio machine, run **NDI Tools → NewTek NDI Webcam Input** and pick the source.
5. In NAR Studio, point any camera slot at the resulting "NewTek NDI Video" webcam.

## Reading metrics in Blueprint

In any Blueprint:

1. Variable type: **`NAR Osc Receiver` (Actor reference)**, drag in the level instance.
2. **Drag off the reference → Get Bpm / Bass / Treble / …** — straight float reads, no events needed.
3. For beat events: drag off **Event On Beat** under the reference, plug it into a particle burst, camera shake, anything.

## Example wirings to try

| Source metric | Target |
| --- | --- |
| `Bpm` | Niagara emitter rate scaler, Sequencer playback rate |
| `Beat` event | Niagara `Spawn Burst Instantaneous` |
| `Bass` | Camera shake amplitude, Lumen post-process exposure (negative) |
| `Treble` | Particle lifetime (inverted — short on bright tracks) |
| `Centroid` | Colour ramp lookup (cool→warm), neon material hue |
| `Level` | Material emissive multiplier |
| `BeatPhase` | Anything that needs a sawtooth driven by tempo — light sweeps, scroll offsets |
| `BpmLocked` | Fade out a "warming up" overlay once locked |

## Troubleshooting

**Project won't compile.** Make sure you have Visual Studio 2022 (Community is fine) with the *Game development with C++* workload installed. UE refuses to compile without it.

**No metrics arriving.** Confirm NAR Studio's OSC bridge is **ON** in the Viz panel and `host: 127.0.0.1, port: 9000` matches. Windows Defender Firewall sometimes drops inbound UDP to a freshly-built UE binary — allow `UnrealEditor.exe` on private networks once.

**NDI source doesn't show up in NDI Webcam Input.** The NDI Broadcast Configuration only broadcasts during *Play* (PIE) or in a packaged build — a paused editor view doesn't tick it.

**Tick is too slow / metrics feel laggy.** Default tick interval on the receiver is 0.5 s for the watchdog only; metric handling is event-driven and fires the instant the UDP packet arrives — your visualisers will be reacting at full rate regardless of tick interval.
