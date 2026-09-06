// Placeholder values used only when the corresponding env var is unset.
// Exported so the production startup gate in server.ts can refuse to boot
// if a real deployment ends up with one of these literals set explicitly
// (e.g. copied verbatim from this file into a .env), not just when unset.
export const DEV_JWT_SECRET = 'dev-secret-change-me'
export const DEV_CODE_PEPPER = 'dev-pepper-change-me'

export const env = {
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://postgres:nimblink@localhost:5433/nimblink',
  jwtSecret: process.env.JWT_SECRET ?? DEV_JWT_SECRET,
  codePepper: process.env.CODE_PEPPER ?? DEV_CODE_PEPPER,
  nimiqNetwork: process.env.NIMIQ_NETWORK ?? 'TestAlbatross',
  // Public RPC for the balance pre-check — the Mini App SDK and our own
  // embedded light client cannot read balances. Verified 2026-09-03.
  nimiqRpcUrl: process.env.NIMIQ_RPC_URL ?? (
    (process.env.NIMIQ_NETWORK ?? 'TestAlbatross') === 'MainAlbatross'
      ? 'https://rpc-mainnet.nimiqscan.com'
      : 'https://rpc-testnet.nimiqscan.com'
  ),
  port: Number(process.env.PORT ?? 3000),
  mockAuth: process.env.MOCK_AUTH === '1',
  fakeChain: process.env.FAKE_CHAIN === '1',
  corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:5173',
  webDist: process.env.WEB_DIST ?? '',
}
