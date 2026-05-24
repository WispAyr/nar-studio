import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'

/**
 * Non-blocking toast notifications for the bottom-right corner.
 *
 * Live broadcast actions (cut to air, fire CG, go live) need to be confirmed
 * back to the operator without ever stealing focus or blocking the next
 * action — a missed beat costs a viewer. Toasts auto-dismiss, sit fixed in
 * the bottom-right, and never gate input on the rest of the surface (the
 * container is `pointer-events-none`; each toast opts back in for its own
 * click + action button).
 *
 * The provider both owns the state and renders the stack, so the consumer
 * only mounts `<ToastProvider>` once at the root.
 */

export type ToastKind = 'success' | 'error' | 'info' | 'warning'

export interface ToastAction {
  label: string
  onClick: () => void
}

export interface ToastOptions {
  duration?: number
  action?: ToastAction
}

export interface ToastInput extends ToastOptions {
  kind: ToastKind
  message: string
}

export interface Toast {
  id: string
  kind: ToastKind
  message: string
  duration: number
  action?: ToastAction
}

export interface ToastApi {
  show: (input: ToastInput) => string
  success: (message: string, options?: ToastOptions) => string
  error: (message: string, options?: ToastOptions) => string
  info: (message: string, options?: ToastOptions) => string
  warning: (message: string, options?: ToastOptions) => string
  dismiss: (id: string) => void
}

const Ctx = createContext<ToastApi | null>(null)

/** Hard cap on visible toasts. Older ones (FIFO head) drop off the bottom. */
const MAX_VISIBLE = 6

/** Default per-kind durations (ms). Errors linger so the operator can read them. */
const DEFAULT_DURATIONS: Record<ToastKind, number> = {
  success: 2500,
  info: 2500,
  warning: 2500,
  error: 5000,
}

/** Tailwind classes for the 2px coloured left border per kind. */
const BORDER_CLASS: Record<ToastKind, string> = {
  success: 'border-l-nar-green',
  error: 'border-l-nar-red',
  info: 'border-l-nar-blue',
  warning: 'border-l-nar-amber',
}

/** Matching accent for the action button label so it reads as the kind. */
const ACCENT_TEXT: Record<ToastKind, string> = {
  success: 'text-nar-green',
  error: 'text-nar-red',
  info: 'text-nar-blue',
  warning: 'text-nar-amber',
}

let idCounter = 0
const makeId = () => `t${Date.now().toString(36)}${(idCounter++).toString(36)}`

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  // Per-toast auto-dismiss timers. Tracked in a ref so dismiss + unmount can
  // cancel them without re-rendering.
  const timersRef = useRef(new Map<string, number>())

  const clearTimer = useCallback((id: string) => {
    const t = timersRef.current.get(id)
    if (t != null) {
      window.clearTimeout(t)
      timersRef.current.delete(id)
    }
  }, [])

  const dismiss = useCallback((id: string) => {
    clearTimer(id)
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [clearTimer])

  const show = useCallback((input: ToastInput): string => {
    const id = makeId()
    const duration = input.duration ?? DEFAULT_DURATIONS[input.kind]
    const toast: Toast = {
      id,
      kind: input.kind,
      message: input.message,
      duration,
      action: input.action,
    }
    setToasts(prev => {
      // FIFO queue — keep the most recent MAX_VISIBLE. Cancel timers for any
      // toast we're about to drop so they don't try to dismiss a stale id.
      const next = [...prev, toast]
      if (next.length <= MAX_VISIBLE) return next
      const dropped = next.slice(0, next.length - MAX_VISIBLE)
      for (const d of dropped) clearTimer(d.id)
      return next.slice(next.length - MAX_VISIBLE)
    })
    if (duration > 0) {
      const handle = window.setTimeout(() => {
        timersRef.current.delete(id)
        setToasts(prev => prev.filter(t => t.id !== id))
      }, duration)
      timersRef.current.set(id, handle)
    }
    return id
  }, [clearTimer])

  const success = useCallback(
    (message: string, options?: ToastOptions) => show({ kind: 'success', message, ...options }),
    [show],
  )
  const error = useCallback(
    (message: string, options?: ToastOptions) => show({ kind: 'error', message, ...options }),
    [show],
  )
  const info = useCallback(
    (message: string, options?: ToastOptions) => show({ kind: 'info', message, ...options }),
    [show],
  )
  const warning = useCallback(
    (message: string, options?: ToastOptions) => show({ kind: 'warning', message, ...options }),
    [show],
  )

  // Cancel any pending timers on unmount.
  useEffect(() => () => {
    for (const handle of timersRef.current.values()) window.clearTimeout(handle)
    timersRef.current.clear()
  }, [])

  const api = useMemo<ToastApi>(
    () => ({ show, success, error, info, warning, dismiss }),
    [show, success, error, info, warning, dismiss],
  )

  return (
    <Ctx.Provider value={api}>
      {children}
      <ToastContainer toasts={toasts} onDismiss={dismiss} />
    </Ctx.Provider>
  )
}

