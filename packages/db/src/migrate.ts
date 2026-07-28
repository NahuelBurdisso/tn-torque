import { readdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Db } from './client.ts'

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

/** Aplica las migraciones pendientes. Devuelve las versiones aplicadas en esta corrida. */
export async function migrate(sql: Db): Promise<string[]> {
  await sql`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`

  const files = (await readdir(MIGRATIONS_DIR)).filter(f => f.endsWith('.sql')).sort()
  const done = new Set((await sql`SELECT version FROM schema_migrations`).map(r => r.version as string))

  const applied: string[] = []
  for (const file of files) {
    const version = file.replace(/\.sql$/, '')
    if (done.has(version)) continue
    const body = await readFile(join(MIGRATIONS_DIR, file), 'utf8')
    await sql.begin(async tx => {
      await tx.unsafe(body)
      await tx`INSERT INTO schema_migrations (version) VALUES (${version})`
    })
    applied.push(version)
  }
  return applied
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { existsSync } = await import('node:fs')
  if (existsSync('.env')) process.loadEnvFile('.env')
  const { db } = await import('./client.ts')
  const sql = db()
  const applied = await migrate(sql)
  console.log(applied.length ? `aplicadas: ${applied.join(', ')}` : 'sin migraciones pendientes')
  await sql.end()
}
