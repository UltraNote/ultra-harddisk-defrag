import { resolve } from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Renderer-only dev server. The renderer falls back to a simulated bridge when
// window.ultra is absent, so the UI can be reviewed in a plain browser.
export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  resolve: { alias: { '@shared': resolve(__dirname, 'src/shared') } },
  server: { port: 5199, strictPort: true },
  plugins: [react()]
})
