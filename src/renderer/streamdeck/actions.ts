/**
 * Stream Deck action registry — the things a deck key can be bound to.
 *
 * Actions are data (id / label / colour). Their *execution* is wired in
 * StreamDeckProvider, where the engine and director hooks are available.
 */
export interface DeckAction {
  id: string
  /** Key label — `\n` splits it onto two lines. */
  label: string
  /** Key background colour. */
  color: string
  /** Grouping for the customisation palette. */
  group: 'Cameras' | 'Program' | 'Director'
}

export const DECK_ACTIONS: DeckAction[] = [
  { id: 'cam0', label: 'CAM 1', color: '#e5202b', group: 'Cameras' },
  { id: 'cam1', label: 'CAM 2', color: '#e5202b', group: 'Cameras' },
  { id: 'cam2', label: 'CAM 3', color: '#e5202b', group: 'Cameras' },
  { id: 'cam3', label: 'CAM 4', color: '#e5202b', group: 'Cameras' },
  { id: 'viz', label: 'MUSIC\nVIZ', color: '#7c5cff', group: 'Cameras' },
  { id: 'record', label: 'REC', color: '#e5202b', group: 'Program' },
  { id: 'stream', label: 'GO\nLIVE', color: '#e5202b', group: 'Program' },
  { id: 'layout-solo', label: 'SOLO', color: '#2563eb', group: 'Program' },
  { id: 'layout-split', label: 'SPLIT', color: '#2563eb', group: 'Program' },
  { id: 'layout-pip', label: 'PiP', color: '#2563eb', group: 'Program' },
  { id: 'director', label: 'AI\nDIRECTOR', color: '#16a34a', group: 'Director' },
  { id: 'autovj', label: 'AUTO\nVJ', color: '#16a34a', group: 'Director' },
  { id: 'beatfx', label: 'BEAT\nFX', color: '#f7931e', group: 'Director' },
]

export function getAction(id: string | null | undefined): DeckAction | undefined {
  return id ? DECK_ACTIONS.find(a => a.id === id) : undefined
}
