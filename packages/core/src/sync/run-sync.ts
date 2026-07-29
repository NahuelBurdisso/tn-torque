import type { Db } from '@tnt/db'
import type { TnClient } from '../tn/client.ts'
import { TnHttpError } from '../tn/client.ts'
import { markBackfilled, markNeedsReauth } from '../stores/repo.ts'
import { startRun, finishRun, applyVariants, applyProducts, type SyncStats, type SyncMode } from './apply.ts'
import { stageVariants, stageProducts, type RawProduct, type RawVariant } from './stage.ts'

export interface SyncResult extends SyncStats {
  mode: SyncMode
}

/**
 * Trae productos con sus variantes y los aplica.
 * El primer sync de una tienda es SIEMPRE backfill: llena la base, escribe la
 * baseline de snapshots y no emite un solo evento.
 */
export async function syncVariants(sql: Db, client: TnClient, storeId: number): Promise<SyncResult> {
  const [store] = await sql<{ backfilled_at: Date | null }[]>`
    SELECT backfilled_at FROM stores WHERE id = ${storeId}`
  if (!store) throw new Error(`la tienda ${storeId} no está dada de alta`)

  const mode: SyncMode = store.backfilled_at ? 'incremental' : 'backfill'
  const runId = await startRun(sql, storeId, 'variants', mode)

  try {
    const products = await client.listAll<RawProduct>('/products')
    const variants: RawVariant[] = products.flatMap(p =>
      (p.variants ?? []).map(v => ({ ...v, product_id: v.product_id ?? p.id })))

    await stageProducts(sql, runId, storeId, products)
    await stageVariants(sql, runId, storeId, variants)

    const stats = await sql.begin(async tx => {
      // Serializa toda la corrida por tienda. Antes vivía dentro de
      // applyVariants; con un segundo apply en la misma corrida ya no
      // alcanzaba, así que subió a cubrir todos los applies de la corrida.
      await tx`SELECT pg_advisory_xact_lock(${storeId})`
      await applyProducts(tx, runId, storeId)
      return applyVariants(tx, runId, storeId, mode)
    })
    await finishRun(sql, runId, stats)

    if (mode === 'backfill') await markBackfilled(sql, storeId)
    return { ...stats, mode }
  } catch (err) {
    await finishRun(sql, runId, { rowsSeen: 0, rowsChanged: 0, eventsEmitted: 0 }, String(err))
    await sql`DELETE FROM stage_variants WHERE run_id = ${runId}`
    await sql`DELETE FROM stage_products WHERE run_id = ${runId}`
    if (err instanceof TnHttpError && err.isAuth) await markNeedsReauth(sql, storeId)
    throw err
  }
}
