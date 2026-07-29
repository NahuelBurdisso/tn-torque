import type { Db } from '@tnt/db'
import { seal, open } from '../crypto/secret-box.ts'
import type { StoreConfig } from '../config/store-config.ts'
import { cancelByKey } from '../queue/queue.ts'

export interface StoreRow {
  id: number
  slug: string
  name: string
  timezone: string
  instance: string
  state: 'active' | 'needs_reauth' | 'inactive'
  access_token_sealed: string | null
  scope: string | null
  backfilled_at: Date | null
}

export async function upsertStore(
  sql: Db,
  cfg: StoreConfig,
  creds: { accessToken: string; scope: string } | null,
  key: Buffer,
): Promise<void> {
  const sealed = creds ? seal(creds.accessToken, key) : null
  await sql`
    INSERT INTO stores (id, slug, name, timezone, instance, access_token_sealed, scope)
    VALUES (${cfg.tiendanube.store_id}, ${cfg.store.slug}, ${cfg.store.name},
            ${cfg.store.timezone}, ${cfg.store.instance}, ${sealed}, ${creds?.scope ?? null})
    ON CONFLICT (id) DO UPDATE SET
      slug     = EXCLUDED.slug,
      name     = EXCLUDED.name,
      timezone = EXCLUDED.timezone,
      instance = EXCLUDED.instance,
      state    = CASE WHEN EXCLUDED.access_token_sealed IS NOT NULL
                      THEN 'active' ELSE stores.state END,
      access_token_sealed = COALESCE(EXCLUDED.access_token_sealed, stores.access_token_sealed),
      scope    = COALESCE(EXCLUDED.scope, stores.scope),
      updated_at = now()`
}

// postgres.js devuelve los bigint como string para no perder precisión.
// Se normalizan acá para que el tipo StoreRow no mienta.
const toRow = (r: Record<string, unknown>): StoreRow => ({ ...r, id: Number(r.id) } as StoreRow)

export async function getStore(sql: Db, slug: string): Promise<StoreRow | undefined> {
  const [row] = await sql`SELECT * FROM stores WHERE slug = ${slug}`
  return row ? toRow(row) : undefined
}

export async function listStores(sql: Db): Promise<StoreRow[]> {
  const rows = await sql`SELECT * FROM stores ORDER BY slug`
  return rows.map(toRow)
}

export async function storeToken(sql: Db, slug: string, key: Buffer): Promise<string> {
  const row = await getStore(sql, slug)
  if (!row) throw new Error(`la tienda "${slug}" no está dada de alta — corré: tnt store add ${slug}`)
  if (!row.access_token_sealed) throw new Error(`la tienda "${slug}" no tiene token — corré: tnt store add ${slug} --code <code>`)
  return open(row.access_token_sealed, key)
}

/**
 * Un 401 significa token revocado. Además de frenar los syncs hay que matar
 * los trabajos pendientes: un digest agendado sobre una tienda muerta mandaría
 * datos viejos sin ninguna señal de que lo son.
 */
export async function markNeedsReauth(sql: Db, storeId: number, slug: string): Promise<void> {
  await sql`UPDATE stores SET state = 'needs_reauth', updated_at = now() WHERE id = ${storeId}`
  await cancelByKey(sql, `store:${slug}`)
}

export async function markBackfilled(sql: Db, storeId: number): Promise<void> {
  await sql`UPDATE stores SET backfilled_at = now(), updated_at = now() WHERE id = ${storeId}`
}
