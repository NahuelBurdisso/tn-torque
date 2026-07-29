import type { TntModule } from '../types.ts'
import { nextLocalTimeAmong } from '../../time/zoned.ts'
import { cartsForDigest } from './query.ts'
import { buildDigest } from './message.ts'

/** Las dos corridas del día. La ventana DEBE ser el intervalo entre ellas. */
const RUN_TIMES = ['09:00', '18:00']
const WINDOW_HOURS = 12

export const digestModule: TntModule = {
  name: 'digest',
  // Agendado, no reactivo: dispatch() lo saltea y handle() no se llama nunca.
  subscribes: [],

  schedule: {
    nextRunAt: (now, timezone) => nextLocalTimeAmong(now, timezone, RUN_TIMES),
    dedupe: (slug, runAt) => `digest:${slug}:${runAt.toISOString()}`,
  },

  handle: () => ({ enqueue: [] }),

  async execute(job, ctx) {
    const now = ctx.now()
    const carts = await cartsForDigest(ctx.sql, job.store_id, now, WINDOW_HOURS)
    const message = buildDigest({ storeName: ctx.store.store.name, carts, now })
    if (!message) return   // digest vacío: no se manda nada

    const base = process.env.TNT_NTFY_URL ?? 'https://ntfy.sh'
    const topic = (ctx.store.modules.digest?.topic as string | undefined)
      ?? process.env.TNT_NTFY_TOPIC
    if (!topic) throw new Error('sin topic de ntfy para el digest')

    const res = await (ctx.fetchImpl ?? fetch)(`${base}/${topic}`, {
      method: 'POST',
      headers: { Title: message.title, Priority: 'default' },
      body: message.body,
    })
    if (!res.ok) throw new Error(`ntfy respondió ${res.status}: ${(await res.text()).slice(0, 120)}`)
  },
}
