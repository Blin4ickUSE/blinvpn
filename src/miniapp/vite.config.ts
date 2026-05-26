import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { createReadStream, existsSync } from 'node:fs'
import { resolve } from 'node:path'

/** В dev/preview отдаём /sdk/* из src/miniapp/sdk — без копии в dist */
function serveSdkFromSource(): Plugin {
  const sdkRoot = resolve(__dirname, 'sdk')
  const middleware: (
    req: import('http').IncomingMessage,
    res: import('http').ServerResponse,
    next: () => void,
  ) => void = (req, res, next) => {
    const url = req.url ?? ''
    if (!url.startsWith('/sdk/')) {
      next()
      return
    }
    const rel = url.slice('/sdk/'.length).split('?')[0]
    const file = resolve(sdkRoot, rel)
    if (!rel || !existsSync(file)) {
      next()
      return
    }
    res.setHeader('Content-Type', 'application/javascript')
    createReadStream(file).pipe(res)
  }
  return {
    name: 'serve-sdk-from-source',
    configureServer(server) {
      server.middlewares.use(middleware)
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware)
    },
  }
}

export default defineConfig({
  resolve: {
    alias: {
      react: resolve(__dirname, 'node_modules/react'),
      'react-dom': resolve(__dirname, 'node_modules/react-dom'),
      'lucide-react': resolve(__dirname, 'node_modules/lucide-react'),
    },
  },
  plugins: [react(), serveSdkFromSource()],
  base: '/',
  build: {
    outDir: 'dist',
    // Имя каталога для собранного JS/CSS (не папка assets в репозитории)
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
      allow: [resolve(__dirname), resolve(__dirname, '..')],
    },
  },
  preview: {
    host: '0.0.0.0',
    port: 3000,
  },
})
