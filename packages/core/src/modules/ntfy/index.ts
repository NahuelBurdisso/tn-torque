import type { TntModule } from '../types.ts'
import { deliveryKey } from '../../events/keys.ts'

const SUBSCRIBES = ['variant.back_in_stock']

export const ntfyModule: TntModule = {
  name: 'ntfy',
  subscribes: SUBSCRIBES,

  handle(event, ctx) {
    if (!SUBSCRIBES.includes(event.type)) return { enqueue: [] }
    const { old_stock, new_stock, product_id } = event.payload as Record<string, unknown>
    return {
      enqueue: [{
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
      }],
    }
  },

  async execute(job, ctx) {
    // El valor por tienda en [modules].ntfy le gana a la variable de entorno:
    // con dos tiendas configuradas, cada una tiene que poder mandar sus
    // notificaciones a un topic distinto. La env queda como fallback para
    // no romper instalaciones de una sola tienda que todavía no migraron.
    const modCfg = ctx.store.modules.ntfy
    const storeTopic = typeof modCfg?.topic === 'string' ? modCfg.topic : undefined
    const storeUrl = typeof modCfg?.url === 'string' ? modCfg.url : undefined

    const base = storeUrl ?? process.env.TNT_NTFY_URL ?? 'https://ntfy.sh'
    const topic = storeTopic ?? process.env.TNT_NTFY_TOPIC
    if (!topic) {
      throw new Error(
        `no hay topic de ntfy para "${ctx.store.store.slug}": configurá modules.ntfy.topic ` +
        `en su store.toml o definí TNT_NTFY_TOPIC`)
    }

    const { title, message } = job.payload as { title: string; message: string }
    const res = await (ctx.fetchImpl ?? fetch)(`${base}/${topic}`, {
      method: 'POST',
      headers: { Title: title, Priority: 'default' },
      body: message,
    })
    if (!res.ok) throw new Error(`ntfy respondió ${res.status}: ${(await res.text()).slice(0, 120)}`)
  },
}
