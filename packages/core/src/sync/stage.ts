import type { Db, Json, Queryable } from '@tnt/db'

/** Forma cruda de una variante tal como la devuelve la API de TN. */
export interface RawVariant {
  id: number
  product_id: number
  stock: number | null
  updated_at?: string
  [k: string]: unknown
}

export interface RawProduct {
  id: number
  variants?: RawVariant[]
  updated_at?: string
  [k: string]: unknown
}

export async function stageVariants(
  sql: Db, runId: number, storeId: number, rows: RawVariant[],
): Promise<void> {
  if (!rows.length) return

  // TN pagina /products por número de página, no por cursor estable: si el
  // catálogo cambia mientras se pagina, una fila puede repetirse en dos
  // páginas. Sin esto, dos filas para el mismo id llegan a stage_variants y
  // el ON CONFLICT DO UPDATE del upsert en applyVariants aborta el apply
  // entero. Se deduplica acá, no en el INSERT, porque el conflicto real es
  // "misma variante vista dos veces en esta corrida" — un problema de la
  // corrida, no de la tabla. Gana la última ocurrencia: en una lista
  // paginada en orden, es la lectura más reciente del recurso.
  const deduped = [...new Map(rows.map(v => [v.id, v])).values()]

  const values = deduped.map(v => ({
    run_id: runId,
    store_id: storeId,
    id: v.id,
    product_id: v.product_id,
    // sql.json es obligatorio: en un insert multi-fila postgres.js no conoce
    // el tipo de la columna y mandaría el objeto como texto plano.
    raw: sql.json(v as unknown as Json),
    stock: v.stock ?? null,
    tn_updated_at: v.updated_at ?? null,
  }))
  await sql`INSERT INTO stage_variants ${sql(values, 'run_id', 'store_id', 'id', 'product_id', 'raw', 'stock', 'tn_updated_at')}`
}

export async function stageProducts(
  sql: Db, runId: number, storeId: number, rows: RawProduct[],
): Promise<void> {
  if (!rows.length) return

  // Mismo caso que en stageVariants, y de hecho el más probable de los dos:
  // /products es lo que TN pagina de verdad, así que un producto repetido
  // entre páginas es la causa raíz — las variantes duplicadas en
  // stageVariants son, la mayoría de las veces, un efecto derivado de esto.
  // Mismo mecanismo y mismo criterio de desempate que ahí para que las dos
  // funciones no diverjan sin motivo.
  const deduped = [...new Map(rows.map(p => [p.id, p])).values()]

  const values = deduped.map(p => ({
    run_id: runId,
    store_id: storeId,
    id: p.id,
    raw: sql.json(p as unknown as Json),
    tn_updated_at: p.updated_at ?? null,
  }))
  await sql`INSERT INTO stage_products ${sql(values, 'run_id', 'store_id', 'id', 'raw', 'tn_updated_at')}`
}

/** Forma cruda de un checkout tal como lo devuelve la API de TN. */
export interface RawCheckout {
  id: number
  token: string
  created_at?: string
  updated_at?: string
  [k: string]: unknown
}

export async function stageCheckouts(
  sql: Queryable, runId: number, storeId: number, rows: RawCheckout[],
): Promise<void> {
  if (!rows.length) return

  // Mismo criterio que stageVariants: la paginación por número de página de TN
  // puede repetir filas entre páginas, y un duplicado abortaría el upsert entero.
  const unique = [...new Map(rows.map(c => [c.id, c])).values()]

  const values = unique.map(c => ({
    run_id: runId,
    store_id: storeId,
    id: c.id,
    token: c.token,
    raw: sql.json(c as unknown as Json),
    tn_created_at: c.created_at ?? null,
    tn_updated_at: c.updated_at ?? null,
  }))
  await sql`INSERT INTO stage_checkouts ${sql(values, 'run_id', 'store_id', 'id', 'token', 'raw', 'tn_created_at', 'tn_updated_at')}`
}
