import type { Queryable } from '@tnt/db'
import type { SyncMode } from './apply.ts'

// Una caída se considera sospechosa solo si es grande en proporción Y en
// cantidad. La proporción sola no alcanza: en un espejo chico (dos
// checkouts), una conversión ordinaria ya es una caída del 50%. Lo que de
// verdad delata una respuesta truncada de la API es que falte una página
// entera de una — muchos checkouts a la vez, no uno o dos.
/** Proporción del espejo vivo que tiene que faltar para ser sospechosa. */
const SUSPICIOUS_RATIO = 0.4
/** Piso absoluto: por debajo de esto, nunca es una respuesta truncada. */
const SUSPICIOUS_FLOOR = 3

export interface CheckoutStats {
  rowsSeen: number
  eventsEmitted: number
  /** false = el reconcile se abstuvo por una caída sospechosa sin confirmar. */
  reconciled: boolean
}

/**
 * Decide si conviene reconciliar. Una respuesta truncada de la API marcaría
 * como convertidos a checkouts vivos; pero abstenerse siempre ante una caída
 * grande dejaría el espejo congelado para siempre cuando la caída es real
 * (una liquidación). Se distingue por persistencia: dos corridas seguidas con
 * el mismo conteo bajo no son un error de red.
 */
async function shouldReconcile(
  tx: Queryable, runId: number, storeId: number,
): Promise<boolean> {
  const [counts] = await tx<{ live: number; staged: number }[]>`
    SELECT
      (SELECT count(*)::int FROM checkouts WHERE store_id = ${storeId} AND gone_at IS NULL) AS live,
      (SELECT count(*)::int FROM stage_checkouts WHERE run_id = ${runId}) AS staged`
  const { live, staged } = counts!
  // "Sospechosa" mide sobre lo que desapareció, no sobre lo que quedó.
  const dropped = live - staged
  const suspicious = dropped >= SUSPICIOUS_FLOOR && dropped >= live * SUSPICIOUS_RATIO
  if (live === 0 || !suspicious) return true

  const [prev] = await tx<{ checkouts_seen: number | null }[]>`
    SELECT checkouts_seen FROM sync_runs
    WHERE store_id = ${storeId} AND checkouts_seen IS NOT NULL AND finished_at IS NOT NULL
    ORDER BY id DESC LIMIT 1`
  return prev?.checkouts_seen === staged
}

export async function applyCheckouts(
  tx: Queryable, runId: number, storeId: number, mode: SyncMode,
): Promise<CheckoutStats> {
  const emitEvents = mode !== 'backfill'
  const reconciled = await shouldReconcile(tx, runId, storeId)

  const [row] = await tx<{ rows_seen: string; events_emitted: string }[]>`
    WITH upserted AS (
      INSERT INTO checkouts (store_id, id, token, raw, tn_created_at, tn_updated_at, synced_at, gone_at)
      SELECT store_id, id, token, raw, tn_created_at, tn_updated_at, now(), NULL
      FROM stage_checkouts WHERE run_id = ${runId}
      ON CONFLICT (store_id, id) DO UPDATE SET
        token         = EXCLUDED.token,
        raw           = EXCLUDED.raw,
        tn_created_at = EXCLUDED.tn_created_at,
        tn_updated_at = EXCLUDED.tn_updated_at,
        synced_at     = now(),
        gone_at       = NULL          -- reapareció: el falso positivo se auto-cura
      RETURNING 1
    ),
    -- El WHERE por store_id no es opcional: sin él, cada sync marcaría como
    -- convertidos los checkouts de todas las demás tiendas.
    reconciled AS (
      UPDATE checkouts c SET gone_at = now()
      WHERE c.store_id = ${storeId}
        AND c.gone_at IS NULL
        AND ${reconciled}::boolean
        AND NOT EXISTS (
          SELECT 1 FROM stage_checkouts s
          WHERE s.run_id = ${runId} AND s.store_id = c.store_id AND s.id = c.id)
      RETURNING 1
    ),
    emitted AS (
      INSERT INTO events (store_id, type, entity_type, entity_id, payload, dedupe_key)
      SELECT s.store_id, 'checkout.abandoned', 'checkout', s.id,
             jsonb_build_object('token', s.token, 'total', tnt_num(s.raw->>'total')),
             format('%s:checkout.abandoned:%s', s.store_id, s.id)
      FROM stage_checkouts s
      JOIN stores st ON st.id = s.store_id
      WHERE s.run_id = ${runId}
        AND ${emitEvents}::boolean
        -- La edad va por la última actividad, no por la creación: quien armó el
        -- carrito hace tres días pero estuvo activo hace diez minutos no lo abandonó.
        AND s.tn_updated_at < now() - interval '60 minutes'
        -- Guardia de arranque en frío para eventos POR RELOJ. El de diff no sirve
        -- acá: este evento no necesita una transición, solo edad, así que sin este
        -- guardia el segundo sync emitiría por todo el backlog de golpe.
        AND st.backfilled_at IS NOT NULL
        AND s.tn_created_at > st.backfilled_at
      ON CONFLICT (dedupe_key) DO NOTHING
      RETURNING id
    )
    SELECT
      (SELECT count(*) FROM stage_checkouts WHERE run_id = ${runId}) AS rows_seen,
      (SELECT count(*) FROM emitted)                                 AS events_emitted`

  await tx`DELETE FROM stage_checkouts WHERE run_id = ${runId}`

  return {
    rowsSeen: Number(row!.rows_seen),
    eventsEmitted: Number(row!.events_emitted),
    reconciled,
  }
}
