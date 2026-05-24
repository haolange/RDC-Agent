import { existsSync, readFileSync } from 'fs'
import { resolve } from 'path'
import react from '@vitejs/plugin-react'
import { defineConfig, type ViteDevServer } from 'vite'

const rendererRoot = resolve(__dirname, 'src/renderer')
const browserPreviewScenarioRoot = resolve(__dirname, 'scripts/browser-preview/scenarios')

const browserPreviewScenariosPlugin = () => ({
  name: 'rdc-agent-browser-preview-scenarios',
  configureServer(server: ViteDevServer): void {
    server.middlewares.use('/.rdc-preview/scenarios', (request, response, next) => {
      const scenarioName = request.url?.replace(/^\//, '').replace(/\.json(?:\?.*)?$/, '') ?? ''
      if (!/^[a-z0-9][a-z0-9-]*$/i.test(scenarioName)) {
        response.statusCode = 400
        response.end('Invalid browser preview scenario name')
        return
      }

      const scenarioPath = resolve(browserPreviewScenarioRoot, `${scenarioName}.json`)
      if (!scenarioPath.startsWith(browserPreviewScenarioRoot) || !existsSync(scenarioPath)) {
        next()
        return
      }

      response.setHeader('Content-Type', 'application/json; charset=utf-8')
      response.setHeader('Cache-Control', 'no-store')
      response.end(readFileSync(scenarioPath, 'utf-8'))
    })
  }
})

export default defineConfig({
  root: rendererRoot,
  plugins: [react(), browserPreviewScenariosPlugin()],
  resolve: {
    alias: {
      '@renderer': rendererRoot,
      '@shared': resolve(__dirname, 'src/shared')
    }
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: false
  }
})
