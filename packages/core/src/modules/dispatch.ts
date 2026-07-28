import type { Db } from '@tnt/db'
import type { TntModule, TntEvent, ModuleContext } from './types.ts'
import { enqueue, cancelByKey } from '../queue/queue.ts'

const BATCH = 500

interface EventRow {
  id: string
  store_id: string
  type: string
  entity_type: string
  entity_id: string
  payload: Record<string, unknown>
  occurred_at: Date
}

export interface DispatchResult {
  dispatched: number
  failed: number
}

/**
 * Bus: por cada módulo, toma los eventos que todavía no le fueron entregados,
 * corre su handle() puro, encola lo que devuelva y marca la entrega.
 *
 * Un evento que revienta (handle() tira, o la transacción de abajo falla)
 * queda en `event_deliveries` como `failed` con el error y NO frena a los
 * que siguen — un `JobSpec` mal formado en un evento no puede bloquear en
 * silencio todo lo que viene detrás para la misma tienda. `failed` no se
 * vuelve a recoger solo: la consulta de arriba filtra por `d.event_id IS
 * NULL`, así que una vez que hay fila, sea `delivered`, `skipped` o
 * `failed`, ese evento no vuelve a aparecer. Es deliberado — ver el mismo
 * criterio en `fail()` de la cola (queue.ts): agotar reintentos automáticos
 * y quedar quieto hasta que alguien mire es más seguro que reintentar para
 * siempre un handle() con un bug real, que solo va a volver a fallar.
 */
export async function dispatch(
  sql: Db, modules: readonly TntModule[], storeId: number, ctx: ModuleContext,
): Promise<DispatchResult> {
  let dispatched = 0
  let failed = 0

  for (const mod of modules) {
    if (!isModuleEnabled(ctx, mod.name)) continue

    const locked = (mod.requires ?? []).filter(flag => !isUnlocked(ctx, flag))
    if (locked.length) continue

    const rows = await sql<EventRow[]>`
      SELECT e.* FROM events e
      LEFT JOIN event_deliveries d ON d.event_id = e.id AND d.module = ${mod.name}
      WHERE e.store_id = ${storeId}
        AND e.type = ANY(${mod.subscribes})
        AND d.event_id IS NULL
      ORDER BY e.id
      LIMIT ${BATCH}`

    for (const row of rows) {
      const event: TntEvent = {
        id: Number(row.id),
        storeId: Number(row.store_id),
        type: row.type,
        entityType: row.entity_type,
        entityId: Number(row.entity_id),
        payload: row.payload,
        occurredAt: row.occurred_at,
      }

      try {
        const { enqueue: specs, cancel } = mod.handle(event, ctx)

        // Cancelar, encolar y marcar la entrega van en UNA transacción: si el
        // proceso muere a mitad de camino no puede quedar una secuencia vieja
        // muerta sin la nueva creada, ni una entrega marcada sin que sus
        // efectos hayan corrido (event_deliveries es el puntero de este
        // módulo — una vez marcado, ese evento no se vuelve a mirar).
        // Cancelar ANTES de encolar: un módulo puede cancelar y re-encolar bajo
        // la misma cancel_key en la misma llamada, y el trabajo nuevo tiene que
        // sobrevivir en vez de ser víctima de la cancelación pensada para el viejo.
        await sql.begin(async tx => {
          for (const key of cancel ?? []) await cancelByKey(tx, key)
          for (const spec of specs) await enqueue(tx, spec)
          await tx`
            INSERT INTO event_deliveries (event_id, module, status)
            VALUES (${event.id}, ${mod.name}, 'delivered')
            ON CONFLICT (event_id, module) DO UPDATE SET status = 'delivered', updated_at = now()`
        })
        dispatched++
      } catch (err) {
        failed++
        // A propósito FUERA de la transacción de arriba: si el intento de
        // encolar falló y ese `sql.begin` hizo rollback, cualquier escritura
        // que hubiera hecho DENTRO de la misma transacción se habría ido con
        // él, y este evento quedaría sin fila en event_deliveries — es decir
        // que el próximo dispatch() lo volvería a levantar como si nada
        // hubiera pasado. Esta escritura corre en su propia transacción
        // implícita sobre `sql`, después de que la de arriba ya terminó
        // (con éxito o no), para que el registro del fallo sobreviva aunque
        // el intento que lo causó se haya deshecho.
        await sql`
          INSERT INTO event_deliveries (event_id, module, status, attempts, last_error)
          VALUES (${event.id}, ${mod.name}, 'failed', 1, ${String(err)})
          ON CONFLICT (event_id, module) DO UPDATE SET
            status = 'failed', attempts = event_deliveries.attempts + 1,
            last_error = ${String(err)}, updated_at = now()`
      }
    }
  }

  return { dispatched, failed }
}

/**
 * Marca todos los eventos existentes como entregados para un módulo.
 * Es cómo se activa un módulo meses después sin reprocesar el historial.
 */
export async function markAllDelivered(sql: Db, storeId: number, module: string): Promise<number> {
  const rows = await sql`
    INSERT INTO event_deliveries (event_id, module, status)
    SELECT id, ${module}, 'skipped' FROM events WHERE store_id = ${storeId}
    ON CONFLICT (event_id, module) DO NOTHING
    RETURNING event_id`
  return rows.length
}

function isUnlocked(ctx: ModuleContext, flag: string): boolean {
  return (ctx.store.sending as Record<string, unknown>)[flag] === true
}

/**
 * Un módulo corre solo si la tienda lo prendió a mano en su [modules].
 * Ausente o `enabled = false` (el default del schema) es lo mismo que "no":
 * config que no dice nada, no arranca nada — mismo criterio que
 * dns_verified y el resto de los defaults que fallan cerrado.
 */
function isModuleEnabled(ctx: ModuleContext, name: string): boolean {
  return ctx.store.modules[name]?.enabled === true
}
