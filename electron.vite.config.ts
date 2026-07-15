import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { providerCatalogVitePlugin } from './src/main/provider-catalog/providerCatalogVitePlugin'

const rendererRoot = resolve(__dirname, 'src/renderer')

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin(), providerCatalogVitePlugin(__dirname)],
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared')
      }
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
          turnPreparationWorker: resolve(__dirname, 'src/main/workers/turnPreparationWorker.ts')
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared')
      }
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload/index.ts')
        }
      }
    }
  },
  renderer: {
    root: rendererRoot,
    server: {
      host: '127.0.0.1',
      port: 5173,
      strictPort: false
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve(rendererRoot, 'index.html')
        }
      }
    },
    plugins: [react()],
    resolve: {
      alias: {
        '@renderer': resolve(__dirname, 'src/renderer'),
        '@shared': resolve(__dirname, 'src/shared')
      }
    }
  }
})
