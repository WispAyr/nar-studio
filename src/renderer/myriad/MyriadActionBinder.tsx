/**
 * Bridges Myriad MM_TRIGGER events into NAR actions.
 *
 * The bridge in `MyriadBridgeProvider` is receive-only — this hook is the
 * binding layer that turns received events into operator-visible behaviour:
 *
 *   show-start    → shows.applyShowByName(name)
 *   show-end      → shows.setCurrentShow(null)  (back to sustaining)
 *   advert-start  → bumpers.fireByName(name) — matching video sting on-air
 *   advert-end    → if a bumper is playing, stop it
 *   news-start    → set headline (if carried in event.name) + fire the
 *                   news-banner card
 *   news-end      → drop the news-banner card
 *   travel-start  → parse A77/M77-style route from event.name, set status,
 *                   fire the travel-banner card
 *   travel-end    → drop the travel-banner card
 *   cart-fire     → cartwall.fireByName(name) — operator-named sting cart
 *   item-start    → set the now-playing CG state if the event carries
 *                   {name, artist}
 *
 * Renders nothing. Mount once inside the provider tree (after Shows + Cart
 * + Bumper + CG providers are available). A small toast is fired on each
 * successful action so the operator can see Myriad bound to NAR — and a
 * different toast tone when a binding misses (no matching bumper, no
 * matching cart) so the operator can rename their asset to align.
 *
 * Persisted **enable** flag: `nar-myriad-binder` localStorage key. The
 * operator can flip it off from the Shows panel's Myriad section if they
 * want the bridge to keep logging events without driving NAR.
 */
import { useEffect, useRef, useState } from 'react'
import { useMyriadBridge } from './MyriadBridgeProvider'
import { useShows } from '../shows/ShowsProvider'
import { useBumperLibrary } from '../bumpers/BumperLibraryProvider'
import { useCartwall } from '../cartwall/CartWallProvider'
import { useCG } from '../cg/CGProvider'
import { useToast } from '../toast/ToastProvider'

const LS_KEY = 'nar-myriad-binder'

/**
 * Standalone toggle (lives outside the binder so the panel can flip it
 * without remounting the binder hook).
 */
export function useMyriadBinderEnabled(): [boolean, (v: boolean) => void] {
  const [enabled, setEnabledState] = useState(() => localStorage.getItem(LS_KEY) === 'on')
  const setEnabled = (v: boolean) => {
    localStorage.setItem(LS_KEY, v ? 'on' : 'off')
    setEnabledState(v)
  }
  return [enabled, setEnabled]
}

