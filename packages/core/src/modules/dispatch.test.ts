import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { connect, migrate } from '@tnt/db'
import { dispatch, markAllDelivered } from './dispatch.ts'
import { ntfyModule } from './ntfy/index.ts'
import type { ModuleContext } from './types.ts'

const sql = connect(process.env.TNT_TEST_DATABASE_URL!)
const STORE = 1

const ctx: ModuleContext = {
  store: {
    store: { slug: 'demo', name: 'Demo', timezone: 'UTC', instance: 'torque-pc' },
    tiendanube: { store_id: STORE },
    sending: { dns_verified: false, daily_budget: 50 },
    modules: { ntfy: { enabled: true, mode: 'auto' } },
    brand: {},
  },
  now: () => new Date(),
}

beforeEach(async () => {
  await migrate(sql)
  await sql`TRUNCATE stores CASCADE`
  await sql`INSERT INTO stores (id, slug, name, timezone, instance)
            VALUES (${STORE}, 'demo', 'Demo', 'UTC', 'torque-pc')`
})
afterAll(async () => { await sql.end() })

async function seedEvent(n: number) {
  await sql`INSERT INTO events (store_id, type, entity_type, entity_id, payload, dedupe_key)
            VALUES (${STORE}, 'variant.back_in_stock', 'variant', ${n},
                    ${sql.json({ product_id: 10, old_stock: 0, new_stock: 2 })}, ${`k${n}`})`
}

describe('dispatch', () => {
  it('convierte eventos no entregados en trabajos', async () => {
    await seedEvent(1); await seedEvent(2)
    const n = await dispatch(sql, [ntfyModule], STORE, ctx)
    expect(n).toBe(2)
    const [row] = await sql<{ count: number }[]>`SELECT count(*)::int AS count FROM jobs WHERE module = 'ntfy'`
    expect(row!.count).toBe(2)
  })

  it('no vuelve a despachar lo ya entregado', async () => {
    await seedEvent(1)
    await dispatch(sql, [ntfyModule], STORE, ctx)
    expect(await dispatch(sql, [ntfyModule], STORE, ctx)).toBe(0)
  })

  it('markAllDelivered deja un módulo nuevo arrancando limpio', async () => {
    await seedEvent(1); await seedEvent(2)
    await markAllDelivered(sql, STORE, 'ntfy')
    expect(await dispatch(sql, [ntfyModule], STORE, ctx)).toBe(0)
    const [row] = await sql<{ count: number }[]>`SELECT count(*)::int AS count FROM jobs`
    expect(row!.count).toBe(0)
  })

  it('ignora eventos de tipos que el módulo no escucha', async () => {
    await sql`INSERT INTO events (store_id, type, entity_type, entity_id, dedupe_key)
              VALUES (${STORE}, 'order.paid', 'order', 1, 'op1')`
    expect(await dispatch(sql, [ntfyModule], STORE, ctx)).toBe(0)
  })

  it('no despacha un módulo que la tienda tiene enabled = false', async () => {
    await seedEvent(1)
    const disabled: ModuleContext = {
      ...ctx,
      store: { ...ctx.store, modules: { ntfy: { enabled: false, mode: 'auto' } } },
    }
    expect(await dispatch(sql, [ntfyModule], STORE, disabled)).toBe(0)
    const [row] = await sql<{ count: number }[]>`SELECT count(*)::int AS count FROM jobs WHERE module = 'ntfy'`
    expect(row!.count).toBe(0)
  })

  it('no despacha un módulo ausente de [modules] (default enabled = false)', async () => {
    await seedEvent(1)
    const unconfigured: ModuleContext = { ...ctx, store: { ...ctx.store, modules: {} } }
    expect(await dispatch(sql, [ntfyModule], STORE, unconfigured)).toBe(0)
  })
})
