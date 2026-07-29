import type { Db, Queryable } from '@tnt/db'

export type SyncMode = 'backfill' | 'incremental' | 'reconcile'

export interface SyncStats {
  rowsSeen: number
  rowsChanged: number
  eventsEmitted: number
}

export { stageVariants, stageProducts, type RawVariant, type RawProduct } from './stage.ts'

export async function startRun(sql: Db, storeId: number, resource: string, mode: SyncMode): Promise<number> {
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO sync_runs (store_id, resource, mode) VALUES (${storeId}, ${resource}, ${mode})
    RETURNING id`
  return Number(row!.id)
}

export async function finishRun(
  sql: Db, runId: number, stats: SyncStats,
  error?: string, checkoutsSeen?: number,
): Promise<void> {
  await sql`
    UPDATE sync_runs SET
      finished_at    = now(),
      rows_seen      = ${stats.rowsSeen},
      rows_changed   = ${stats.rowsChanged},
      events_emitted = ${stats.eventsEmitted},
      error          = ${error ?? null},
      checkouts_seen = ${checkoutsSeen ?? null}
    WHERE id = ${runId}`
}

/**
 * Diff contra el espejo → snapshots de lo cambiado → eventos → upsert →
 * limpieza del staging.
 *
 * Corre sobre el `tx` que recibe: quien llama es responsable de la
 * transacción y del pg_advisory_xact_lock(storeId) que serializa applies
 * concurrentes de la MISMA tienda (ver run-sync.ts). Sin ese lock, dos syncs
 * solapados (cron que se pisa con una corrida manual, por ejemplo) pueden
 * leer el mismo estado viejo del espejo bajo READ COMMITTED y las dos
 * insertan su propio snapshot -> dos dedupe_key distintas -> dos eventos
 * para una sola transición real.
 *
 * Al ser basado en conjuntos, 20.000 SKUs cuestan lo mismo que 400.
 *
 * En modo backfill escribe la baseline de snapshots pero NO emite eventos:
 * sin eso, la primera sincronización de una tienda real dispara cientos de
 * avisos de golpe.
 */
export async function applyVariants(
  tx: Queryable, runId: number, storeId: number, mode: SyncMode,
): Promise<SyncStats> {
  const emitEvents = mode !== 'backfill'

  const [row] = await tx<{ rows_seen: string; rows_changed: string; events_emitted: string }[]>`
    WITH changed AS MATERIALIZED (
      SELECT s.id, s.store_id, s.product_id, s.stock,
             v.stock       AS old_stock,
             v.price       AS old_price,
             v.promo_price AS old_promo,
             (v.id IS NULL) AS is_new
      FROM stage_variants s
      LEFT JOIN variants v ON v.store_id = s.store_id AND v.id = s.id
      WHERE s.run_id = ${runId}
        AND (v.id IS NULL
             OR v.stock       IS DISTINCT FROM s.stock
             OR v.price       IS DISTINCT FROM tnt_num(s.raw->>'price')
             OR v.promo_price IS DISTINCT FROM tnt_num(s.raw->>'promotional_price'))
    ),
    snapped AS (
      INSERT INTO variant_snapshots (store_id, variant_id, price, promo_price, stock)
      SELECT c.store_id, c.id,
             tnt_num(s.raw->>'price'),
             tnt_num(s.raw->>'promotional_price'),
             c.stock
      FROM changed c
      JOIN stage_variants s ON s.run_id = ${runId} AND s.store_id = c.store_id AND s.id = c.id
      RETURNING id, store_id, variant_id
    ),
    emitted AS (
      INSERT INTO events (store_id, type, entity_type, entity_id, payload, dedupe_key)
      SELECT c.store_id, 'variant.back_in_stock', 'variant', c.id,
             jsonb_build_object('product_id', c.product_id,
                                'old_stock',  c.old_stock,
                                'new_stock',  c.stock),
             format('%s:variant.back_in_stock:%s:%s', c.store_id, c.id, sn.id)
      FROM changed c
      JOIN snapped sn ON sn.store_id = c.store_id AND sn.variant_id = c.id
      WHERE ${emitEvents}::boolean
        -- is_new excluye la variante que aparece por primera vez ya con stock:
        -- eso no es "volvió", es "existe".
        AND NOT c.is_new
        AND c.old_stock IS NOT NULL
        AND c.old_stock <= 0
        -- stock NULL en TN = sin control de stock = disponible.
        AND (c.stock IS NULL OR c.stock > 0)
      ON CONFLICT (dedupe_key) DO NOTHING
      RETURNING id
    ),
    upserted AS (
      INSERT INTO variants (store_id, id, product_id, raw, stock, tn_updated_at, synced_at)
      SELECT store_id, id, product_id, raw, stock, tn_updated_at, now()
      FROM stage_variants WHERE run_id = ${runId}
      ON CONFLICT (store_id, id) DO UPDATE SET
        raw           = EXCLUDED.raw,
        product_id    = EXCLUDED.product_id,
        stock         = EXCLUDED.stock,
        tn_updated_at = EXCLUDED.tn_updated_at,
        synced_at     = now(),
        deleted_at    = NULL
      RETURNING 1
    )
    SELECT
      (SELECT count(*) FROM stage_variants WHERE run_id = ${runId}) AS rows_seen,
      (SELECT count(*) FROM changed)                                AS rows_changed,
      (SELECT count(*) FROM emitted)                                AS events_emitted`

  await tx`DELETE FROM stage_variants WHERE run_id = ${runId}`

  return {
    rowsSeen: Number(row!.rows_seen),
    rowsChanged: Number(row!.rows_changed),
    eventsEmitted: Number(row!.events_emitted),
  }
}

export async function applyProducts(sql: Queryable, runId: number, storeId: number): Promise<number> {
  const [row] = await sql<{ n: string }[]>`
    WITH upserted AS (
      INSERT INTO products (store_id, id, raw, tn_updated_at, synced_at)
      SELECT store_id, id, raw, tn_updated_at, now()
      FROM stage_products WHERE run_id = ${runId}
      ON CONFLICT (store_id, id) DO UPDATE SET
        raw           = EXCLUDED.raw,
        tn_updated_at = EXCLUDED.tn_updated_at,
        synced_at     = now(),
        deleted_at    = NULL
      RETURNING 1
    )
    SELECT count(*) AS n FROM upserted`
  await sql`DELETE FROM stage_products WHERE run_id = ${runId}`
  return Number(row!.n)
}
