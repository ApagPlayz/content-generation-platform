import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

// Mirror the `@/*` → `src/*` path alias from tsconfig.json so tests can import
// real modules (not just mocked ones) by their `@/...` path, exactly as the app
// does. Without this, a test that pulls in a route whose source imports a real
// `@/lib/...` module fails to resolve it.
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
})
