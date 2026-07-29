import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { randomBytes } from 'node:crypto'
import { connect, migrate } from '@tnt/db'
import { upsertStore, getStore, storeToken, markNeedsReauth } from './repo.ts'

const sql = connect(process.env.TNT_TEST_DATABASE_URL!)
const key = randomBytes(32)

beforeEach(async () => {
  await migrate(sql)
  await sql`TRUNCATE stores CASCADE`
})
afterAll(async () => { await sql.end() })

const cfg = {
  store: { slug: 'demo', name: 'Demo', timezone: 'UTC', instance: 'torque-pc' },
  tiendanube: { store_id: 777 },
  sending: { dns_verified: false, daily_budget: 50 },
  modules: {},
  brand: {},
}

describe('store repo', () => {
  it('da de alta la tienda y guarda el token sellado', async () => {
    await upsertStore(sql, cfg, { accessToken: 'secreto', scope: 'read_products' }, key)
    const row = await getStore(sql, 'demo')
    expect(row!.id).toBe(777)
    expect(row!.access_token_sealed).not.toContain('secreto')
    expect(await storeToken(sql, 'demo', key)).toBe('secreto')
  })

  it('el alta es idempotente y no pisa el token si no viene uno nuevo', async () => {
    await upsertStore(sql, cfg, { accessToken: 'secreto', scope: 's' }, key)
    await upsertStore(sql, { ...cfg, store: { ...cfg.store, name: 'Demo 2' } }, null, key)
    const row = await getStore(sql, 'demo')
    expect(row!.name).toBe('Demo 2')
    expect(await storeToken(sql, 'demo', key)).toBe('secreto')
  })

  it('marca needs_reauth', async () => {
    await upsertStore(sql, cfg, { accessToken: 't', scope: 's' }, key)
    await markNeedsReauth(sql, 777, 'demo')
    expect((await getStore(sql, 'demo'))!.state).toBe('needs_reauth')
  })

  it('storeToken falla si la tienda no existe', async () => {
    await expect(storeToken(sql, 'fantasma', key)).rejects.toThrow(/fantasma/)
  })

  it('markNeedsReauth cancela los trabajos pendientes de esa tienda', async () => {
    await upsertStore(sql, cfg, { accessToken: 't', scope: 's' }, key)
    await sql`INSERT INTO jobs (store_id, module, kind, run_at, dedupe_key, cancel_key, state)
              VALUES (777, 'digest', 'scheduled', now(), 'd1', 'store:demo', 'pending'),
                     (777, 'digest', 'scheduled', now(), 'd2', 'store:demo', 'done')`
    await markNeedsReauth(sql, 777, 'demo')
    const rows = await sql<{ dedupe_key: string; state: string }[]>`
      SELECT dedupe_key, state FROM jobs ORDER BY dedupe_key`
    expect(rows[0]!.state).toBe('cancelled')
    expect(rows[1]!.state).toBe('done')     // lo que ya corrió no se toca
  })
})
