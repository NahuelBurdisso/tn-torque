import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { connect, migrate } from '@tnt/db'
import { startRun, stageVariants, applyVariants } from './apply.ts'

const sql = connect(process.env.TNT_TEST_DATABASE_URL!)
const sqlA = connect(process.env.TNT_TEST_DATABASE_URL!)
const sqlB = connect(process.env.TNT_TEST_DATABASE_URL!)
const STORE = 1

beforeEach(async () => {
  await migrate(sql)
  await sql`TRUNCATE stores CASCADE`
  await sql`TRUNCATE stage_variants, stage_products`
  await sql`INSERT INTO stores (id, slug, name, timezone, instance)
            VALUES (${STORE}, 'demo', 'Demo', 'UTC', 'torque-pc')`
})
afterAll(async () => {
  await sql.end()
  await sqlA.end()
  await sqlB.end()
})

const variant = (id: number, stock: number | null) => ({
  id, product_id: 10, stock, price: '5000.00', promotional_price: null, sku: `SKU-${id}`,
})

describe('applyVariants — carrera entre dos syncs concurrentes', () => {
  it('dos detecciones independientes de la misma transición 0->5 emiten UN solo evento', async () => {
    // baseline: la variante arranca en 0 (backfill, no emite)
    const backfillRun = await startRun(sql, STORE, 'variants', 'backfill')
    await stageVariants(sql, backfillRun, STORE, [variant(100, 0)])
    await applyVariants(sql, backfillRun, STORE, 'backfill')

    // dos corridas de sync independientes (dos conexiones), cada una staggea
    // la MISMA transición 0 -> 5 para la misma variante, como pasaría si un
    // cron se solapa con una corrida manual sobre la misma tienda.
    const runA = await startRun(sqlA, STORE, 'variants', 'incremental')
    const runB = await startRun(sqlB, STORE, 'variants', 'incremental')
    await stageVariants(sqlA, runA, STORE, [variant(100, 5)])
    await stageVariants(sqlB, runB, STORE, [variant(100, 5)])

    const [statsA, statsB] = await Promise.all([
      applyVariants(sqlA, runA, STORE, 'incremental'),
      applyVariants(sqlB, runB, STORE, 'incremental'),
    ])

    // Una restock real. Un solo evento — sin importar cuál corrida "ganó".
    expect(statsA.eventsEmitted + statsB.eventsEmitted).toBe(1)

    const [row] = await sql<{ count: number }[]>`SELECT count(*)::int AS count FROM events`
    expect(row!.count).toBe(1)
  })
})
