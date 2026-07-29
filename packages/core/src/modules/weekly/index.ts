import type { TntModule } from '../types.ts'
import { nextLocalWeekday } from '../../time/zoned.ts'

const MONDAY = 1
const STALE_HOURS = 24

const money = (n: number) =>
  new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 }).format(Math.round(n)).replace(/ /g, ' ')

export function buildWeekly(o: {
  storeName: string; carts: number; totalArs: number; sinStock: number
  lastSyncAt: Date | null; now: Date
}): { title: string; body: string } {
  const stale = !o.lastSyncAt || (o.now.getTime() - o.lastSyncAt.getTime()) > STALE_HOURS * 3_600_000
  const lines = [
    o.carts
      ? `${o.carts} carritos · $${money(o.totalArs)} · ${o.sinStock} por falta de stock`
      : 'sin carritos abandonados esta semana',
    '',
    // Este dato es el que convierte "el sistema respira" en algo verificable:
    // TNT puede estar corriendo perfecto con el token vencido, y sin esto la
    // ausencia de digests sería indistinguible de una semana tranquila.
    `${stale ? '⚠ ' : ''}último sync: ${o.lastSyncAt ? o.lastSyncAt.toISOString() : 'nunca'}`,
  ]
  return { title: `${o.storeName} · resumen semanal`, body: lines.join('\n') }
}

export const weeklyModule: TntModule = {
  name: 'weekly',
  subscribes: [],

  schedule: {
    nextRunAt: (now, timezone) => nextLocalWeekday(now, timezone, MONDAY, '09:00'),
    dedupe: (slug, runAt) => `weekly:${slug}:${runAt.toISOString()}`,
  },

  handle: () => ({ enqueue: [] }),

  async execute(job, ctx) {
    const now = ctx.now()
    const since = new Date(now.getTime() - 7 * 86_400_000)

    const [agg] = await ctx.sql<{ carts: number; total: string | null; sin_stock: number }[]>`
      WITH semana AS (
        SELECT DISTINCT c.id, c.total, c.store_id, c.raw
        FROM events e
        JOIN checkouts c ON c.store_id = e.store_id AND c.id = e.entity_id
        WHERE e.store_id = ${job.store_id}
          AND e.type = 'checkout.abandoned'
          AND e.occurred_at >= ${since}
      ),
      -- Los que tienen al menos un item agotado HOY, según nuestro espejo.
      -- No según has_stock_available del checkout, que está congelado.
      faltantes AS (
        SELECT DISTINCT s.id
        FROM semana s
        CROSS JOIN LATERAL jsonb_array_elements(COALESCE(s.raw->'products', '[]'::jsonb)) p
        JOIN variants v ON v.store_id = s.store_id
                       AND v.id = (p->>'variant_id')::bigint
        WHERE p->>'variant_id' ~ '^[0-9]+$'
          AND v.stock IS NOT NULL
          AND v.stock <= 0
      )
      SELECT (SELECT count(*)::int              FROM semana)    AS carts,
             (SELECT COALESCE(sum(total), 0)    FROM semana)    AS total,
             (SELECT count(*)::int              FROM faltantes) AS sin_stock`

    const [sync] = await ctx.sql<{ finished_at: Date | null }[]>`
      SELECT finished_at FROM sync_runs
      WHERE store_id = ${job.store_id} AND error IS NULL AND finished_at IS NOT NULL
      ORDER BY id DESC LIMIT 1`

    const message = buildWeekly({
      storeName: ctx.store.store.name,
      carts: agg?.carts ?? 0,
      totalArs: Number(agg?.total ?? 0),
      sinStock: agg?.sin_stock ?? 0,
      lastSyncAt: sync?.finished_at ?? null,
      now,
    })

    const base = process.env.TNT_NTFY_URL ?? 'https://ntfy.sh'
    const topic = (ctx.store.modules.weekly?.topic as string | undefined) ?? process.env.TNT_NTFY_TOPIC
    if (!topic) throw new Error('sin topic de ntfy para el resumen semanal')

    const res = await (ctx.fetchImpl ?? fetch)(`${base}/${topic}`, {
      method: 'POST',
      headers: { Title: message.title, Priority: 'low' },
      body: message.body,
    })
    if (!res.ok) throw new Error(`ntfy respondió ${res.status}`)
  },
}
