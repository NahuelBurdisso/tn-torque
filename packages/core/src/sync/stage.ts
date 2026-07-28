import type { Db, Json } from '@tnt/db'

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
  const values = rows.map(v => ({
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
  const values = rows.map(p => ({
    run_id: runId,
    store_id: storeId,
    id: p.id,
    raw: sql.json(p as unknown as Json),
    tn_updated_at: p.updated_at ?? null,
  }))
  await sql`INSERT INTO stage_products ${sql(values, 'run_id', 'store_id', 'id', 'raw', 'tn_updated_at')}`
}