export function MyriadActionBinder() {
  const [enabled] = useMyriadBinderEnabled()
  const bridge = useMyriadBridge()
  const shows = useShows()
  const bumpers = useBumperLibrary()
  const cartwall = useCartwall()
  const cg = useCG()
  const toast = useToast()

  // Snapshot refs so the event loop reads fresh state without re-firing
  // when the providers re-render (the binder is event-driven, not
  // render-driven).
  const enabledRef = useRef(enabled)
  enabledRef.current = enabled
  const showsRef = useRef(shows)
  showsRef.current = shows
  const bumpersRef = useRef(bumpers)
  bumpersRef.current = bumpers
  const cartwallRef = useRef(cartwall)
  cartwallRef.current = cartwall
  const cgRef = useRef(cg)
  cgRef.current = cg
  const toastRef = useRef(toast)
  toastRef.current = toast

  // We dispatch by watching bridge.events: every time a new event appears
  // at index 0 we process it. Tracking lastSeenAt prevents re-dispatch when
  // the array shifts (rolling log keeps adding at the front).
  const lastSeenAtRef = useRef<number>(0)

  useEffect(() => {
    if (!enabledRef.current) return
    const latest = bridge.events[0]
    if (!latest) return
    if (latest.receivedAt <= lastSeenAtRef.current) return
    lastSeenAtRef.current = latest.receivedAt

    const ev = latest.event
    const name = ev.name?.trim() || ''
    const t = toastRef.current

    try {
      switch (ev.event) {
        case 'show-start': {
          if (!name) { t.warning('Myriad: show-start with no name'); break }
          const ok = showsRef.current.applyShowByName(name)
          if (ok) t.success(`Myriad → applied show "${name}"`)
          else t.warning(`Myriad: no NAR show matches "${name}"`)
          break
        }
        case 'show-end': {
          showsRef.current.setCurrentShow(null)
          t.info('Myriad → show end (sustaining)')
          break
        }
        case 'advert-start': {
          if (!name) { t.warning('Myriad: advert-start with no name'); break }
          const fired = bumpersRef.current.fireByName(name)
          if (fired) t.success(`Myriad → bumper "${name}"`)
          else t.warning(`Myriad: no bumper matches "${name}"`)
          break
        }
        case 'advert-end': {
          if (bumpersRef.current.isPlaying) {
            bumpersRef.current.stop()
            t.info('Myriad → advert ended')
          }
          break
        }
        case 'news-start': {
          // Push the headline from the event if Myriad carried one (some
          // installs send the headline as the item name; others send a
          // generic "News" and the operator pre-loads the headline via the
          // CG panel). Then fire the news-banner card.
          if (name) cgRef.current.setNews({ headline: name })
          const tpl = 'news-banner' as const
          const onAir = cgRef.current.layers.some(l => l.kind === 'title' && l.template === tpl)
          if (!onAir) cgRef.current.toggleTitle(tpl)
          t.success(`Myriad → news${name ? ` · ${name}` : ''}`)
          break
        }
        case 'news-end': {
          const tpl = 'news-banner' as const
          const onAir = cgRef.current.layers.some(l => l.kind === 'title' && l.template === tpl)
          if (onAir) cgRef.current.toggleTitle(tpl)
          break
        }
        case 'travel-start': {
          // Myriad's travel item is usually a single name field. Heuristic:
          // if it looks like a route reference (A77 / M77 / B743) treat as
          // the route; otherwise treat it as the status text.
          if (name) {
            if (/^[AMB]\d{1,4}(\s|$)/i.test(name)) {
              const m = name.match(/^([AMB]\d{1,4})\s*(.*)$/i)
              if (m) cgRef.current.setTravel({ route: m[1].toUpperCase(), status: m[2] || '' })
              else cgRef.current.setTravel({ route: name })
            } else {
              cgRef.current.setTravel({ status: name })
            }
          }
          const tpl = 'travel-banner' as const
          const onAir = cgRef.current.layers.some(l => l.kind === 'title' && l.template === tpl)
          if (!onAir) cgRef.current.toggleTitle(tpl)
          t.success(`Myriad → travel${name ? ` · ${name}` : ''}`)
          break
        }
        case 'travel-end': {
          const tpl = 'travel-banner' as const
          const onAir = cgRef.current.layers.some(l => l.kind === 'title' && l.template === tpl)
          if (onAir) cgRef.current.toggleTitle(tpl)
          break
        }
        case 'cart-fire': {
          if (!name) { t.warning('Myriad: cart-fire with no name'); break }
          const ok = cartwallRef.current.fireByName(name)
          if (ok) t.success(`Myriad → cart "${name}"`)
          else t.warning(`Myriad: no cart matches "${name}"`)
          break
        }
        case 'item-start': {
          // Music track / jingle — push to the Now Playing CG state if we
          // have both artist + name; otherwise just log silently.
          if (name && ev.artist) {
            cgRef.current.setNowPlaying(name, ev.artist)
          }
          break
        }
        case 'item-end':
          // No action — Now Playing stays until the next item-start.
          break
      }
    } catch (err) {
      console.error('[myriad-binder] dispatch failed:', err)
    }
    // We intentionally include only `bridge.events` in deps — every other
    // dependency lives in a ref so this hook re-runs ONLY when a new event
    // arrives, never when an unrelated provider re-renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridge.events])

  return null
}
