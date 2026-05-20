/**
 * Stream profile manager — multiple RTMP destinations (YouTube, etc.)
 */
import Store from 'electron-store'
import { obsManager } from './obs'

export interface StreamProfile {
  id: string
  name: string
  rtmpUrl: string
  streamKey: string
  platform: 'youtube' | 'twitch' | 'custom'
}

interface StoreSchema {
  profiles: StreamProfile[]
  activeProfileId: string | null
}

const store = new Store<StoreSchema>({
  name: 'stream-profiles',
  defaults: {
    profiles: [
      {
        id: 'youtube-main',
        name: 'YouTube — NAR',
        rtmpUrl: 'rtmp://a.rtmp.youtube.com/live2',
        streamKey: '',
        platform: 'youtube',
      },
    ],
    activeProfileId: 'youtube-main',
  },
})

class StreamManager {
  getProfiles(): StreamProfile[] {
    return store.get('profiles')
  }

  getProfile(id: string): StreamProfile | null {
    return this.getProfiles().find(p => p.id === id) ?? null
  }

  saveProfile(profile: StreamProfile) {
    const profiles = this.getProfiles().filter(p => p.id !== profile.id)
    store.set('profiles', [...profiles, profile])
  }

  deleteProfile(id: string) {
    store.set('profiles', this.getProfiles().filter(p => p.id !== id))
  }

  setActiveProfile(id: string) {
    store.set('activeProfileId', id)
  }

  getActiveProfile(): StreamProfile | null {
    const id = store.get('activeProfileId')
    return id ? this.getProfile(id) : null
  }

  async startStream(profileId?: string) {
    const id = profileId ?? store.get('activeProfileId')
    if (!id) throw new Error('No stream profile selected')
    const profile = this.getProfile(id)
    if (!profile) throw new Error(`Profile not found: ${id}`)
    if (!profile.streamKey) throw new Error('Stream key is not set')
    await obsManager.startStream(profile.rtmpUrl, profile.streamKey)
    this.setActiveProfile(id)
  }

  async stopStream() {
    await obsManager.stopStream()
  }
}

export const streamManager = new StreamManager()
