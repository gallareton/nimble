import { afterAll, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { freshDb } from './helpers/db'
import { authedApp, makeUser } from './helpers/actors'

const apiRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const tsxCli = join(dirname(createRequire(import.meta.url).resolve('tsx/package.json')), 'dist/cli.mjs')

function runServerWithEnv(extraEnv: Record<string, string | undefined>) {
  const env = { ...process.env, ...extraEnv }
  for (const [key, value] of Object.entries(extraEnv)) if (value === undefined) delete env[key]
  return spawnSync(process.execPath, [tsxCli, join(apiRoot, 'src/server.ts')], {
    cwd: apiRoot,
    env,
    encoding: 'utf8',
    timeout: 20000,
  })
}

const { db, close } = await freshDb()
const { app, tokenFor } = authedApp(db)
afterAll(close)

it('zod validation errors are 400 with stable shape, no stack leak', async () => {
  const r = await app.inject({ method: 'POST', url: '/v1/auth/verify',
    payload: { nonce: 123 } })
  expect(r.statusCode).toBe(400)
  expect(r.json().error.code).toBe('VALIDATION')
  expect(JSON.stringify(r.json())).not.toContain('    at ') // no stack frames
})

it('malformed uuid in a path param is 400, not 500', async () => {
  const u = await makeUser(db, 'NQ81 U')
  const r = await app.inject({ method: 'POST', url: '/v1/sessions/does-not-exist/charges',
    payload: { amountLuna: '100' },
    headers: { authorization: `Bearer ${await tokenFor(u)}`, 'idempotency-key': 'k2' } })
  expect(r.statusCode).toBe(400)
  expect(r.json().error.code).toBe('VALIDATION')
})

it('unknown routes are 404 JSON with the error envelope', async () => {
  const r = await app.inject({ url: '/v1/nope' })
  expect(r.statusCode).toBe(404)
  expect(r.json().error.code).toBe('NOT_FOUND')
})

it('unexpected errors are 500 without internals', async () => {
  const { app: fresh } = authedApp(db) // shared app is already listening — no new routes allowed
  fresh.get('/boom', async () => { throw new Error('secret database password xyz') })
  const r = await fresh.inject({ url: '/boom' })
  expect(r.statusCode).toBe(500)
  expect(r.json().error.code).toBe('INTERNAL')
  expect(JSON.stringify(r.json())).not.toContain('xyz')
})

it('production refuses to start with no JWT_SECRET / CODE_PEPPER set, naming both', () => {
  const r = runServerWithEnv({ NODE_ENV: 'production', JWT_SECRET: undefined, CODE_PEPPER: undefined })
  expect(r.stderr).toContain('JWT_SECRET')
  expect(r.stderr).toContain('CODE_PEPPER')
  expect(r.stderr).toContain('must be set to a real secret in production')
})

it('production refuses to start when JWT_SECRET is the dev default literal, even if explicitly set', () => {
  const r = runServerWithEnv({ NODE_ENV: 'production', JWT_SECRET: 'dev-secret-change-me', CODE_PEPPER: 'a-real-pepper' })
  expect(r.stderr).toContain('JWT_SECRET')
  expect(r.stderr).not.toContain('CODE_PEPPER must be set')
})

it('production refuses to start when CODE_PEPPER is the dev default literal, even if explicitly set', () => {
  const r = runServerWithEnv({ NODE_ENV: 'production', JWT_SECRET: 'a-real-secret', CODE_PEPPER: 'dev-pepper-change-me' })
  expect(r.stderr).toContain('CODE_PEPPER')
  expect(r.stderr).not.toContain('JWT_SECRET must be set')
})

it('non-production stays unaffected by the secrets gate even with no secrets set', () => {
  // Point at a closed local port so it fails fast past the gate instead of
  // idling until the spawn timeout — we only care that the gate stayed out of the way.
  const r = runServerWithEnv({ NODE_ENV: 'test', JWT_SECRET: undefined, CODE_PEPPER: undefined, DATABASE_URL: 'postgres://x:x@127.0.0.1:1/x' })
  expect(r.stderr).not.toContain('must be set to a real secret in production')
})
