export const env = {
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://postgres:nimblink@localhost:5433/nimblink',
  jwtSecret: process.env.JWT_SECRET ?? 'dev-secret-change-me',
  codePepper: process.env.CODE_PEPPER ?? 'dev-pepper-change-me',
  nimiqNetwork: process.env.NIMIQ_NETWORK ?? 'TestAlbatross',
  port: Number(process.env.PORT ?? 3000),
  mockAuth: process.env.MOCK_AUTH === '1',
  fakeChain: process.env.FAKE_CHAIN === '1',
  corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:5173',
  webDist: process.env.WEB_DIST ?? '',
}
