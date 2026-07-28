import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { connect, migrate } from '@tnt/db'
import { startRun, stageVariants, applyVariants } from './apply.ts'

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

const variant = (id: number, stock: number | null) => ({
  id, product_id: 10, stock, price: '5000.00', promotional_price: null, sku: `SKU-${id}`,
})

describe('applyVariants — id de variante duplicado en un mismo staging', () => {
  it('dos filas para el mismo id (offset pagination repitiendo una fila) no abortan el apply', async () => {
    const runId = await startRun(sql, STORE, 'variants', 'backfill')

    // Simula lo que puede producir la paginación por offset de TN cuando el
    // catálogo cambia mientras se pagina: la misma variante aparece dos
    // veces en el mismo listAll(), con valores distintos.
    await stageVariants(sql, runId, STORE, [variant(100, 0), variant(100, 5)])

    const stats = await applyVariants(sql, runId, STORE, 'backfill')

    expect(stats.rowsSeen).toBe(1)
    const rows = await sql`SELECT id, stock FROM variants WHERE store_id = ${STORE} AND id = 100`
    expect(rows.length).toBe(1)
  })
})
