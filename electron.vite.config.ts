import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import { providerCatalogVitePlugin } from './src/main/provider-catalog/providerCatalogVitePlugin'
import rendererConfig from './vite.renderer.config'

const repoRoot = __dirname

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin(), providerCatalogVitePlugin(repoRoot)],
    resolve: {
      alias: {
        '@main': resolve(repoRoot, 'src/main'),
        '@shared': resolve(repoRoot, 'src/shared'),
      },
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve(repoRoot, 'src/main/index.ts'),
          grepRegexWorker: resolve(repoRoot, 'src/main/workers/grepRegexWorker.ts'),
          turnPreparationWorker: resolve(repoRoot, 'src/main/workers/turnPreparationWorker.ts'),
        },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@main': resolve(repoRoot, 'src/main'),
        '@shared': resolve(repoRoot, 'src/shared'),
      },
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve(repoRoot, 'src/preload/index.ts'),
        },
      },
    },
  },
  renderer: {
    ...rendererConfig,
    build: {
      rollupOptions: {
        input: {
          index: resolve(repoRoot, 'src/renderer/index.html'),
        },
      },
    },
  },
})
