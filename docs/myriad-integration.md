# Driving NAR Studio from Myriad Playout

NAR Studio listens for **MM_TRIGGER** UDP packets fired by Broadcast Radio's Myriad Playout (P-Square / Myriad 6+) and turns them into typed events. Today the bridge is a **stub** — it receives, parses, logs, and exposes events to the renderer. The mapping from "Myriad fired an advert" to "NAR fires a video bumper" is in the next commit; this doc covers the wire protocol so operators can configure Myriad now and the binding will pick it up later.

```
Myriad Playout ── MM_TRIGGER (UDP) ──→ NAR Studio (this listener) ──→ MyriadEvent
   (radio)                                  (main process)             (renderer)
```

- **In**: Myriad emits a UDP packet every time a configured item plays — adverts, shows, news, carts, music items, anything you wire `MM_TRIGGER` to.
- **Out (future commit)**: NAR Studio maps each event to a NAR action — fire a sponsor bumper when Myriad starts the matching advert, apply a NarShow when Myriad starts the matching show, drop the lower-third for news, etc.

Because the parser accepts JSON **and** two raw text shapes, you don't need a specific Myriad version — anything from 5.x onwards can be made to talk to it.

## Prerequisites

- **Myriad Playout 5.x or 6.x** with the Triggers / Macros configuration UI enabled (it's on by default).
- Network access between the Myriad machine and the NAR Studio machine. Same-host is fine and recommended for studio setups — point Myriad at `127.0.0.1`.
- A free UDP port on the NAR Studio host. The default is **5000** (Myriad's typical MM_TRIGGER target); change it on either side if 5000 conflicts.

No plugins, no additional software, no licence keys.

## In NAR Studio

1. Open **Settings → Myriad** (or wherever the operator UI lands — the provider exposes `setEnabled / setPort / setHost`).
2. Set **port** to `5000` (or whichever port Myriad will target).
3. Leave **bind host** at `0.0.0.0` for a typical "Myriad on the LAN" setup. For a same-host install, `127.0.0.1` is fine and slightly safer.
4. Toggle **enable**. The status row should turn to *listening on 0.0.0.0:5000*. Once Myriad starts firing, `messagesReceived` and `eventsParsed` will tick up.

The bridge persists its configuration via `electron-store` (file name `myriad-bridge.json` under `userData/`). It restarts automatically on app boot if `enabled` was true.

## In Myriad — sending MM_TRIGGER

The macro that fires UDP packets is `MM_TRIGGER` (older builds called it `MM_SEND_UDP`). Pick whichever **payload format** is easiest for you to author in the macro editor — the NAR Studio parser accepts all three.

### Format 1 — JSON envelope (preferred)

The cleanest format. Inside a Myriad macro:

```text
MM_TRIGGER("127.0.0.1", 5000, "{\"event\":\"advert-start\",\"name\":\"<%ITEMNAME%>\",\"duration\":<%ITEMLENGTH%>}")
```

Example payloads:

```json
{"event":"advert-start","name":"AYR CARPETS","duration":30}
{"event":"show-start","name":"DRIVE TIME","presenter":"Sarah"}
{"event":"news-start","duration":180}
{"event":"item-start","name":"Top Of The World","artist":"Carpenters","duration":222}
{"event":"cart-fire","name":"STING-2","duration":3}
```

### Format 2 — pipe-delimited

If escaping JSON inside Myriad's macro language is painful, send a pipe-delimited string instead. The format is `TYPE|NAME|DURATION|EXTRA`:

```text
MM_TRIGGER("127.0.0.1", 5000, "ADV|<%ITEMNAME%>|<%ITEMLENGTH%>")
MM_TRIGGER("127.0.0.1", 5000, "SHOW|<%SHOWNAME%>|<%SHOWLENGTH%>|<%PRESENTER%>")
MM_TRIGGER("127.0.0.1", 5000, "MUSIC|<%ITEMNAME%>|<%ITEMLENGTH%>|<%ARTIST%>")
```

The `EXTRA` field is interpreted as `presenter` for `show-start` and `artist` for `item-start`.

### Format 3 — KEY=VALUE lines

Some Myriad versions can only emit `KEY=VALUE` pairs. Newlines or semicolons separate fields:

```text
TYPE=ADV
NAME=AYR CARPETS
DURATION=30
```

Or on one line: `TYPE=ADV;NAME=AYR CARPETS;DURATION=30`.

Recognised keys (case-insensitive): `TYPE` / `EVENT` / `ITEMTYPE`, `NAME` / `TITLE`, `DURATION` / `LENGTH` / `SECS`, `PRESENTER` / `HOST`, `ARTIST`, `ID` / `MYRIADID` / `ITEMID`.

## Myriad item-type mappings

When the payload uses Myriad's raw item type (formats 2 and 3), the bridge maps it to a `MyriadEvent.event` value:

| Myriad item type | NAR event |
| --- | --- |
| `ADV`, `ADVERT`, `COMMERCIAL` | `advert-start` |
| `ADV-END`, `ADVERT-END` | `advert-end` |
| `NEWS` | `news-start` |
| `NEWS-END` | `news-end` |
| `SHOW`, `PROGRAM`, `PROGRAMME` | `show-start` |
| `SHOW-END`, `PROGRAM-END` | `show-end` |
| `CART`, `JINGLE`, `SWEEPER` | `cart-fire` |
| `MUSIC`, `SONG`, `TRACK`, `ITEM` | `item-start` |
| `ITEM-END` | `item-end` |
| *anything else* | `item-start` (catch-all) |

The catch-all means an unknown item type still produces an event the renderer can log + future-bind; nothing is silently dropped.

## MyriadEvent schema

The renderer-side consumer receives objects of this shape (canonical definition in `src/renderer/shows/types.ts`):

```ts
interface MyriadEvent {
  event:
    | 'show-start' | 'show-end'
    | 'advert-start' | 'advert-end'
    | 'news-start' | 'news-end'
    | 'item-start' | 'item-end'
    | 'cart-fire'
  name?: string         // item / show / advertiser name
  duration?: number     // seconds, if Myriad provides it
  presenter?: string    // for show-start
  artist?: string       // for item-start (music)
  myriadId?: string     // Myriad's stable item ID, if exposed
  raw?: string          // original payload, for debugging
}
```

All fields except `event` are optional — Myriad doesn't always know the duration or the artist, and we'd rather forward a partial event than drop it.

## Status + inspector

The bridge exposes status via `studio.myriadStatus()`:

```ts
{
  enabled: boolean,        // operator toggle
  listening: boolean,      // socket is bound and reading
  port: number,
  bindHost: string,
  messagesReceived: number,// every UDP packet, parseable or not
  eventsParsed: number,    // packets that turned into a MyriadEvent
  parseErrors: number,     // packets we couldn't make sense of
  lastEventAt: number | null,
}
```

The renderer provider also keeps a rolling log of the last 50 parsed events and the last raw packet — wire this into a Settings → Myriad inspector panel to debug a misbehaving macro.

## Troubleshooting

**`messagesReceived` stays at 0.** UDP isn't reaching the NAR Studio host. Check:

- Windows Defender Firewall — allow inbound UDP on the configured port for the NAR Studio executable (Electron's main process). Same-host (`127.0.0.1`) is usually exempt.
- The Myriad macro's destination IP matches the NAR Studio host. If they're on different LAN segments, route accordingly.
- Verify with PowerShell from the Myriad host: `Test-NetConnection -ComputerName <nar-host> -Port 5000 -InformationLevel Detailed`. UDP shows as "no response" even on success — that's expected. A *firewall* block will return "TcpTestSucceeded: False" with a fast failure.

**Port conflict — `bind EADDRINUSE`.** Another service on the NAR Studio host already holds the port. Find it with `Get-NetUDPEndpoint -LocalPort 5000` and either stop it or change the Myriad target port. The bridge logs the bind error to the main-process console; the status will show `listening: false`.

**`messagesReceived` ticks up but `eventsParsed` doesn't.** Myriad is sending something the parser can't decode. Open the inspector — the *last raw packet* field shows exactly what arrived. Common gotchas:

- Quotes inside JSON weren't escaped in the Myriad macro (you sent `{"event":advert-start}` instead of `{"event":"advert-start"}`).
- The macro is sending a literal `<%ITEMNAME%>` placeholder string because the token wasn't recognised — that's a Myriad macro error, not a NAR error.
- Trailing nulls / control characters from Myriad's UDP buffer. The parser tolerates them, but if `event` looks weird, switch to the pipe-delimited format.

**Bridge restarts on every port change.** Expected. Changing port or host closes the socket and re-binds, so the listener has the latest config. Stats are preserved.

**`event → NAR action` isn't firing.** That binding isn't implemented yet — this commit is the **bridge stub** only. The renderer receives + logs the event, but no NAR action runs. The next commit wires `applyMyriadEvent` into `ShowsProvider`, `BumpersProvider`, etc.

## Roadmap (next commit)

- `MyriadActionBinder` hook subscribes to `useMyriadBridge().events`:
  - `show-start` → `shows.applyShowByName(e.name)`
  - `advert-start` → `bumpers.fireByName(e.name)` (fallback: a generic sponsor sting)
  - `news-start` → swap to the news CG package + drop lower-third
  - `cart-fire` → trigger matching cart-wall pad by name
  - `item-start` → update the now-playing CG with `name` + `artist`
- A Settings → Myriad panel exposing port / host / enable, plus the inspector log + raw-packet viewer for operators debugging their macros.
- Optional pre-roll offset — Myriad can fire MM_TRIGGER on item *cue* rather than item *start*, giving NAR a few hundred ms to load a bumper before the audio actually goes out.
