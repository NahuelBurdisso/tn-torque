import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { connect, migrate } from '@tnt/db'
import { startRun, stageVariants, applyVariants, finishRun } from './apply.ts'
import { backInStockKey } from '../events/keys.ts'

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

const variant = (id: number, stock: number | null, price = '5000.00') => ({
  id, product_id: 10, stock, price, promotional_price: null, sku: `SKU-${id}`,
})

async function runSync(rows: ReturnType<typeof variant>[], mode: 'backfill' | 'incremental') {
  const runId = await startRun(sql, STORE, 'variants', mode)
  await stageVariants(sql, runId, STORE, rows)
  const stats = await applyVariants(sql, runId, STORE, mode)
  await finishRun(sql, runId, stats)
  return stats
}

describe('applyVariants', () => {
  it('el backfill llena el espejo y NO emite un solo evento', async () => {
    const stats = await runSync([variant(100, 0), variant(101, 5), variant(102, 0)], 'backfill')
    expect(stats.rowsSeen).toBe(3)
    expect(stats.eventsEmitted).toBe(0)
    const [row] = await sql<{ count: number }[]>`SELECT count(*)::int AS count FROM events`
    expect(row!.count).toBe(0)
    const [variantsRow] = await sql<{ count: number }[]>`SELECT count(*)::int AS count FROM variants`
    expect(variantsRow!.count).toBe(3)
  })

  it('el backfill escribe una fila baseline de snapshot por variante', async () => {
    await runSync([variant(100, 0), variant(101, 5)], 'backfill')
    const [row] = await sql<{ count: number }[]>`SELECT count(*)::int AS count FROM variant_snapshots`
    expect(row!.count).toBe(2)
  })

  it('ARRANQUE EN FRÍO: un catálogo entero agotado no dispara nada', async () => {
    const soldOut = Array.from({ length: 44 }, (_, i) => variant(200 + i, 0))
    const inStock = Array.from({ length: 37 }, (_, i) => variant(300 + i, 4))
    const stats = await runSync([...soldOut, ...inStock], 'backfill')
    expect(stats.eventsEmitted).toBe(0)
    const [row] = await sql<{ count: number }[]>`SELECT count(*)::int AS count FROM events`
    expect(row!.count).toBe(0)
  })

  it('emite back_in_stock cuando el stock pasa de 0 a positivo', async () => {
    await runSync([variant(100, 0)], 'backfill')
    const stats = await runSync([variant(100, 3)], 'incremental')
    expect(stats.eventsEmitted).toBe(1)
    const [e] = await sql`SELECT * FROM events`
    expect(e!.type).toBe('variant.back_in_stock')
    expect(e!.entity_id).toBe('100')
    expect(e!.payload).toMatchObject({ old_stock: 0, new_stock: 3, product_id: 10 })
  })

  it('la dedupe_key de la base coincide con la del código', async () => {
    await runSync([variant(100, 0)], 'backfill')
    await runSync([variant(100, 3)], 'incremental')
    const [e] = await sql`SELECT dedupe_key FROM events`
    const [s] = await sql`SELECT id FROM variant_snapshots ORDER BY id DESC LIMIT 1`
    expect(e!.dedupe_key).toBe(backInStockKey(STORE, 100, Number(s!.id)))
  })

  it('NO emite para una variante nueva que ya viene con stock', async () => {
    const stats = await runSync([variant(999, 7)], 'incremental')
    expect(stats.eventsEmitted).toBe(0)
  })

  it('NO emite cuando el stock sube sin haber estado en cero', async () => {
    await runSync([variant(100, 2)], 'backfill')
    const stats = await runSync([variant(100, 9)], 'incremental')
    expect(stats.eventsEmitted).toBe(0)
  })

  it('emite cuando pasa de 0 a sin-control-de-stock (null)', async () => {
    await runSync([variant(100, 0)], 'backfill')
    const stats = await runSync([variant(100, null)], 'incremental')
    expect(stats.eventsEmitted).toBe(1)
  })

  it('un sync sin cambios no escribe snapshots ni eventos', async () => {
    await runSync([variant(100, 5)], 'backfill')
    const stats = await runSync([variant(100, 5)], 'incremental')
    expect(stats.rowsChanged).toBe(0)
    expect(stats.eventsEmitted).toBe(0)
    const [row] = await sql<{ count: number }[]>`SELECT count(*)::int AS count FROM variant_snapshots`
    expect(row!.count).toBe(1)
  })

  it('un cambio de precio escribe snapshot pero no emite back_in_stock', async () => {
    await runSync([variant(100, 5, '5000.00')], 'backfill')
    const stats = await runSync([variant(100, 5, '3990.00')], 'incremental')
    expect(stats.rowsChanged).toBe(1)
    expect(stats.eventsEmitted).toBe(0)
  })

  it('correr el mismo sync dos veces no duplica el evento', async () => {
    await runSync([variant(100, 0)], 'backfill')
    const first = await runSync([variant(100, 3)], 'incremental')
    const second = await runSync([variant(100, 3)], 'incremental')
    expect(first.eventsEmitted).toBe(1)
    expect(second.eventsEmitted).toBe(0)
    const [row] = await sql<{ count: number }[]>`SELECT count(*)::int AS count FROM events`
    expect(row!.count).toBe(1)
  })

  it('registra la corrida en sync_runs', async () => {
    await runSync([variant(100, 0)], 'backfill')
    const [r] = await sql`SELECT * FROM sync_runs`
    expect(r!.mode).toBe('backfill')
    expect(r!.rows_seen).toBe(1)
    expect(r!.finished_at).not.toBeNull()
  })

  it('limpia el staging después de aplicar', async () => {
    await runSync([variant(100, 0)], 'backfill')
    const [row] = await sql<{ count: number }[]>`SELECT count(*)::int AS count FROM stage_variants`
    expect(row!.count).toBe(0)
  })
})
