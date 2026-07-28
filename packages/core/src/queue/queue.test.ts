import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { connect, migrate } from '@tnt/db'
import { enqueue, tick, complete, fail, cancelByKey, recoverRunning } from './queue.ts'

const sql = connect(process.env.TNT_TEST_DATABASE_URL!)
const STORE = 1

beforeEach(async () => {
  await migrate(sql)
  await sql`TRUNCATE stores CASCADE`
  await sql`INSERT INTO stores (id, slug, name, timezone, instance)
            VALUES (${STORE}, 'demo', 'Demo', 'UTC', 'torque-pc')`
})
afterAll(async () => { await sql.end() })

const spec = (o: Partial<Parameters<typeof enqueue>[1]> = {}) => ({
  storeId: STORE,
  module: 'ntfy',
  kind: 'notify',
  runAt: new Date(Date.now() - 1000),
  dedupeKey: 'ntfy:1:1',
  cancelKey: 'store:demo',
  payload: { hello: 'world' },
  ...o,
})

describe('queue', () => {
  it('encola y levanta el trabajo vencido', async () => {
    await enqueue(sql, spec())
    const jobs = await tick(sql)
    expect(jobs).toHaveLength(1)
    expect(jobs[0]!.payload).toEqual({ hello: 'world' })
    expect(jobs[0]!.state).toBe('running')
  })

  it('no levanta trabajos futuros', async () => {
    await enqueue(sql, spec({ runAt: new Date(Date.now() + 3_600_000) }))
    expect(await tick(sql)).toHaveLength(0)
  })

  it('la dedupe_key impide encolar dos veces', async () => {
    expect(await enqueue(sql, spec())).not.toBeNull()
    expect(await enqueue(sql, spec())).toBeNull()
    const [{ count }] = await sql`SELECT count(*)::int AS count FROM jobs`
    expect(count).toBe(1)
  })

  it('un segundo tick no vuelve a levantar el mismo trabajo', async () => {
    await enqueue(sql, spec())
    expect(await tick(sql)).toHaveLength(1)
    expect(await tick(sql)).toHaveLength(0)
  })

  it('complete lo deja en done', async () => {
    await enqueue(sql, spec())
    const [job] = await tick(sql)
    await complete(sql, job!.id)
    const [r] = await sql`SELECT state FROM jobs WHERE id = ${job!.id}`
    expect(r!.state).toBe('done')
  })

  it('fail reprograma con backoff exponencial', async () => {
    await enqueue(sql, spec())
    const [job] = await tick(sql)
    await fail(sql, job!.id, 'boom')
    const [r] = await sql`SELECT state, attempts, last_error, run_at FROM jobs WHERE id = ${job!.id}`
    expect(r!.state).toBe('pending')
    expect(r!.attempts).toBe(1)
    expect(r!.last_error).toBe('boom')
    expect(new Date(r!.run_at as string).getTime()).toBeGreaterThan(Date.now())
  })

  it('al quinto fallo queda en failed y deja de reintentar', async () => {
    await enqueue(sql, spec())
    for (let i = 0; i < 5; i++) {
      await sql`UPDATE jobs SET run_at = now() - interval '1 hour' WHERE dedupe_key = 'ntfy:1:1'`
      const [job] = await tick(sql)
      await fail(sql, job!.id, `intento ${i}`)
    }
    const [r] = await sql`SELECT state, attempts FROM jobs WHERE dedupe_key = 'ntfy:1:1'`
    expect(r!.state).toBe('failed')
    expect(r!.attempts).toBe(5)
  })

  it('cancelByKey mata todos los pendientes con esa clave', async () => {
    await enqueue(sql, spec({ dedupeKey: 'a', cancelKey: 'mail:cart:demo:x@y.com' }))
    await enqueue(sql, spec({ dedupeKey: 'b', cancelKey: 'mail:cart:demo:x@y.com' }))
    await enqueue(sql, spec({ dedupeKey: 'c', cancelKey: 'mail:cart:demo:otra@y.com' }))
    expect(await cancelByKey(sql, 'mail:cart:demo:x@y.com')).toBe(2)
    const rows = await sql`SELECT dedupe_key, state FROM jobs ORDER BY dedupe_key`
    expect(rows.map(r => r.state)).toEqual(['cancelled', 'cancelled', 'pending'])
  })

  it('cancelByKey no toca los que ya corrieron', async () => {
    await enqueue(sql, spec({ dedupeKey: 'a', cancelKey: 'k' }))
    const [job] = await tick(sql)
    await complete(sql, job!.id)
    expect(await cancelByKey(sql, 'k')).toBe(0)
  })

  it('recoverRunning devuelve a pending lo que quedó colgado en un reinicio', async () => {
    await enqueue(sql, spec())
    await tick(sql)
    expect(await recoverRunning(sql)).toBe(1)
    const [r] = await sql`SELECT state FROM jobs WHERE dedupe_key = 'ntfy:1:1'`
    expect(r!.state).toBe('pending')
  })

  it('recoverRunning manda a failed lo que ya agotó los intentos', async () => {
    await enqueue(sql, spec())
    await sql`UPDATE jobs SET state = 'running', attempts = 5 WHERE dedupe_key = 'ntfy:1:1'`
    await recoverRunning(sql)
    const [r] = await sql`SELECT state FROM jobs WHERE dedupe_key = 'ntfy:1:1'`
    expect(r!.state).toBe('failed')
  })

  it('respeta el límite del tick', async () => {
    for (let i = 0; i < 5; i++) await enqueue(sql, spec({ dedupeKey: `k${i}` }))
    expect(await tick(sql, 2)).toHaveLength(2)
  })
})
