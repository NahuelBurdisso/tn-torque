import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { connect, migrate } from '@tnt/db'
import { startRun, stageProducts, applyProducts } from './apply.ts'

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

const product = (id: number, updatedAt: string) => ({
  id, name: { es: `P${id}` }, updated_at: updatedAt,
})

describe('applyProducts — id de producto duplicado en un mismo staging', () => {
  it('dos filas para el mismo id (offset pagination repitiendo una fila) no abortan el apply', async () => {
    const runId = await startRun(sql, STORE, 'variants', 'backfill')

    // Lo que produce la paginación por offset de TN cuando el catálogo
    // cambia mientras se pagina /products: el mismo producto aparece en dos
    // páginas, cada una con su propio raw.
    await stageProducts(sql, runId, STORE, [
      product(10, '2026-01-01T00:00:00Z'),
      product(10, '2026-01-02T00:00:00Z'),
    ])

    const n = await applyProducts(sql, runId, STORE)

    expect(n).toBe(1)
    const rows = await sql`SELECT id FROM products WHERE store_id = ${STORE} AND id = 10`
    expect(rows.length).toBe(1)
  })
})
