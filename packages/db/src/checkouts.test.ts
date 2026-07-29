import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { connect } from './client.ts'
import { migrate } from './migrate.ts'

const sql = connect(process.env.TNT_TEST_DATABASE_URL!)

beforeEach(async () => {
  await migrate(sql)
  await sql`TRUNCATE stores CASCADE`
  await sql`INSERT INTO stores (id, slug, name, timezone, instance)
            VALUES (1, 'demo', 'Demo', 'UTC', 'torque-pc')`
})
afterAll(async () => { await sql.end() })

const raw = (o: Record<string, unknown>) => sql.json({
  contact_email: 'maria@example.com',
  contact_name: 'Maria Claudia',
  contact_phone: '+541155550100',
  total: '69900.00',
  abandoned_checkout_url: 'https://acme-store.example/checkout/v3/proxy/1/abc',
  ...o,
})

describe('espejo de checkouts', () => {
  it('extrae los campos de contacto y el monto del raw', async () => {
    await sql`INSERT INTO checkouts (store_id, id, token, raw) VALUES (1, 10, 'tok', ${raw({})})`
    const [c] = await sql<{ contact_name: string; contact_phone: string; total: string; resume_url: string }[]>`
      SELECT contact_name, contact_phone, total, resume_url FROM checkouts WHERE id = 10`
    expect(c!.contact_name).toBe('Maria Claudia')
    expect(c!.contact_phone).toBe('+541155550100')
    expect(Number(c!.total)).toBe(69900)
    expect(c!.resume_url).toContain('/checkout/v3/proxy/')
  })

  it('un total corrupto degrada a NULL sin voltear el insert del lote', async () => {
    await sql`INSERT INTO checkouts (store_id, id, token, raw) VALUES
      (1, 10, 'a', ${raw({ total: '69900.00' })}),
      (1, 11, 'b', ${raw({ total: 'GRATIS' })})`
    const rows = await sql<{ id: string; total: string | null }[]>`
      SELECT id, total FROM checkouts ORDER BY id`
    expect(Number(rows[0]!.total)).toBe(69900)
    expect(rows[1]!.total).toBeNull()
  })

  it('gone_at arranca en NULL', async () => {
    await sql`INSERT INTO checkouts (store_id, id, token, raw) VALUES (1, 10, 'tok', ${raw({})})`
    const [c] = await sql<{ gone_at: Date | null }[]>`SELECT gone_at FROM checkouts WHERE id = 10`
    expect(c!.gone_at).toBeNull()
  })

  it('borrar la tienda borra sus checkouts en cascada', async () => {
    await sql`INSERT INTO checkouts (store_id, id, token, raw) VALUES (1, 10, 'tok', ${raw({})})`
    await sql`DELETE FROM stores WHERE id = 1`
    const [r] = await sql<{ count: number }[]>`SELECT count(*)::int AS count FROM checkouts`
    expect(r!.count).toBe(0)
  })

  it('stage_checkouts es UNLOGGED', async () => {
    const [r] = await sql<{ relpersistence: string }[]>`
      SELECT relpersistence FROM pg_class WHERE relname = 'stage_checkouts'`
    expect(r!.relpersistence).toBe('u')
  })
})
