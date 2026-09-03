export const env = {
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://postgres:nimblink@localhost:5433/nimblink',
  jwtSecret: process.env.JWT_SECRET ?? 'dev-secret-change-me',
  codePepper: process.env.CODE_PEPPER ?? 'dev-pepper-change-me',
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
