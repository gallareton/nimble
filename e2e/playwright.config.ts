import { defineConfig } from '@playwright/test'

// E2E gets its own database and ports so it can never touch (or truncate)
// the dev servers / dev data — device testing runs on 3000/5173 in parallel.
export const TEST_DB_URL = 'postgres://postgres:nimblink@localhost:5433/nimblink_test'
export const API_URL = 'http://localhost:3100'

export default defineConfig({
  testDir: '.',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  use: { baseURL: 'http://localhost:5174' },
  webServer: [
    {
      command: 'pnpm --filter @nimblink/api migrate && pnpm --filter @nimblink/api dev',
      url: 'http://localhost:3100/healthz',
      reuseExistingServer: false,
      timeout: 60_000,
      env: { MOCK_AUTH: '1', FAKE_CHAIN: '1', PORT: '3100', DATABASE_URL: TEST_DB_URL,
        CORS_ORIGIN: 'http://localhost:5174' },
    },
    {
      command: 'pnpm --filter @nimblink/web dev --port 5174 --strictPort',
      url: 'http://localhost:5174',
      reuseExistingServer: false,
      timeout: 60_000,
      env: { VITE_WALLET: 'mock', VITE_API_URL: API_URL },
    },
  ],
})
