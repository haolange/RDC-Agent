import { resolve } from 'path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const rendererRoot = resolve(__dirname, 'src/renderer')

/** browser-dev：把 IPC bridge 挂到同源，避免丢 `rdcBridgeOrigin` 后 settings/project 全空。 */
const browserBridgeTarget = (
  process.env.RDC_AGENT_BROWSER_BRIDGE_URL
  || `http://127.0.0.1:${process.env.RDC_AGENT_BROWSER_BRIDGE_PORT || '5127'}`
).replace(/\/$/, '')

export default defineConfig({
  root: rendererRoot,
  plugins: [react()],
  resolve: {
    alias: {
      '@renderer': rendererRoot,
      '@shared': resolve(__dirname, 'src/shared')
    }
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: false,
    proxy: {
      '/invoke': { target: browserBridgeTarget, changeOrigin: true },
      '/events': { target: browserBridgeTarget, changeOrigin: true },
      '/health': { target: browserBridgeTarget, changeOrigin: true },
    },
  }
})
