/**
 * Compact "More" menu for the right sidebar.
 *
 * Collapses the workspace shortcuts (Colour / Stream Deck / Studio Map),
 * the multi-monitor pop-out controls, and a few utility actions into a
 * single popover so the sidebar's vertical budget goes to the things the
 * operator touches every minute (camera + tabbed panels) instead of the
 * things they touch every show (workspace switches).
 *
 * The same actions are also reachable via the Ctrl-K command palette;
 * this menu is the mouse-friendly fallback.
 */
import { useEffect, useRef, useState } from 'react'
import { resetAllSettings } from '../../settings/resetSettings'

const studio = (window as any).studio as {
  popoutOpen: (view: string) => Promise<unknown>
  popoutCloseAll: () => Promise<unknown>
}

interface Props {
  onOpenColour: () => void
  onOpenStreamDeck: () => void
  onOpenStudio: () => void
}

export function SidebarMenu({ onOpenColour, onOpenStreamDeck, onOpenStudio }: Props) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  // Close on click-outside / Escape.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const run = (fn: () => void | Promise<unknown>) => {
    return () => { setOpen(false); void fn() }
  }

  return (
    <div ref={wrapRef} className="relative shrink-0">
      <button
        onClick={() => setOpen(o => !o)}
        title="Workspaces · pop-outs · settings"
        className={`flex items-center gap-1.5 px-2 h-7 w-full rounded transition-colors ${
          open
            ? 'bg-surface-700 text-white'
            : 'bg-surface-800 text-slate-400 hover:text-white border border-surface-700'
        }`}
      >
        <span className="text-[14px] leading-none">≡</span>
        <span className="text-[10px] font-bold uppercase tracking-wider">Workspaces · Pop-outs</span>
        <span className="ml-auto text-[10px] text-slate-600">Ctrl-K</span>
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-[calc(100%+4px)] z-40 bg-surface-900 border border-surface-700 rounded-lg shadow-2xl py-1 overflow-hidden">
          <MenuGroup label="Workspaces">
            <MenuItem onClick={run(onOpenColour)} label="Colour Grading" hint="full-screen grade" />
            <MenuItem onClick={run(onOpenStreamDeck)} label="Stream Deck" hint="hardware bind" />
            <MenuItem onClick={run(onOpenStudio)} label="Studio Map" hint="cameras + zones" />
          </MenuGroup>
          <MenuGroup label="Pop-out Windows">
            <MenuItem onClick={run(() => studio.popoutOpen('program'))} label="Program Monitor" hint="full-screen on display 2" />
            <MenuItem onClick={run(() => studio.popoutOpen('multiview'))} label="Multiview" hint="2×2 on display 2" />
            <MenuItem onClick={run(() => studio.popoutOpen('producer'))} label="Producer Deck" hint="Show clock + Now/Next" />
            <MenuItem onClick={run(() => studio.popoutCloseAll())} label="Close All Pop-outs" hint="" />
          </MenuGroup>
          <MenuGroup label="Settings">
            <MenuItem
              onClick={run(async () => {
                if (window.confirm('Reset every persisted setting and reload the app?')) {
                  await resetAllSettings()
                }
              })}
              label="Reset All Settings"
              hint="factory wipe + reload"
              danger
            />
          </MenuGroup>
        </div>
      )}
    </div>
  )
}

function MenuGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="px-3 py-1 text-[9px] text-slate-600 uppercase tracking-wider bg-surface-950/40">
        {label}
      </div>
      {children}
    </div>
  )
}

function MenuItem({ onClick, label, hint, danger }: {
  onClick: () => void
  label: string
  hint: string
  danger?: boolean
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-2 px-3 py-1.5 text-left transition-colors ${
        danger
          ? 'text-nar-red hover:bg-nar-red/15'
          : 'text-slate-300 hover:bg-surface-800 hover:text-white'
      }`}
    >
      <span className="text-xs flex-1 truncate">{label}</span>
      {hint && <span className="text-[10px] text-slate-600 truncate">{hint}</span>}
    </button>
  )
}
