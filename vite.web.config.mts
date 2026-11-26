import { resolve } from 'path'
import { defineConfig } from 'vite'
import { rendererPlugins } from './scripts/vite-renderer.mts'

// Renderer-only dev server. The renderer falls back to a simulated bridge when
// window.ultra is absent, so the UI can be reviewed in a plain browser.
export default defineConfig({
  root: resolve(import.meta.dirname, 'src/renderer'),
  resolve: { alias: { '@shared': resolve(import.meta.dirname, 'src/shared') } },
  server: { port: 5199, strictPort: true },
  plugins: rendererPlugins()
})
