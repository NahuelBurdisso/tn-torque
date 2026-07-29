import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import { connect, migrate } from '@tnt/db'
import { syncStore } from './run-sync.ts'
import { TnClient } from '../tn/client.ts'
import { TokenBucket } from '../tn/rate-limiter.ts'
import type { StoreConfig } from '../config/store-config.ts'

const sql = connect(process.env.TNT_TEST_DATABASE_URL!)
const STORE = 1

const storeCfg: StoreConfig = {
  store: { slug: 'demo', name: 'Demo', timezone: 'America/Argentina/Cordoba', instance: 'torque-pc' },
  tiendanube: { store_id: STORE },
  sending: { dns_verified: false, daily_budget: 200 },
  modules: {},
  brand: {},
}

beforeEach(async () => {
  await migrate(sql)
  await sql`TRUNCATE stores CASCADE`
  await sql`TRUNCATE stage_variants, stage_products, stage_checkouts`
  await sql`INSERT INTO stores (id, slug, name, timezone, instance)
            VALUES (${STORE}, 'demo', 'Demo', 'UTC', 'torque-pc')`
})
afterAll(async () => { await sql.end() })

const product = (id: number, variants: unknown[]) => ({ id, name: { es: `P${id}` }, variants })

/** /products devuelve lo pasado; /checkouts responde vacío salvo que se pisen los mocks con Once. */
function clientReturning(products: unknown[]) {
  const f = vi.fn(async (url: string) => {
    const body = url.includes('/checkouts') ? [] : products
    return new Response(JSON.stringify(body), {
      status: 200, headers: { 'content-type': 'application/json' },
    })
  })
  return new TnClient({
    storeId: STORE, token: 't', userAgent: 'test',
    bucket: new TokenBucket({ capacity: 40, refillPerSec: 2, now: () => 0 }),
    fetchImpl: f as unknown as typeof fetch, sleep: async () => {},
  })
}

describe('syncStore', () => {
  it('el primer sync es backfill, llena el espejo y no emite eventos', async () => {
    const client = clientReturning([product(10, [{ id: 100, product_id: 10, stock: 0, price: '100' }])])
    const stats = await syncStore(sql, client, STORE, storeCfg)
    expect(stats.mode).toBe('backfill')
    expect(stats.eventsEmitted).toBe(0)
    const [row] = await sql<{ count: number }[]>`SELECT count(*)::int AS count FROM variants`
    expect(row!.count).toBe(1)
  })

  it('marca backfilled_at para que el siguiente sync sea incremental', async () => {
    const client = clientReturning([product(10, [{ id: 100, product_id: 10, stock: 0, price: '100' }])])
    await syncStore(sql, client, STORE, storeCfg)
    const [s] = await sql`SELECT backfilled_at FROM stores WHERE id = ${STORE}`
    expect(s!.backfilled_at).not.toBeNull()

    const client2 = clientReturning([product(10, [{ id: 100, product_id: 10, stock: 4, price: '100' }])])
    const stats = await syncStore(sql, client2, STORE, storeCfg)
    expect(stats.mode).toBe('incremental')
    expect(stats.eventsEmitted).toBe(1)
  })

  it('aplana las variantes anidadas dentro de los productos', async () => {
    const client = clientReturning([
      product(10, [{ id: 100, product_id: 10, stock: 1, price: '1' }, { id: 101, product_id: 10, stock: 2, price: '2' }]),
      product(11, [{ id: 110, product_id: 11, stock: 3, price: '3' }]),
    ])
    const stats = await syncStore(sql, client, STORE, storeCfg)
    expect(stats.rowsSeen).toBe(3)
    const [row] = await sql<{ count: number }[]>`SELECT count(*)::int AS count FROM products`
    expect(row!.count).toBe(2)
  })
})

describe('syncStore — checkouts', () => {
  it('sincroniza checkouts además de productos', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify([
        { id: 10, name: { es: 'P10' }, variants: [{ id: 100, product_id: 10, stock: 1, price: '1' }] },
      ]), { status: 200, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify([
        { id: 500, token: 'tok', contact_email: 'a@b.com', contact_phone: '+5491155550100',
          total: '1000.00', created_at: '2026-07-28T10:00:00Z', updated_at: '2026-07-28T10:00:00Z' },
      ]), { status: 200, headers: { 'content-type': 'application/json' } }))

    const client = new TnClient({
      storeId: STORE, token: 't', userAgent: 'test',
      bucket: new TokenBucket({ capacity: 40, refillPerSec: 2, now: () => 0 }),
      fetchImpl: f as unknown as typeof fetch, sleep: async () => {},
    })

    await syncStore(sql, client, STORE, storeCfg)
    const [r] = await sql<{ count: number }[]>`SELECT count(*)::int AS count FROM checkouts`
    expect(r!.count).toBe(1)
  })
})
