import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

export function makeDb(url: string) {
  const sql = postgres(url, { max: 10 })
  return { db: drizzle(sql, { schema }), sql }
}
export type Db = ReturnType<typeof makeDb>['db']
