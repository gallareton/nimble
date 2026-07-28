import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: '.',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  use: { baseURL: 'http://localhost:5173' },
  webServer: [
    {
      command: 'pnpm --filter @nimblink/api dev',
      url: 'http://localhost:3000/healthz',
      reuseExistingServer: true,
      timeout: 60_000,
      env: { MOCK_AUTH: '1', FAKE_CHAIN: '1' },
    },
    {
      command: 'pnpm --filter @nimblink/web dev -- --port 5173 --strictPort',
      url: 'http://localhost:5173',
      reuseExistingServer: true,
      timeout: 60_000,
      env: { VITE_WALLET: 'mock', VITE_API_URL: 'http://localhost:3000' },
    },
  ],
})
