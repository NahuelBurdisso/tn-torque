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
    await markNeedsReauth(sql, 777)
    expect((await getStore(sql, 'demo'))!.state).toBe('needs_reauth')
  })

  it('storeToken falla si la tienda no existe', async () => {
    await expect(storeToken(sql, 'fantasma', key)).rejects.toThrow(/fantasma/)
  })
})
