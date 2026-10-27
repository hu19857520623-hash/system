import type { Environment } from 'vitest/environments'

// Compile SFCs for the client while Vue's custom renderer supplies the host.
export default {
  name: 'client-render',
  viteEnvironment: 'client',
  setup: () => ({ teardown() {} }),
} satisfies Environment
