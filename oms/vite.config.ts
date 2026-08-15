import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteSingleFile } from 'vite-plugin-singlefile'

export default defineConfig(({ mode }) => {
  const singleFile = mode === 'singlefile'

  return {
    base: singleFile ? './' : '/',
    plugins: [react(), ...(singleFile ? [viteSingleFile()] : [])],
    server: {
      host: '127.0.0.1',
      port: 5173,
      strictPort: true,
      proxy: {
        '/api': {
          target: 'http://127.0.0.1:3001',
          changeOrigin: true,
        },
      },
    },
    build: singleFile
      ? {
          cssCodeSplit: false,
          assetsInlineLimit: 100000000,
        }
      : undefined,
  }
})
