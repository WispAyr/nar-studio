import {
  createContext, useCallback, useContext, useEffect, useState,
  type ReactNode,
} from 'react'

const studio = (window as any).studio

export type UnrealState = 'idle' | 'starting' | 'running' | 'crashed' | 'stopped'

export interface UnrealStatus {
  state: UnrealState
  pid: number | null
  exitCode: number | null
  startedAt: number | null
  crashCount: number
  unrealExe: string
  projectPath: string
  extraArgs: string
  autoLaunch: boolean
  background: boolean
  lastError: string | null
}

interface UnrealCtx {
  status: UnrealStatus | null
  start: () => Promise<void>
  stop: () => Promise<void>
  pickExe: () => Promise<void>
  pickProject: () => Promise<void>
  setExtraArgs: (s: string) => Promise<void>
  setAutoLaunch: (b: boolean) => Promise<void>
  setBackground: (b: boolean) => Promise<void>
}

const Ctx = createContext<UnrealCtx | null>(null)

export function UnrealLauncherProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<UnrealStatus | null>(null)

  // Initial fetch + live updates from main.
  useEffect(() => {
    studio?.unrealStatus?.().then((s: UnrealStatus) => setStatus(s)).catch(() => {})
    const off = studio?.onUnrealStatus?.((s: UnrealStatus) => setStatus(s))
    return () => off?.()
  }, [])

  const refresh = useCallback(async () => {
    try { const s = await studio?.unrealStatus?.(); if (s) setStatus(s) } catch {}
  }, [])

  const start = useCallback(async () => { await studio?.unrealStart?.(); refresh() }, [refresh])
  const stop = useCallback(async () => { await studio?.unrealStop?.(); refresh() }, [refresh])

  const pickExe = useCallback(async () => {
    const p = await studio?.unrealPickExe?.()
    if (p) { await studio?.unrealConfig?.({ unrealExe: p }); refresh() }
  }, [refresh])
  const pickProject = useCallback(async () => {
    const p = await studio?.unrealPickProject?.()
    if (p) { await studio?.unrealConfig?.({ projectPath: p }); refresh() }
  }, [refresh])
  const setExtraArgs = useCallback(async (s: string) => {
    await studio?.unrealConfig?.({ extraArgs: s }); refresh()
  }, [refresh])
  const setAutoLaunch = useCallback(async (b: boolean) => {
    await studio?.unrealConfig?.({ autoLaunch: b }); refresh()
  }, [refresh])
  const setBackground = useCallback(async (b: boolean) => {
    await studio?.unrealConfig?.({ background: b }); refresh()
  }, [refresh])

  return (
    <Ctx.Provider value={{
      status,
      start, stop,
      pickExe, pickProject,
      setExtraArgs, setAutoLaunch, setBackground,
    }}>
      {children}
    </Ctx.Provider>
  )
}

export function useUnreal() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useUnreal must be used inside UnrealLauncherProvider')
  return ctx
}
