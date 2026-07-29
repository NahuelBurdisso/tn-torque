import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { connect, migrate } from '@tnt/db'
import { ensureScheduledJobs } from './scheduling.ts'
import type { TntModule } from './types.ts'

const sql = connect(process.env.TNT_TEST_DATABASE_URL!)
const STORE = 1

const cfg = {
  store: { slug: 'demo', name: 'Demo', timezone: 'America/Argentina/Cordoba', instance: 'torque-pc' },
  tiendanube: { store_id: STORE },
  sending: { dns_verified: false, daily_budget: 50 },
  modules: { fake: { enabled: true, mode: 'auto' as const } },
  brand: {},
}

const fakeModule: TntModule = {
  name: 'fake',
  subscribes: [],
  schedule: {
    nextRunAt: () => new Date('2026-07-28T12:00:00Z'),
    dedupe: (slug, runAt) => `fake:${slug}:${runAt.toISOString()}`,
  },
  handle: () => ({ enqueue: [] }),
  execute: async () => {},
}

beforeEach(async () => {
  await migrate(sql)
  await sql`TRUNCATE stores CASCADE`
  await sql`INSERT INTO stores (id, slug, name, timezone, instance)
            VALUES (${STORE}, 'demo', 'Demo', 'America/Argentina/Cordoba', 'torque-pc')`
})
afterAll(async () => { await sql.end() })

describe('ensureScheduledJobs', () => {
  it('crea el trabajo agendado', async () => {
    const n = await ensureScheduledJobs(sql, [fakeModule], STORE, cfg, new Date('2026-07-28T00:00:00Z'))
    expect(n).toBe(1)
    const [j] = await sql<{ module: string; dedupe_key: string; state: string }[]>`
      SELECT module, dedupe_key, state FROM jobs`
    expect(j!.module).toBe('fake')
    expect(j!.dedupe_key).toBe('fake:demo:2026-07-28T12:00:00.000Z')
    expect(j!.state).toBe('pending')
  })

  it('es idempotente: dos corridas no duplican', async () => {
    await ensureScheduledJobs(sql, [fakeModule], STORE, cfg, new Date('2026-07-28T00:00:00Z'))
    const n = await ensureScheduledJobs(sql, [fakeModule], STORE, cfg, new Date('2026-07-28T01:00:00Z'))
    expect(n).toBe(0)
    const [r] = await sql<{ count: number }[]>`SELECT count(*)::int AS count FROM jobs`
    expect(r!.count).toBe(1)
  })

  it('lo recrea si se perdió: no hay cadena que romper', async () => {
    await ensureScheduledJobs(sql, [fakeModule], STORE, cfg, new Date('2026-07-28T00:00:00Z'))
    await sql`DELETE FROM jobs`
    const n = await ensureScheduledJobs(sql, [fakeModule], STORE, cfg, new Date('2026-07-28T00:00:00Z'))
    expect(n).toBe(1)
  })

  it('ignora los módulos sin schedule', async () => {
    const reactive: TntModule = { ...fakeModule, name: 'reactivo', schedule: undefined }
    const n = await ensureScheduledJobs(sql, [reactive], STORE,
      { ...cfg, modules: { reactivo: { enabled: true, mode: 'auto' } } }, new Date())
    expect(n).toBe(0)
  })

  it('ignora los módulos deshabilitados en la config', async () => {
    const n = await ensureScheduledJobs(sql, [fakeModule], STORE,
      { ...cfg, modules: { fake: { enabled: false, mode: 'auto' } } }, new Date())
    expect(n).toBe(0)
  })
})
