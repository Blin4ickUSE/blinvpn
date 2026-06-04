import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { cpSync, existsSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT_ASSETS = resolve(__dirname, '../../assets')
const PUBLIC_ASSETS = resolve(__dirname, 'public/assets')

/** Единый источник: /assets в корне репозитория → public/assets для Vite/serve */
function syncRootAssets() {
  if (!existsSync(ROOT_ASSETS)) return
  mkdirSync(PUBLIC_ASSETS, { recursive: true })
  cpSync(ROOT_ASSETS, PUBLIC_ASSETS, { recursive: true })
}

export default defineConfig({
  resolve: {
    alias: {
      '@core': resolve(__dirname, '../core'),
      '@api': resolve(__dirname, '../api'),
    },
  },
  plugins: [
    react(),
    {
      name: 'sync-root-assets',
      buildStart() {
        syncRootAssets()
      },
    },
    {
      name: 'copy-sdk',
      closeBundle() {
        const out = resolve(__dirname, 'dist/sdk')
        mkdirSync(out, { recursive: true })
        cpSync(resolve(__dirname, 'public/telegram-web-app.js'), resolve(out, 'telegram-web-app.js'))
      },
    },
  ],
  base: '/',
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    rollupOptions: {
      input: {
        main: './index.html',
      },
    },
  },
  server: {
    host: '0.0.0.0',
    port: 3000,
    fs: {
      allow: ['.', resolve(__dirname, '..')],
    },
  },
  preview: {
    host: '0.0.0.0',
    port: 3000,
  },
})
