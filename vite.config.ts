import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron'
import renderer from 'vite-plugin-electron-renderer'
import path from 'path'

export default defineConfig({
  plugins: [
    react(),
    electron([
      {
        entry: 'src/main/index.ts',
        onstart(args) {
          args.startup()
        },
        vite: {
          build: {
            outDir: 'dist-electron/main',
            rollupOptions: {
              external: ['electron', 'node-hid', 'electron-store', 'ffmpeg-static'],
            },
          },
        },
      },
      {
        entry: 'src/preload/index.ts',
        onstart(args) {
          args.reload()
        },
        vite: {
          build: {
            outDir: 'dist-electron/preload',
          },
        },
      },
    ]),
    renderer(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  css: {
    postcss: './postcss.config.js',
  },
  // The face-detection worker is an ES module (it imports MediaPipe).
  worker: {
    format: 'es',
  },
  build: {
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        // Split the heavy AI libraries into their own chunks — they download
        // and cache independently of the app code, keeping the main bundle
        // small so the UI parses and paints sooner.
        manualChunks(id) {
          if (id.includes('node_modules/@mediapipe/')) return 'mediapipe'
          if (id.includes('node_modules/@vladmandic/')) return 'face-api'
        },
      },
    },
  },
})
