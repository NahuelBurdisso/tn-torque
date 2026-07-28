import { describe, it, expect, beforeEach } from 'vitest'
import { connect } from './client.ts'
import { migrate } from './migrate.ts'

const url = process.env.TNT_TEST_DATABASE_URL!

describe('migrate', () => {
  beforeEach(async () => {
    const sql = connect(url)
    await sql`DROP SCHEMA public CASCADE`
    await sql`CREATE SCHEMA public`
    await sql.end()
  })

  it('aplica todas las migraciones y las registra', async () => {
    const sql = connect(url)
    const applied = await migrate(sql)
    expect(applied.length).toBeGreaterThan(0)
    const rows = await sql`SELECT version FROM schema_migrations ORDER BY version`
    expect(rows.map(r => r.version)).toEqual(applied)
    await sql.end()
  })

  it('es idempotente: la segunda corrida no aplica nada', async () => {
    const sql = connect(url)
    await migrate(sql)
    const second = await migrate(sql)
    expect(second).toEqual([])
    await sql.end()
  })
})
