import type { Queryable } from '@tnt/db'
import type { TntModule } from './types.ts'
import type { StoreConfig } from '../config/store-config.ts'
import { enqueue } from '../queue/queue.ts'

/**
 * Se asegura de que exista el próximo trabajo de cada módulo agendado.
 *
 * Se llama en cada sync. Es idempotente por dedupe_key, así que crear de más
 * no cuesta nada — y como la programación se rehace en cada corrida, no hay
 * cadena que romper: un trabajo que falló definitivamente no impide el
 * siguiente. Devuelve cuántos se crearon.
 */
export async function ensureScheduledJobs(
  sql: Queryable,
  modules: readonly TntModule[],
  storeId: number,
  cfg: StoreConfig,
  now: Date,
): Promise<number> {
  let created = 0
  const tz = cfg.store.timezone

  for (const mod of modules) {
    if (!mod.schedule) continue
    if (cfg.modules[mod.name]?.enabled !== true) continue

    const runAt = mod.schedule.nextRunAt(now, tz)
    const id = await enqueue(sql, {
      storeId,
      module: mod.name,
      kind: 'scheduled',
      runAt,
      dedupeKey: mod.schedule.dedupe(cfg.store.slug, runAt, tz),
      cancelKey: `store:${cfg.store.slug}`,
      payload: { run_at: runAt.toISOString(), timezone: tz },
    })
    if (id !== null) created++
  }

  return created
}
