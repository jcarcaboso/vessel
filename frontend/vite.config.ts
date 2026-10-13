import { fileURLToPath, URL } from 'node:url'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { loadEnv } from 'vite'
import { defineConfig } from 'vitest/config'

export default defineConfig(({ mode }) => {
  // Server-only target. Never pass credentials through Vite environment variables.
  const target = loadEnv(mode, process.cwd(), '').VESSEL_API_TARGET ?? 'http://127.0.0.1:5080'
  return {
    plugins: [react(), tailwindcss()],
    resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
    server: {
      port: 5180,
      strictPort: true,
      proxy: { '/api': { target }, '/health': { target } },
    },
    test: {
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
      restoreMocks: true,
      clearMocks: true,
      // Shared CI runners are slower than local machines; interaction-heavy tests need headroom.
      testTimeout: 15_000,
    },
  }
})
