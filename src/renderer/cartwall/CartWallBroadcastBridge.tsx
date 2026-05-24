/**
 * Bridges the cart wall's audio output into the broadcast chain.
 *
 * The cart wall owns its own AudioContext (a `BufferSource` cannot cross
 * AudioContext boundaries directly), so the only sane way to route stings
 * into the broadcast bus is a `MediaStreamAudioDestinationNode` on the cart
 * side and a `MediaStreamAudioSourceNode` on the broadcast side. This
 * component watches for the cart wall's stream becoming available (it's
 * lazy — created on first sting fire) and plugs/unplugs it through the
 * broadcast provider's `plugInputStream` API.
 *
 * Renders nothing; mounted once inside the provider stack.
 */
import { useEffect, useRef } from 'react'
import { useBroadcastAudio } from '../audio/BroadcastAudioProvider'
import { useCartwall } from './CartWallProvider'

export function CartWallBroadcastBridge() {
  const { plugInputStream } = useBroadcastAudio()
  const { getOutputStream } = useCartwall()
  const unplugRef = useRef<(() => void) | null>(null)
  const pluggedStreamRef = useRef<MediaStream | null>(null)

  useEffect(() => {
    // The cart wall stream materialises lazily on first fire. Poll for it at
    // 2 Hz — once we see it, plug and stop polling. If the cart wall tears
    // down (different stream id), re-plug.
    const tick = () => {
      const stream = getOutputStream()
      if (stream && stream !== pluggedStreamRef.current) {
        // New stream — unplug the old one if any, plug the new one.
        unplugRef.current?.()
        unplugRef.current = plugInputStream(stream)
        pluggedStreamRef.current = stream
      } else if (!stream && pluggedStreamRef.current) {
        unplugRef.current?.()
        unplugRef.current = null
        pluggedStreamRef.current = null
      }
    }
    tick()
    const id = window.setInterval(tick, 500)
    return () => {
      window.clearInterval(id)
      unplugRef.current?.()
      unplugRef.current = null
      pluggedStreamRef.current = null
    }
  }, [plugInputStream, getOutputStream])

  return null
}
