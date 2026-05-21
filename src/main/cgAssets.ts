/**
 * CG asset library — manages on-disk folders of graphics/video assets the
 * operator drops in, and serves them to the renderer over a privileged cg://
 * protocol (so they can be drawn onto the program canvas without tainting it).
 */
import { app } from 'electron'
import fs from 'fs'
import path from 'path'

export const CG_CATEGORIES = [
  'logos',
  'lower-thirds',
  'fullscreen',
  'bumpers',
  'transitions',
  'ad-breaks',
] as const
export type CgCategory = typeof CG_CATEGORIES[number]

const IMAGE_EXT = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.avif']
const VIDEO_EXT = ['.mp4', '.webm', '.mov', '.mkv', '.m4v']

export interface CgAsset {
  category: CgCategory
  name: string
  url: string
  kind: 'image' | 'video'
}

class CgAssets {
  private root = ''
  private watcher: fs.FSWatcher | null = null

  init() {
    this.root = path.join(app.getPath('userData'), 'CG')
    for (const c of CG_CATEGORIES) {
      fs.mkdirSync(path.join(this.root, c), { recursive: true })
    }
    console.log(`[cg] asset library: ${this.root}`)
  }

  getRoot() {
    return this.root
  }

  categoryDir(category: string): string {
    return path.join(this.root, category)
  }

  /** Resolve a cg://<category>/<name> request to a real file, guarding traversal. */
  resolve(category: string, name: string): string | null {
    if (!CG_CATEGORIES.includes(category as CgCategory)) return null
    const file = path.join(this.root, category, path.basename(name))
    return file.startsWith(this.root) && fs.existsSync(file) ? file : null
  }

  list(): Record<string, CgAsset[]> {
    const out: Record<string, CgAsset[]> = {}
    for (const category of CG_CATEGORIES) {
      let files: string[] = []
      try { files = fs.readdirSync(path.join(this.root, category)) } catch {}
      out[category] = files
        .filter(f => !f.startsWith('.'))
        .map(name => {
          const ext = path.extname(name).toLowerCase()
          const kind = IMAGE_EXT.includes(ext) ? 'image' : VIDEO_EXT.includes(ext) ? 'video' : null
          return kind ? { category: category as CgCategory, name, kind, url: `cg://${category}/${encodeURIComponent(name)}` } : null
        })
        .filter((a): a is CgAsset => a !== null)
        .sort((a, b) => a.name.localeCompare(b.name))
    }
    return out
  }

  /** Watch the library for file changes (debounced). */
  watch(onChange: () => void) {
    try {
      let timer: ReturnType<typeof setTimeout> | null = null
      this.watcher = fs.watch(this.root, { recursive: true }, () => {
        if (timer) clearTimeout(timer)
        timer = setTimeout(onChange, 300)
      })
    } catch (e) {
      console.warn('[cg] watch unavailable:', (e as Error).message)
    }
  }

  stop() {
    this.watcher?.close()
    this.watcher = null
  }
}

export const cgAssets = new CgAssets()
