import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ntfyModule } from './index.ts'
import type { TntEvent, ModuleContext } from '../types.ts'

const ctx: ModuleContext = {
  store: {
    store: { slug: 'demo', name: 'Demo', timezone: 'UTC', instance: 'torque-pc' },
    tiendanube: { store_id: 1 },
    sending: { dns_verified: false, daily_budget: 50 },
    modules: {},
    brand: {},
  },
  now: () => new Date('2026-07-28T12:00:00Z'),
}

const event: TntEvent = {
  id: 500,
  storeId: 1,
  type: 'variant.back_in_stock',
  entityType: 'variant',
  entityId: 98765,
  payload: { product_id: 10, old_stock: 0, new_stock: 3 },
  occurredAt: new Date('2026-07-28T12:00:00Z'),
}

describe('ntfyModule.handle', () => {
  it('es puro: devuelve un trabajo sin tocar la red', () => {
    const jobs = ntfyModule.handle(event, ctx)
    expect(jobs).toHaveLength(1)
    expect(jobs[0]!.module).toBe('ntfy')
    expect(jobs[0]!.dedupeKey).toBe('ntfy:1:500')
    expect(jobs[0]!.cancelKey).toBe('store:demo')
    expect(String(jobs[0]!.payload?.message)).toContain('98765')
  })

  it('programa el trabajo para ahora', () => {
    expect(ntfyModule.handle(event, ctx)[0]!.runAt).toEqual(new Date('2026-07-28T12:00:00Z'))
  })

  it('ignora eventos que no escucha', () => {
    expect(ntfyModule.handle({ ...event, type: 'order.paid' }, ctx)).toEqual([])
  })
})

describe('ntfyModule.execute', () => {
  // Estos tests pisan TNT_NTFY_URL y TNT_NTFY_TOPIC a propósito. Con
  // singleFork:true todos los archivos de test comparten un solo proceso,
  // así que si no se restauran acá, el valor pisado se filtra a los tests
  // que corran después en el mismo `vitest run` (nos mordió en la Tarea 6).
  let origUrl: string | undefined
  let origTopic: string | undefined

  beforeEach(() => {
    origUrl = process.env.TNT_NTFY_URL
    origTopic = process.env.TNT_NTFY_TOPIC
  })

  afterEach(() => {
    if (origUrl === undefined) delete process.env.TNT_NTFY_URL
    else process.env.TNT_NTFY_URL = origUrl

    if (origTopic === undefined) delete process.env.TNT_NTFY_TOPIC
    else process.env.TNT_NTFY_TOPIC = origTopic
  })

  it('postea al topic de ntfy', async () => {
    process.env.TNT_NTFY_URL = 'https://ntfy.sh'
    process.env.TNT_NTFY_TOPIC = 'tnt-test'
    const f = vi.fn().mockResolvedValue(new Response('', { status: 200 }))
    await ntfyModule.execute(
      { id: 1, store_id: 1, module: 'ntfy', kind: 'notify', state: 'running', attempts: 1,
        cancel_key: null, payload: { title: 'T', message: 'M' } },
      { ...ctx, fetchImpl: f as unknown as typeof fetch })
    expect(f).toHaveBeenCalledWith('https://ntfy.sh/tnt-test', expect.objectContaining({ method: 'POST', body: 'M' }))
  })

  it('lanza si ntfy devuelve error, para que la cola reintente', async () => {
    process.env.TNT_NTFY_TOPIC = 'tnt-test'
    const f = vi.fn().mockResolvedValue(new Response('nope', { status: 500 }))
    await expect(ntfyModule.execute(
      { id: 1, store_id: 1, module: 'ntfy', kind: 'notify', state: 'running', attempts: 1,
        cancel_key: null, payload: { title: 'T', message: 'M' } },
      { ...ctx, fetchImpl: f as unknown as typeof fetch })).rejects.toThrow(/500/)
  })
})
