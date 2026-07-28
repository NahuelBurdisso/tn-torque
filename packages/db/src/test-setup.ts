// NOTE: `postgres` is intentionally duplicated as a root devDependency (see workspace
// package.json). vitest's globalSetup runs in the main process and resolves imports
// from the workspace root, not from this package — without the root copy, this file
// fails to load `postgres` even though packages/db already depends on it. Do not remove.
import { existsSync } from 'node:fs'
import postgres from 'postgres'

/** Recrea la base de tests antes de toda la suite. */
export default async function setup() {
  // globalSetup corre en el proceso principal de vitest, que no ejecuta setupFiles.
  if (existsSync('.env')) process.loadEnvFile('.env')

  const testUrl = process.env.TNT_TEST_DATABASE_URL
  if (!testUrl) throw new Error('TNT_TEST_DATABASE_URL no está definida')

  const dbName = new URL(testUrl).pathname.slice(1)
  const adminUrl = new URL(testUrl)
  adminUrl.pathname = '/postgres'

  const admin = postgres(adminUrl.toString(), { onnotice: () => {} })
  await admin.unsafe(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`)
  await admin.unsafe(`CREATE DATABASE ${dbName}`)
  await admin.end()
}
