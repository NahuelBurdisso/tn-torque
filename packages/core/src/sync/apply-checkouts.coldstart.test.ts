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
  await sql`INSERT INTO stores (id, slug, name, timezone, instance)
            VALUES (${STORE}, 'demo', 'Demo', 'UTC', 'torque-pc')`
})
afterAll(async () => { await sql.end() })

/** 83 checkouts, como los que tiene acme: todos viejos, todos abandonados. */
const backlog = () => Array.from({ length: 83 }, (_, i) => {
  const iso = new Date(Date.now() - (2 + i) * 3_600_000).toISOString()
  return { id: 1000 + i, token: `tok-${i}`, contact_email: `p${i}@x.com`,
           contact_phone: '+5491155550100', total: '69000.00',
           created_at: iso, updated_at: iso }
})

async function run(rows: ReturnType<typeof backlog>, mode: 'backfill' | 'incremental') {
  const runId = await startRun(sql, STORE, 'checkouts', mode)
  await stageCheckouts(sql, runId, STORE, rows)
  const stats = await sql.begin(tx => applyCheckouts(tx, runId, STORE, mode))
  await finishRun(sql, runId, { rowsSeen: 0, rowsChanged: 0, eventsEmitted: stats.eventsEmitted },
                  undefined, stats.rowsSeen)
  if (mode === 'backfill') await sql`UPDATE stores SET backfilled_at = now() WHERE id = ${STORE}`
  return stats
}

/**
 * Lee backfilled_at de vuelta de la base. Los fixtures que necesitan caer a
 * un lado u otro del guardia (tn_created_at > backfilled_at) se construyen a
 * partir de ESTE valor, no de `new Date()` del host: el guardia y el chequeo
 * de edad corren del lado de Postgres (now() ahí adentro), y el reloj del
 * host puede estar corrido respecto del de Postgres — en Docker Desktop se
 * midió hasta ~0.7s de desfasaje. Con un margen de un minuto contra
 * backfilled_at, ese desfasaje deja de importar.
 */
async function backfilledAtOf(storeId: number): Promise<Date> {
  const [row] = await sql<{ backfilled_at: Date }[]>`
    SELECT backfilled_at FROM stores WHERE id = ${storeId}`
  return row!.backfilled_at
}

describe('ARRANQUE EN FRÍO DE RELOJ', () => {
  it('el backfill no emite, y el sync SIGUIENTE tampoco', async () => {
    const rows = backlog()

    const first = await run(rows, 'backfill')
    expect(first.rowsSeen).toBe(83)
    expect(first.eventsEmitted).toBe(0)

    // Esta es la afirmación que importa. El guardia del hito 0 no la cubre:
    // checkout.abandoned no necesita una transición, solo edad, así que sin
    // un guardia propio los 83 dispararían acá.
    const second = await run(rows, 'incremental')
    expect(second.eventsEmitted).toBe(0)

    const [r] = await sql<{ count: number }[]>`SELECT count(*)::int AS count FROM events`
    expect(r!.count).toBe(0)
  })

  it('un checkout nuevo posterior al backfill sí emite', async () => {
    await run(backlog(), 'backfill')
    const backfilledAt = await backfilledAtOf(STORE)

    // El guardia (tn_created_at > backfilled_at) y el chequeo de edad
    // (tn_updated_at < now() - 60min) se verifican por separado, así que acá
    // updated_at cae ANTES que created_at — al revés de un checkout real,
    // donde lo último tocado nunca precede a cuando se creó. No se está
    // modelando el ciclo de vida real de un carrito, sino satisfaciendo cada
    // condición del lado de Postgres para que la comparación no dependa de
    // en qué momento exacto corre el test.
    const nuevo = [{
      id: 9999, token: 'tok-nuevo', contact_email: 'nueva@x.com',
      contact_phone: '+5491155550100', total: '69000.00',
      created_at: new Date(backfilledAt.getTime() + 60_000).toISOString(),
      updated_at: new Date(backfilledAt.getTime() - 90 * 60_000).toISOString(),
    }]
    const stats = await run(nuevo, 'incremental')
    expect(stats.eventsEmitted).toBe(1)
  })

  it('un checkout nuevo pero reciente todavía no emite', async () => {
    await run(backlog(), 'backfill')
    const backfilledAt = await backfilledAtOf(STORE)

    // Acá el margen (10 minutos) ya alcanzaba para no ser sensible al
    // desfasaje de reloj observado (por debajo del segundo): el chequeo de
    // edad falla solo, sin importar qué lado gane el guardia. Se deriva
    // igual de backfilled_at para no dejar una lectura de reloj del host
    // suelta en el archivo.
    const reciente = [{
      id: 9998, token: 'tok-reciente', contact_email: 'x@x.com',
      contact_phone: '+5491155550100', total: '1000.00',
      created_at: new Date(backfilledAt.getTime() + 60_000).toISOString(),
      updated_at: new Date(backfilledAt.getTime() - 10 * 60_000).toISOString(),   // 10 min
    }]
    const stats = await run(reciente, 'incremental')
    expect(stats.eventsEmitted).toBe(0)
  })
})
