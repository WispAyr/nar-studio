import { MultiviewGrid } from '../components/multiview/MultiviewGrid'

/**
 * Borderless full-viewport host for the 2x2 multiview when shown on a
 * secondary display. The popout window re-mounts the React app fresh, so
 * `selectedCamera` isn't being driven by the control surface here — we
 * just pin it to 0 since the multiview's selection highlight is purely
 * cosmetic in this view.
 */
export function PopoutMultiview() {
  return (
    <div className="fixed inset-0 bg-black p-1">
      <MultiviewGrid selectedCamera={0} />
    </div>
  )
}