export function useToast(): ToastApi {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useToast must be used inside ToastProvider')
  return ctx
}

/**
 * Bottom-right stack. `flex-col-reverse` so the newest toast appears at the
 * bottom (closest to the operator's gaze on the cut bar) and older ones rise
 * above it. Container ignores pointer events so it never blocks clicks on
 * the surface beneath; individual toasts opt back in.
 */
function ToastContainer({
  toasts,
  onDismiss,
}: {
  toasts: Toast[]
  onDismiss: (id: string) => void
}) {
  return (
    <div
      className="fixed bottom-4 right-4 z-[100] flex flex-col-reverse gap-2 pointer-events-none"
      aria-live="polite"
      aria-atomic="false"
    >
      {toasts.map(t => (
        <ToastItem key={t.id} toast={t} onDismiss={onDismiss} />
      ))}
    </div>
  )
}

function ToastItem({
  toast,
  onDismiss,
}: {
  toast: Toast
  onDismiss: (id: string) => void
}) {
  // Two-phase mount so the CSS transition has a previous state to interpolate
  // from. We render hidden on the first paint, then flip to visible on the
  // next animation frame. Same trick on the way out.
  const [visible, setVisible] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const leaveTimerRef = useRef<number | null>(null)

  useEffect(() => {
    const raf = requestAnimationFrame(() => setVisible(true))
    return () => cancelAnimationFrame(raf)
  }, [])

  useEffect(() => () => {
    if (leaveTimerRef.current != null) window.clearTimeout(leaveTimerRef.current)
  }, [])

  const beginDismiss = useCallback(() => {
    if (leaving) return
    setLeaving(true)
    setVisible(false)
    // Match the transition duration below (200ms) so the toast finishes its
    // exit before the parent removes it from the array.
    leaveTimerRef.current = window.setTimeout(() => onDismiss(toast.id), 200)
  }, [leaving, onDismiss, toast.id])

  const handleAction = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      toast.action?.onClick()
      beginDismiss()
    },
    [toast.action, beginDismiss],
  )

  return (
    <div
      role={toast.kind === 'error' ? 'alert' : 'status'}
      onClick={beginDismiss}
      className={[
        'pointer-events-auto cursor-pointer select-none',
        'w-80 rounded bg-surface-800 border-l-2 shadow-lg',
        'px-3 py-3 flex items-start gap-3',
        'text-sm text-slate-200',
        'transition-all duration-200 ease-out',
        visible && !leaving ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2',
        BORDER_CLASS[toast.kind],
      ].join(' ')}
    >
      <span className="flex-1 break-words leading-snug">{toast.message}</span>
      {toast.action && (
        <button
          type="button"
          onClick={handleAction}
          className={[
            'shrink-0 text-xs font-bold uppercase tracking-wider',
            'px-2 py-1 rounded hover:bg-surface-700 transition-colors',
            ACCENT_TEXT[toast.kind],
          ].join(' ')}
        >
          {toast.action.label}
        </button>
      )}
    </div>
  )
}
