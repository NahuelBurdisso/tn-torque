import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import { connect, migrate } from '@tnt/db'
import { syncVariants } from './run-sync.ts'
import { TnClient } from '../tn/client.ts'
import { TokenBucket } from '../tn/rate-limiter.ts'

const sql = connect(process.env.TNT_TEST_DATABASE_URL!)
const STORE = 1

beforeEach(async () => {
  await migrate(sql)
  await sql`TRUNCATE stores CASCADE`
  await sql`TRUNCATE stage_variants, stage_products`
  await sql`INSERT INTO stores (id, slug, name, timezone, instance)
            VALUES (${STORE}, 'demo', 'Demo', 'UTC', 'torque-pc')`
})
afterAll(async () => { await sql.end() })

const product = (id: number, variants: unknown[]) => ({ id, name: { es: `P${id}` }, variants })

function clientReturning(products: unknown[]) {
  const f = vi.fn().mockResolvedValue(new Response(JSON.stringify(products), {
    status: 200, headers: { 'content-type': 'application/json' },
  }))
  return new TnClient({
    storeId: STORE, token: 't', userAgent: 'test',
    bucket: new TokenBucket({ capacity: 40, refillPerSec: 2, now: () => 0 }),
    fetchImpl: f as unknown as typeof fetch, sleep: async () => {},
  })
}

describe('syncVariants', () => {
  it('el primer sync es backfill, llena el espejo y no emite eventos', async () => {
    const client = clientReturning([product(10, [{ id: 100, product_id: 10, stock: 0, price: '100' }])])
    const stats = await syncVariants(sql, client, STORE)
    expect(stats.mode).toBe('backfill')
    expect(stats.eventsEmitted).toBe(0)
    const [row] = await sql<{ count: number }[]>`SELECT count(*)::int AS count FROM variants`
    expect(row!.count).toBe(1)
  })

  it('marca backfilled_at para que el siguiente sync sea incremental', async () => {
    const client = clientReturning([product(10, [{ id: 100, product_id: 10, stock: 0, price: '100' }])])
    await syncVariants(sql, client, STORE)
    const [s] = await sql`SELECT backfilled_at FROM stores WHERE id = ${STORE}`
    expect(s!.backfilled_at).not.toBeNull()

    const client2 = clientReturning([product(10, [{ id: 100, product_id: 10, stock: 4, price: '100' }])])
    const stats = await syncVariants(sql, client2, STORE)
    expect(stats.mode).toBe('incremental')
    expect(stats.eventsEmitted).toBe(1)
  })

  it('aplana las variantes anidadas dentro de los productos', async () => {
    const client = clientReturning([
      product(10, [{ id: 100, product_id: 10, stock: 1, price: '1' }, { id: 101, product_id: 10, stock: 2, price: '2' }]),
      product(11, [{ id: 110, product_id: 11, stock: 3, price: '3' }]),
    ])
    const stats = await syncVariants(sql, client, STORE)
    expect(stats.rowsSeen).toBe(3)
    const [row] = await sql<{ count: number }[]>`SELECT count(*)::int AS count FROM products`
    expect(row!.count).toBe(2)
  })
})
