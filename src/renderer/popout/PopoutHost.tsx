import { useEffect, useState, type ReactNode } from 'react'
import { PopoutProgram } from './PopoutProgram'
import { PopoutMultiview } from './PopoutMultiview'
import { PopoutProducer } from './PopoutProducer'

/**
 * Hash-based router that sits at the top of the renderer tree. The popout
 * BrowserWindow loads the same HTML / Vite URL as the main window but
 * appends `#popout/<view>` — we read that here and replace the normal
 * Workspace with a borderless, full-viewport popout layout.
 *
 * Wrap your root `<Workspace />` with this; pop-out windows render only
 * their dedicated view, the main window renders children as-is.
 */
interface Props {
  children: ReactNode
}

type Route = 'program' | 'multiview' | 'producer' | null

function parseRoute(): Route {
  // Hash is like "#popout/program" — strip the leading '#' then split.
  const hash = window.location.hash.replace(/^#/, '')
  if (hash === 'popout/program') return 'program'
  if (hash === 'popout/multiview') return 'multiview'
  if (hash === 'popout/producer') return 'producer'
  return null
}

export function PopoutHost({ children }: Props) {
  const [route, setRoute] = useState<Route>(() => parseRoute())

  useEffect(() => {
    const onHash = () => setRoute(parseRoute())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  if (route === 'program') return <PopoutProgram />
  if (route === 'multiview') return <PopoutMultiview />
  if (route === 'producer') return <PopoutProducer />
  return <>{children}</>
}
