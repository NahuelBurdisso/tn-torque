import type { Db } from '@tnt/db'

export const MAX_ATTEMPTS = 5

export interface JobSpec {
  storeId: number
  module: string
  kind: string
  runAt: Date
  dedupeKey: string
  cancelKey?: string | null
  payload?: Record<string, unknown>
  batchId?: number | null
  state?: 'pending' | 'needs_approval'
}

export interface Job {
  id: number
  store_id: number
  module: string
  kind: string
  state: string
  attempts: number
  payload: Record<string, unknown>
  cancel_key: string | null
}

/** Devuelve el id, o null si la dedupe_key ya existía. */
export async function enqueue(sql: Db, spec: JobSpec): Promise<number | null> {
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO jobs (store_id, batch_id, module, kind, run_at, dedupe_key, cancel_key, payload, state)
    VALUES (${spec.storeId}, ${spec.batchId ?? null}, ${spec.module}, ${spec.kind},
            ${spec.runAt}, ${spec.dedupeKey}, ${spec.cancelKey ?? null},
            ${sql.json(spec.payload ?? {})}, ${spec.state ?? 'pending'})
    ON CONFLICT (dedupe_key) DO NOTHING
    RETURNING id`
  return row ? Number(row.id) : null
}

/**
 * Levanta hasta `limit` trabajos vencidos y los marca running EN LA MISMA
 * SENTENCIA. Si fueran dos pasos, el lock se soltaría al cerrar la
 * transacción del SELECT y el tick siguiente levantaría lo mismo otra vez.
 */
export async function tick(sql: Db, limit = 20): Promise<Job[]> {
  return sql<Job[]>`
    WITH picked AS (
      SELECT id FROM jobs
      WHERE state = 'pending' AND run_at <= now()
      ORDER BY run_at
      FOR UPDATE SKIP LOCKED
      LIMIT ${limit}
    )
    UPDATE jobs SET state = 'running', attempts = attempts + 1, updated_at = now()
    WHERE id IN (SELECT id FROM picked)
    RETURNING id, store_id, module, kind, state, attempts, payload, cancel_key`
}

export async function complete(sql: Db, id: number): Promise<void> {
  await sql`UPDATE jobs SET state = 'done', last_error = NULL, updated_at = now() WHERE id = ${id}`
}

/** Reprograma con backoff exponencial, o marca failed al agotar los intentos. */
export async function fail(sql: Db, id: number, error: string): Promise<void> {
  await sql`
    UPDATE jobs SET
      state      = CASE WHEN attempts >= ${MAX_ATTEMPTS} THEN 'failed' ELSE 'pending' END,
      run_at     = now() + (interval '1 minute' * power(2, attempts)),
      last_error = ${error},
      updated_at = now()
    WHERE id = ${id}`
}

/** Un solo hecho mata todos los trabajos pendientes que vuelve obsoletos. */
export async function cancelByKey(sql: Db, cancelKey: string): Promise<number> {
  const rows = await sql`
    UPDATE jobs SET state = 'cancelled', updated_at = now()
    WHERE cancel_key = ${cancelKey} AND state IN ('pending','needs_approval')
    RETURNING id`
  return rows.length
}

/**
 * Se llama al arrancar el worker. Un corte de luz o un reinicio de Windows
 * deja trabajos colgados en running: vuelven a pending si les quedan intentos.
 */
export async function recoverRunning(sql: Db): Promise<number> {
  const rows = await sql`
    UPDATE jobs SET
      state      = CASE WHEN attempts >= ${MAX_ATTEMPTS} THEN 'failed' ELSE 'pending' END,
      last_error = COALESCE(last_error, 'recuperado tras un reinicio abrupto'),
      updated_at = now()
    WHERE state = 'running'
    RETURNING id, state`
  return rows.filter(r => r.state === 'pending').length
}
