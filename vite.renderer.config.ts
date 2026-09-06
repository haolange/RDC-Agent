import { resolve } from 'path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const rendererRoot = resolve(__dirname, 'src/renderer')

/**
 * browser-dev: Vite is a private origin behind BrowserAppBridge same-origin reverse proxy.
 * Do not browse Vite directly; open the bridge `/qa` URL only.
 */
export default defineConfig({
  root: rendererRoot,
  plugins: [react(), {
    name: 'rdc-csp-dev-styles',
    apply: 'serve',
    enforce: 'post',
    transform(code, id) {
      if (!/\.css(?:\?|$)/u.test(id)) return null
      const styleImport = /import\s*\{\s*updateStyle as __vite__updateStyle,\s*removeStyle as __vite__removeStyle\s*\}\s*from\s*["']\/@vite\/client["']/u
      if (!styleImport.test(code)) return null
      return code.replace(styleImport, 'import { updateStyle as __vite__updateStyle, removeStyle as __vite__removeStyle } from "/platform/devStyles.ts"')
    },
  }],
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
    // HMR client uses the page host (bridge). Bridge upgrades WS to this server.
    hmr: {
      protocol: 'ws',
    },
  }
})
