import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { connect, migrate } from '@tnt/db'
import { startRun, finishRun } from './apply.ts'
import { stageCheckouts } from './stage.ts'
import { applyCheckouts } from './apply-checkouts.ts'

const sql = connect(process.env.TNT_TEST_DATABASE_URL!)
const STORE = 1

beforeEach(async () => {
  await migrate(sql)
  await sql`TRUNCATE stores CASCADE`
  await sql`TRUNCATE stage_checkouts`
  await sql`INSERT INTO stores (id, slug, name, timezone, instance, backfilled_at)
            VALUES (${STORE}, 'demo', 'Demo', 'UTC', 'torque-pc', now() - interval '30 days')`
})
afterAll(async () => { await sql.end() })

const ck = (id: number, minutesOld = 120) => ({
  id, token: `tok-${id}`, contact_email: `p${id}@x.com`, contact_phone: '+5491155550100',
  total: '1000.00',
  created_at: new Date(Date.now() - minutesOld * 60_000).toISOString(),
  updated_at: new Date(Date.now() - minutesOld * 60_000).toISOString(),
})

async function run(rows: ReturnType<typeof ck>[], mode: 'backfill' | 'incremental' = 'incremental') {
  const runId = await startRun(sql, STORE, 'checkouts', mode)
  await stageCheckouts(sql, runId, STORE, rows)
  const stats = await sql.begin(tx => applyCheckouts(tx, runId, STORE, mode))
  await finishRun(sql, runId, { rowsSeen: 0, rowsChanged: 0, eventsEmitted: stats.eventsEmitted },
                  undefined, stats.rowsSeen)
  return stats
}

describe('applyCheckouts', () => {
  it('inserta los checkouts en el espejo', async () => {
    const stats = await run([ck(10), ck(11)])
    expect(stats.rowsSeen).toBe(2)
    const [r] = await sql<{ count: number }[]>`SELECT count(*)::int AS count FROM checkouts`
    expect(r!.count).toBe(2)
  })

  it('marca gone_at a lo que ya no viene', async () => {
    await run([ck(10), ck(11)])
    await run([ck(10)])
    const rows = await sql<{ id: string; gone_at: Date | null }[]>`
      SELECT id, gone_at FROM checkouts ORDER BY id`
    expect(rows[0]!.gone_at).toBeNull()
    expect(rows[1]!.gone_at).not.toBeNull()
  })

  it('una caída chica en un espejo chico no es sospechosa', async () => {
    await run([ck(10), ck(11)])
    const stats = await run([ck(10)])   // 50% de caída, pero una sola fila
    expect(stats.reconciled).toBe(true)
  })

  it('limpia gone_at si el checkout reaparece', async () => {
    await run([ck(10), ck(11)])
    await run([ck(10)])
    await run([ck(10), ck(11)])
    const rows = await sql<{ gone_at: Date | null }[]>`SELECT gone_at FROM checkouts ORDER BY id`
    expect(rows[0]!.gone_at).toBeNull()
    expect(rows[1]!.gone_at).toBeNull()
  })

  it('el reconcile no toca los checkouts de otra tienda', async () => {
    await sql`INSERT INTO stores (id, slug, name, timezone, instance, backfilled_at)
              VALUES (2, 'otra', 'Otra', 'UTC', 'torque-pc', now() - interval '30 days')`
    const runOther = await startRun(sql, 2, 'checkouts', 'incremental')
    await stageCheckouts(sql, runOther, 2, [ck(90)])
    await sql.begin(tx => applyCheckouts(tx, runOther, 2, 'incremental'))

    await run([ck(10)])
    await run([])   // la tienda 1 se queda sin checkouts

    const [otra] = await sql<{ gone_at: Date | null }[]>`
      SELECT gone_at FROM checkouts WHERE store_id = 2`
    expect(otra!.gone_at).toBeNull()
  })

  it('se abstiene ante una caída sospechosa la primera vez', async () => {
    await run([ck(10), ck(11), ck(12), ck(13), ck(14)])
    const stats = await run([ck(10)])          // caída del 80%
    expect(stats.reconciled).toBe(false)
    const [r] = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM checkouts WHERE gone_at IS NOT NULL`
    expect(r!.count).toBe(0)
  })

  it('reconcilia cuando dos corridas seguidas confirman el conteo bajo', async () => {
    await run([ck(10), ck(11), ck(12), ck(13), ck(14)])
    await run([ck(10)])                        // se abstiene
    const stats = await run([ck(10)])          // confirma
    expect(stats.reconciled).toBe(true)
    const [r] = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM checkouts WHERE gone_at IS NOT NULL`
    expect(r!.count).toBe(4)
  })

  it('una caída chica reconcilia de una', async () => {
    await run([ck(10), ck(11), ck(12), ck(13), ck(14)])
    const stats = await run([ck(10), ck(11), ck(12), ck(13)])   // caída del 20%
    expect(stats.reconciled).toBe(true)
    const [r] = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM checkouts WHERE gone_at IS NOT NULL`
    expect(r!.count).toBe(1)
  })

  it('limpia el staging al terminar', async () => {
    await run([ck(10)])
    const [r] = await sql<{ count: number }[]>`SELECT count(*)::int AS count FROM stage_checkouts`
    expect(r!.count).toBe(0)
  })
})
