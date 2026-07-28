import type { TntModule } from '../types.ts'
import { deliveryKey } from '../../events/keys.ts'

const SUBSCRIBES = ['variant.back_in_stock']

export const ntfyModule: TntModule = {
  name: 'ntfy',
  subscribes: SUBSCRIBES,

  handle(event, ctx) {
    if (!SUBSCRIBES.includes(event.type)) return []
    const { old_stock, new_stock, product_id } = event.payload as Record<string, unknown>
    return [{
      storeId: event.storeId,
      module: 'ntfy',
      kind: 'notify',
      runAt: ctx.now(),
      dedupeKey: deliveryKey('ntfy', event.storeId, event.id),
      cancelKey: `store:${ctx.store.store.slug}`,
      payload: {
        title: `${ctx.store.store.name}: volvió el stock`,
        message: `Variante ${event.entityId} (producto ${product_id}) pasó de ${old_stock} a ${new_stock}`,
      },
    }]
  },

  async execute(job, ctx) {
    const base = process.env.TNT_NTFY_URL ?? 'https://ntfy.sh'
    const topic = process.env.TNT_NTFY_TOPIC
    if (!topic) throw new Error('TNT_NTFY_TOPIC no está definida')

    const { title, message } = job.payload as { title: string; message: string }
    const res = await (ctx.fetchImpl ?? fetch)(`${base}/${topic}`, {
      method: 'POST',
      headers: { Title: title, Priority: 'default' },
      body: message,
    })
    if (!res.ok) throw new Error(`ntfy respondió ${res.status}: ${(await res.text()).slice(0, 120)}`)
  },
}
