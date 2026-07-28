import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { connect, migrate } from '@tnt/db'
import { dispatch, markAllDelivered } from './dispatch.ts'
import { ntfyModule } from './ntfy/index.ts'
import { enqueue } from '../queue/queue.ts'
import type { ModuleContext, TntModule } from './types.ts'

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
    const result = await dispatch(sql, [ntfyModule], STORE, ctx)
    expect(result).toEqual({ dispatched: 2, failed: 0 })
    const [row] = await sql<{ count: number }[]>`SELECT count(*)::int AS count FROM jobs WHERE module = 'ntfy'`
    expect(row!.count).toBe(2)
  })

  it('no vuelve a despachar lo ya entregado', async () => {
    await seedEvent(1)
    await dispatch(sql, [ntfyModule], STORE, ctx)
    expect(await dispatch(sql, [ntfyModule], STORE, ctx)).toEqual({ dispatched: 0, failed: 0 })
  })

  it('markAllDelivered deja un módulo nuevo arrancando limpio', async () => {
    await seedEvent(1); await seedEvent(2)
    await markAllDelivered(sql, STORE, 'ntfy')
    expect(await dispatch(sql, [ntfyModule], STORE, ctx)).toEqual({ dispatched: 0, failed: 0 })
    const [row] = await sql<{ count: number }[]>`SELECT count(*)::int AS count FROM jobs`
    expect(row!.count).toBe(0)
  })

  it('ignora eventos de tipos que el módulo no escucha', async () => {
    await sql`INSERT INTO events (store_id, type, entity_type, entity_id, dedupe_key)
              VALUES (${STORE}, 'order.paid', 'order', 1, 'op1')`
    expect(await dispatch(sql, [ntfyModule], STORE, ctx)).toEqual({ dispatched: 0, failed: 0 })
  })

  it('no despacha un módulo que la tienda tiene enabled = false', async () => {
    await seedEvent(1)
    const disabled: ModuleContext = {
      ...ctx,
      store: { ...ctx.store, modules: { ntfy: { enabled: false, mode: 'auto' } } },
    }
    expect(await dispatch(sql, [ntfyModule], STORE, disabled)).toEqual({ dispatched: 0, failed: 0 })
    const [row] = await sql<{ count: number }[]>`SELECT count(*)::int AS count FROM jobs WHERE module = 'ntfy'`
    expect(row!.count).toBe(0)
  })

  it('no despacha un módulo ausente de [modules] (default enabled = false)', async () => {
    await seedEvent(1)
    const unconfigured: ModuleContext = { ...ctx, store: { ...ctx.store, modules: {} } }
    expect(await dispatch(sql, [ntfyModule], STORE, unconfigured)).toEqual({ dispatched: 0, failed: 0 })
  })
})

// A partir de acá: handle() puede devolver `cancel` además de `enqueue`.
// post-purchase modela order.paid matando el carrito y arrancando su propia
// secuencia bajo la MISMA cancel_key que acaba de matar — el caso que prueba
// que el orden (cancelar antes de encolar) no se come su propio trabajo nuevo.
const CART_CANCEL_KEY = 'mail:cart:demo:x@y.com'

const postPurchaseModule: TntModule = {
  name: 'post-purchase',
  subscribes: ['order.paid'],
  handle(event, ctx) {
    return {
      enqueue: [{
        storeId: event.storeId,
        module: 'post-purchase',
        kind: 'thank-you',
        runAt: ctx.now(),
        dedupeKey: `post-purchase:${event.storeId}:${event.entityId}`,
        cancelKey: CART_CANCEL_KEY,
      }],
      cancel: [CART_CANCEL_KEY],
    }
  },
  async execute() {},
}

// Mismo handle() que postPurchaseModule, pero el JobSpec apunta a una tienda
// que no existe: el INSERT viola la FK de jobs.store_id y tira la excepción
// que fuerza el rollback de la transacción entera.
const brokenPostPurchaseModule: TntModule = {
  name: 'broken-post-purchase',
  subscribes: ['order.paid'],
  handle(event, ctx) {
    return {
      enqueue: [{
        storeId: 999999,
        module: 'broken-post-purchase',
        kind: 'thank-you',
        runAt: ctx.now(),
        dedupeKey: `broken-post-purchase:${event.entityId}`,
      }],
      cancel: [CART_CANCEL_KEY],
    }
  },
  async execute() {},
}

async function seedCartJob(dedupeKey = 'cart-step-2') {
  await enqueue(sql, {
    storeId: STORE,
    module: 'mail',
    kind: 'cart-2',
    runAt: new Date(Date.now() - 1000),
    dedupeKey,
    cancelKey: CART_CANCEL_KEY,
  })
}

async function seedOrderPaid() {
  await sql`
    INSERT INTO events (store_id, type, entity_type, entity_id, payload, dedupe_key)
    VALUES (${STORE}, 'order.paid', 'order', 1, ${sql.json({ email: 'x@y.com' })}, 'order-paid-1')`
}

