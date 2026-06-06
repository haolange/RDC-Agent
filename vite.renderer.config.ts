import { resolve } from 'path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const rendererRoot = resolve(__dirname, 'src/renderer')

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
    strictPort: false
  }
})
