import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { connect, migrate } from '@tnt/db'
import { stageCheckouts } from './stage.ts'

const sql = connect(process.env.TNT_TEST_DATABASE_URL!)

beforeEach(async () => {
  await migrate(sql)
  await sql`TRUNCATE stores CASCADE`
  await sql`TRUNCATE stage_checkouts`
  await sql`INSERT INTO stores (id, slug, name, timezone, instance)
            VALUES (1, 'demo', 'Demo', 'UTC', 'torque-pc')`
})
afterAll(async () => { await sql.end() })

const ck = (id: number, o: Record<string, unknown> = {}) => ({
  id, token: `tok-${id}`, contact_email: 'a@b.com', contact_phone: '+5491155550100',
  total: '1000.00', created_at: '2026-07-28T10:00:00+00:00',
  updated_at: '2026-07-28T10:05:00+00:00', ...o,
})

describe('stageCheckouts', () => {
  it('inserta las filas con el raw completo', async () => {
    await stageCheckouts(sql, 1, 1, [ck(10), ck(11)])
    const rows = await sql<{ id: string; token: string; raw: Record<string, unknown> }[]>`
      SELECT id, token, raw FROM stage_checkouts ORDER BY id`
    expect(rows).toHaveLength(2)
    expect(rows[0]!.token).toBe('tok-10')
    expect(rows[0]!.raw.contact_email).toBe('a@b.com')
  })

  it('deduplica por id: gana la última aparición', async () => {
    await stageCheckouts(sql, 1, 1, [ck(10, { total: '1000.00' }), ck(10, { total: '2000.00' })])
    const rows = await sql<{ raw: Record<string, unknown> }[]>`SELECT raw FROM stage_checkouts`
    expect(rows).toHaveLength(1)
    expect(rows[0]!.raw.total).toBe('2000.00')
  })

  it('no hace nada con una lista vacía', async () => {
    await stageCheckouts(sql, 1, 1, [])
    const [r] = await sql<{ count: number }[]>`SELECT count(*)::int AS count FROM stage_checkouts`
    expect(r!.count).toBe(0)
  })
})