describe('dispatch — handle() con cancel', () => {
  it('cancela los trabajos pendientes que matchean la cancel_key devuelta', async () => {
    await seedCartJob()
    await seedOrderPaid()
    const cancelCtx: ModuleContext = {
      ...ctx, store: { ...ctx.store, modules: { 'post-purchase': { enabled: true, mode: 'auto' } } },
    }
    await dispatch(sql, [postPurchaseModule], STORE, cancelCtx)

    const [cart] = await sql`SELECT state FROM jobs WHERE dedupe_key = 'cart-step-2'`
    expect(cart!.state).toBe('cancelled')
  })

  it('cancela y encola en la misma llamada: el trabajo nuevo sobrevive aunque comparta cancel_key', async () => {
    await seedCartJob()
    await seedOrderPaid()
    const cancelCtx: ModuleContext = {
      ...ctx, store: { ...ctx.store, modules: { 'post-purchase': { enabled: true, mode: 'auto' } } },
    }
    await dispatch(sql, [postPurchaseModule], STORE, cancelCtx)

    const [cart] = await sql`SELECT state FROM jobs WHERE dedupe_key = 'cart-step-2'`
    expect(cart!.state).toBe('cancelled')

    const [fresh] = await sql`SELECT state, cancel_key FROM jobs WHERE dedupe_key = 'post-purchase:1:1'`
    expect(fresh!.state).toBe('pending')
    expect(fresh!.cancel_key).toBe(CART_CANCEL_KEY)
  })

  it('cancelar + encolar + marcar la entrega son atómicos: si encolar falla, no queda nada a medio aplicar', async () => {
    await seedCartJob()
    await seedOrderPaid()
    const brokenCtx: ModuleContext = {
      ...ctx, store: { ...ctx.store, modules: { 'broken-post-purchase': { enabled: true, mode: 'auto' } } },
    }

    // dispatch() ya no deja que esto reviente el loop entero (ver el describe
    // de más abajo) — pero adentro, la transacción del evento sí se deshace
    // completa: la cancelación no puede quedar aplicada si el encolado que
    // la acompañaba no llegó a existir.
    const result = await dispatch(sql, [brokenPostPurchaseModule], STORE, brokenCtx)
    expect(result).toEqual({ dispatched: 0, failed: 1 })

    // La cancelación se deshizo: el carrito sigue pendiente, no cancelado a medias.
    const [cart] = await sql`SELECT state FROM jobs WHERE dedupe_key = 'cart-step-2'`
    expect(cart!.state).toBe('pending')

    // El evento queda registrado como failed, con el error — no perdido y no
    // silenciosamente marcado delivered.
    const [delivery] = await sql<{ status: string; attempts: number; last_error: string }[]>`
      SELECT status, attempts, last_error FROM event_deliveries WHERE module = 'broken-post-purchase'`
    expect(delivery!.status).toBe('failed')
    expect(delivery!.attempts).toBe(1)
    expect(delivery!.last_error).toBeTruthy()
  })
})

// Un handle() (o la transacción que dispara) que revienta para UN evento no
// puede frenar el resto: con mail encolando secuencias de varios pasos, un
// solo evento con datos corruptos no puede bloquear en silencio todos los
// carritos de todo el mundo que vienen detrás en la misma tienda.
const flakyModule: TntModule = {
  name: 'flaky',
  subscribes: ['variant.back_in_stock'],
  handle(event, ctx) {
    if (event.entityId === 999) throw new Error('payload corrupto')
    return {
      enqueue: [{
        storeId: event.storeId,
        module: 'flaky',
        kind: 'notify',
        runAt: ctx.now(),
        dedupeKey: `flaky:${event.storeId}:${event.id}`,
      }],
    }
  },
  async execute() {},
}

describe('dispatch — aislamiento de fallas', () => {
  it('un evento que revienta no aborta el resto: los buenos se despachan y el malo queda failed', async () => {
    await seedEvent(1); await seedEvent(999); await seedEvent(2)
    const flakyCtx: ModuleContext = {
      ...ctx, store: { ...ctx.store, modules: { flaky: { enabled: true, mode: 'auto' } } },
    }

    const result = await dispatch(sql, [flakyModule], STORE, flakyCtx)
    expect(result).toEqual({ dispatched: 2, failed: 1 })

    const [row] = await sql<{ count: number }[]>`SELECT count(*)::int AS count FROM jobs WHERE module = 'flaky'`
    expect(row!.count).toBe(2)

    const good = await sql<{ status: string }[]>`
      SELECT d.status FROM event_deliveries d JOIN events e ON e.id = d.event_id
      WHERE d.module = 'flaky' AND e.entity_id IN (1, 2) ORDER BY e.entity_id`
    expect(good.map(r => r.status)).toEqual(['delivered', 'delivered'])

    const [bad] = await sql<{ status: string; attempts: number; last_error: string }[]>`
      SELECT d.status, d.attempts, d.last_error FROM event_deliveries d JOIN events e ON e.id = d.event_id
      WHERE d.module = 'flaky' AND e.entity_id = 999`
    expect(bad!.status).toBe('failed')
    expect(bad!.attempts).toBe(1)
    expect(bad!.last_error).toContain('payload corrupto')
  })
})
