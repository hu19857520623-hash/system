import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import AutoImport from 'unplugin-auto-import/vite'
import Components from 'unplugin-vue-components/vite'
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [
    vue(),
    AutoImport({
      resolvers: [ElementPlusResolver()],
      imports: ['vue', 'vue-router', 'pinia'],
      dts: 'src/auto-imports.d.ts',
    }),
    Components({
      resolvers: [ElementPlusResolver()],
      dts: 'src/components.d.ts',
    }),
  ],
  resolve: {
    alias: [
      {
        find: '@erp/shared/permissions.catalog',
        replacement: fileURLToPath(new URL('../shared/permissions.catalog.ts', import.meta.url)),
      },
      {
        find: '@erp/shared/oms-portal.permissions',
        replacement: fileURLToPath(new URL('../shared/oms-portal.permissions.ts', import.meta.url)),
      },
      {
        find: '@erp/shared',
        replacement: fileURLToPath(new URL('../shared', import.meta.url)),
      },
      {
        find: '@',
        replacement: fileURLToPath(new URL('./src', import.meta.url)),
      },
    ],
  },
  server: {
    host: true,
    port: 5180,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true,
      },
      '/takealot-monitor': {
        target: 'http://127.0.0.1:3456',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/takealot-monitor/, ''),
      },
    },
  },
  preview: {
    host: '127.0.0.1',
    port: 8088,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true,
      },
      '/takealot-monitor': {
        target: 'http://127.0.0.1:3456',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/takealot-monitor/, ''),
      },
    },
  },
})
