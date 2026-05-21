/**
 * Session face-identity store.
 *
 * Faces are turned into 128-d descriptors by the face-recognition model
 * (see faceRecognizer.ts). This store holds the people discovered this
 * session. Read (`findBest`) and write (`create` / `reinforce`) are split so
 * the recognition provider decides *when* a new person is real — open-set
 * matching on every frame is what made one person fragment into many.
 *
 * Descriptors are compared by Euclidean distance — the face-api convention,
 * where < ~0.6 means the same person.
 */

/** A person known to the recognition system this session (public view). */
export interface Identity {
  id: string
  name: string
  color: string
  /** Total matched sightings. */
  count: number
  lastSeen: number
}

interface IdentityRecord extends Identity {
  /** Stored face descriptors — several per person for angle/lighting robustness. */
  descriptors: Float32Array[]
}

export interface BestMatch {
  id: string
  /** Euclidean distance to the closest stored descriptor — lower is better. */
  distance: number
}

const PALETTE = ['#f59e0b', '#22c55e', '#3b82f6', '#ec4899', '#a855f7', '#14b8a6', '#ef4444', '#84cc16']
const MAX_DESCRIPTORS = 16
const MAX_IDENTITIES = 12
const DEDUP_DIST = 0.2  // don't store a descriptor that is a near-duplicate

function distance(a: Float32Array, b: Float32Array): number {
  let s = 0
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) {
    const d = a[i] - b[i]
    s += d * d
  }
  return Math.sqrt(s)
}

/** Smallest distance from `d` to any of an identity's descriptors. */
function nearestDist(d: Float32Array, descriptors: Float32Array[]): number {
  let best = Infinity
  for (const s of descriptors) {
    const dist = distance(d, s)
    if (dist < best) best = dist
  }
  return best
}

export class IdentityStore {
  private records: IdentityRecord[] = []
  private seq = 0

  /** Public, descriptor-free view of the known people. */
  list(): Identity[] {
    return this.records.map(({ descriptors: _d, ...rest }) => rest)
  }

  /** Closest existing identity for a descriptor — read-only, never creates. */
  findBest(descriptor: Float32Array): BestMatch | null {
    let id = ''
    let best = Infinity
    for (const rec of this.records) {
      const d = nearestDist(descriptor, rec.descriptors)
      if (d < best) { best = d; id = rec.id }
    }
    return id ? { id, distance: best } : null
  }

  /** Register a new person, seeded with a descriptor. null if the cap is hit. */
  create(descriptor: Float32Array, now: number): string | null {
    if (this.records.length >= MAX_IDENTITIES) return null
    const id = `p${++this.seq}`
    this.records.push({
      id,
      name: `Person ${this.seq}`,
      color: PALETTE[(this.seq - 1) % PALETTE.length],
      count: 1,
      lastSeen: now,
      descriptors: [descriptor],
    })
    return id
  }

  /** Record a sighting of a known identity, adding fresh-enough descriptors. */
  reinforce(id: string, descriptor: Float32Array, now: number): void {
    const rec = this.records.find(r => r.id === id)
    if (!rec) return
    rec.count += 1
    rec.lastSeen = now
    if (nearestDist(descriptor, rec.descriptors) > DEDUP_DIST) {
      rec.descriptors.push(descriptor)
      if (rec.descriptors.length > MAX_DESCRIPTORS) rec.descriptors.shift()
    }
  }

  rename(id: string, name: string): void {
    const r = this.records.find(r => r.id === id)
    if (r) r.name = name
  }

  /** Merge `fromId` into `intoId` — fold descriptors, drop the duplicate. */
  merge(fromId: string, intoId: string): void {
    if (fromId === intoId) return
    const from = this.records.find(r => r.id === fromId)
    const into = this.records.find(r => r.id === intoId)
    if (!from || !into) return
    into.descriptors.push(...from.descriptors)
    while (into.descriptors.length > MAX_DESCRIPTORS) into.descriptors.shift()
    into.count += from.count
    this.records = this.records.filter(r => r.id !== fromId)
  }

  remove(id: string): void {
    this.records = this.records.filter(r => r.id !== id)
  }
}
