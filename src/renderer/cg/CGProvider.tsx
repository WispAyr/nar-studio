import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode, type MutableRefObject } from 'react'
import { TitleLayer } from './TitleLayer'
import type { CgAsset, CgLayer, TitleTemplate } from './types'

const studio = (window as any).studio

const DEFAULT_BLEND: GlobalCompositeOperation = 'source-over'

/** Exit-animation length — kept in step with the compositor's LAYER_OUT_MS. */
const LAYER_EXIT_MS = 380

export const TITLE_TEMPLATES: { template: TitleTemplate; label: string }[] = [
  { template: 'show-lower-third', label: 'Show Lower-Third' },
  { template: 'up-next', label: 'Up Next' },
  { template: 'clock', label: 'Clock' },
]

type CgElement = HTMLImageElement | HTMLVideoElement | HTMLCanvasElement

interface CGContextValue {
  assets: Record<string, CgAsset[]>
  layers: CgLayer[]
  elements: MutableRefObject<Map<string, CgElement>>
  toggleLayer: (asset: CgAsset) => void
  toggleTitle: (template: TitleTemplate) => void
  removeLayer: (id: string) => void
  setOpacity: (id: string, opacity: number) => void
  setBlend: (id: string, blend: GlobalCompositeOperation) => void
  raiseLayer: (id: string) => void
  openFolder: (category?: string) => void
}

const Ctx = createContext<CGContextValue | null>(null)

let layerSeq = 0

export function CGProvider({ children }: { children: ReactNode }) {
  const [assets, setAssets] = useState<Record<string, CgAsset[]>>({})
  const [layers, setLayers] = useState<CgLayer[]>([])
  const layersRef = useRef<CgLayer[]>([])
  layersRef.current = layers
  const elements = useRef<Map<string, CgElement>>(new Map())

  const refresh = useCallback(() => {
    studio?.cgList?.().then((a: Record<string, CgAsset[]>) => { if (a) setAssets(a) })
  }, [])

  useEffect(() => {
    refresh()
    const unsub = studio?.onCgChanged?.(refresh)
    return () => unsub?.()
  }, [refresh])

  // Start a layer's exit animation, then prune it once the animation is done.
  // Re-toggling during the exit cancels removal, so the timeout re-checks state.
  const beginRemove = useCallback((id: string) => {
    setLayers(prev => prev.map(l => (l.id === id && l.removingAt == null ? { ...l, removingAt: performance.now() } : l)))
    window.setTimeout(() => {
      setLayers(prev => {
        const done = prev.some(l =>
          l.id === id && l.removingAt != null && performance.now() - l.removingAt >= LAYER_EXIT_MS)
        if (!done) return prev
        elements.current.delete(id)
        return prev.filter(l => l.id !== id)
      })
    }, LAYER_EXIT_MS + 90)
  }, [])

  const toggleLayer = useCallback((asset: CgAsset) => {
    const existing = layersRef.current.find(
      l => l.kind !== 'title' && l.category === asset.category && l.name === asset.name)
    if (existing) {
      if (existing.removingAt != null) {
        // Mid-exit — bring it back rather than removing.
        setLayers(prev => prev.map(l => (l.id === existing.id ? { ...l, removingAt: null, addedAt: performance.now() } : l)))
      } else {
        beginRemove(existing.id)
      }
      return
    }
    setLayers(prev => [...prev, {
      id: `layer-${++layerSeq}`,
      kind: asset.kind,
      name: asset.name,
      category: asset.category,
      url: asset.url,
      opacity: 1,
      blend: DEFAULT_BLEND,
      addedAt: performance.now(),
      removingAt: null,
    }])
  }, [beginRemove])

  const toggleTitle = useCallback((template: TitleTemplate) => {
    const existing = layersRef.current.find(l => l.kind === 'title' && l.template === template)
    if (existing) {
      if (existing.removingAt != null) {
        setLayers(prev => prev.map(l => (l.id === existing.id ? { ...l, removingAt: null, addedAt: performance.now() } : l)))
      } else {
        beginRemove(existing.id)
      }
      return
    }
    const label = TITLE_TEMPLATES.find(t => t.template === template)?.label ?? template
    setLayers(prev => [...prev, {
      id: `layer-${++layerSeq}`,
      kind: 'title',
      template,
      name: label,
      category: 'titles',
      url: '',
      opacity: 1,
      blend: DEFAULT_BLEND,
      addedAt: performance.now(),
      removingAt: null,
    }])
  }, [beginRemove])

  const removeLayer = useCallback((id: string) => {
    beginRemove(id)
  }, [beginRemove])

  const setOpacity = useCallback((id: string, opacity: number) => {
    setLayers(prev => prev.map(l => (l.id === id ? { ...l, opacity } : l)))
  }, [])

  const setBlend = useCallback((id: string, blend: GlobalCompositeOperation) => {
    setLayers(prev => prev.map(l => (l.id === id ? { ...l, blend } : l)))
  }, [])

  const raiseLayer = useCallback((id: string) => {
    setLayers(prev => {
      const i = prev.findIndex(l => l.id === id)
      if (i < 0 || i === prev.length - 1) return prev
      const next = prev.slice()
      ;[next[i], next[i + 1]] = [next[i + 1], next[i]]
      return next
    })
  }, [])

  const openFolder = useCallback((category?: string) => studio?.cgOpenFolder?.(category), [])

  return (
    <Ctx.Provider value={{ assets, layers, elements, toggleLayer, toggleTitle, removeLayer, setOpacity, setBlend, raiseLayer, openFolder }}>
      {/* Off-screen layer elements — decoded/rendered here, drawn onto the program canvas. */}
      <div style={{ position: 'fixed', left: '-10000px', top: 0, pointerEvents: 'none' }} aria-hidden>
        {layers.map(layer => {
          if (layer.kind === 'title') {
            return <TitleLayer key={layer.id} layer={layer} elements={elements} />
          }
          if (layer.kind === 'video') {
            return (
              <video
                key={layer.id}
                ref={el => { if (el) elements.current.set(layer.id, el) }}
                src={layer.url}
                autoPlay loop muted playsInline
                width={160} height={90}
              />
            )
          }
          return (
            <img
              key={layer.id}
              ref={el => { if (el) elements.current.set(layer.id, el) }}
              src={layer.url}
              alt=""
            />
          )
        })}
      </div>
      {children}
    </Ctx.Provider>
  )
}

export function useCG() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useCG must be used within CGProvider')
  return ctx
}
