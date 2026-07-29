import type { Db } from '@tnt/db'
import type { TnClient } from '../tn/client.ts'
import { TnHttpError } from '../tn/client.ts'
import { markBackfilled, markNeedsReauth } from '../stores/repo.ts'
import { startRun, finishRun, applyVariants, applyProducts, type SyncStats, type SyncMode } from './apply.ts'
import { applyCheckouts, type CheckoutStats } from './apply-checkouts.ts'
import { stageVariants, stageProducts, stageCheckouts, type RawProduct, type RawVariant, type RawCheckout } from './stage.ts'
import type { StoreConfig } from '../config/store-config.ts'
import { MODULE_REGISTRY } from '../modules/registry.ts'
import { ensureScheduledJobs } from '../modules/scheduling.ts'

export interface SyncResult extends SyncStats {
  mode: SyncMode
  checkouts: CheckoutStats
  scheduled: number
}

/**
 * Trae productos con sus variantes y checkouts, y los aplica, y asegura los
 * trabajos agendados de los módulos que corresponda.
 * El primer sync de una tienda es SIEMPRE backfill: llena la base, escribe la
 * baseline de snapshots y no emite un solo evento.
 */
export async function syncStore(
  sql: Db, client: TnClient, storeId: number, cfg: StoreConfig, now = new Date(),
): Promise<SyncResult> {
  const [store] = await sql<{ backfilled_at: Date | null }[]>`
    SELECT backfilled_at FROM stores WHERE id = ${storeId}`
  if (!store) throw new Error(`la tienda ${storeId} no está dada de alta`)

  const mode: SyncMode = store.backfilled_at ? 'incremental' : 'backfill'
  const runId = await startRun(sql, storeId, 'store', mode)

  try {
    const products = await client.listAll<RawProduct>('/products')
    const variants: RawVariant[] = products.flatMap(p =>
      (p.variants ?? []).map(v => ({ ...v, product_id: v.product_id ?? p.id })))
    const checkouts = await client.listAll<RawCheckout>('/checkouts')

    // El staging queda FUERA del lock: está acotado por run_id, no colisiona
    // entre corridas, y sostener el lock durante el fetch sería un desastre.
    await stageProducts(sql, runId, storeId, products)
    await stageVariants(sql, runId, storeId, variants)
    await stageCheckouts(sql, runId, storeId, checkouts)

    const applied = await sql.begin(async tx => {
      // Serializa toda la corrida por tienda. Antes vivía dentro de
      // applyVariants; con un segundo apply en la misma corrida ya no
      // alcanzaba, así que subió a cubrir todos los applies de la corrida.
      await tx`SELECT pg_advisory_xact_lock(${storeId})`
      await applyProducts(tx, runId, storeId)
      const v = await applyVariants(tx, runId, storeId, mode)
      const c = await applyCheckouts(tx, runId, storeId, mode)
      return { v, c }
    })

    await finishRun(sql, runId, applied.v, undefined, applied.c.rowsSeen)
    if (mode === 'backfill') await markBackfilled(sql, storeId)

    // Después del backfill, para que el primer trabajo agendado ya tenga
    // backfilled_at estampado cuando corra.
    const scheduled = await ensureScheduledJobs(sql, MODULE_REGISTRY, storeId, cfg, now)

    return { ...applied.v, mode, checkouts: applied.c, scheduled }
  } catch (err) {
    await finishRun(sql, runId, { rowsSeen: 0, rowsChanged: 0, eventsEmitted: 0 }, String(err))
    await sql`DELETE FROM stage_variants  WHERE run_id = ${runId}`
    await sql`DELETE FROM stage_products  WHERE run_id = ${runId}`
    await sql`DELETE FROM stage_checkouts WHERE run_id = ${runId}`
    if (err instanceof TnHttpError && err.isAuth) await markNeedsReauth(sql, storeId, cfg.store.slug)
    throw err
  }
}
