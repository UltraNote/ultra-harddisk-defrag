import { randomBytes } from 'node:crypto'
import react from '@vitejs/plugin-react'
import type { PluginOption } from 'vite'

export function rendererPlugins(): PluginOption[] {
  const nonce = randomBytes(16).toString('base64')
  return [react(), {
    name: 'defrag-dev-csp',
    apply: 'serve',
    config: () => ({ html: { cspNonce: nonce } }),
    transformIndexHtml: (html) => html.replace("script-src 'self'", `script-src 'self' 'nonce-${nonce}'`)
  }]
}
