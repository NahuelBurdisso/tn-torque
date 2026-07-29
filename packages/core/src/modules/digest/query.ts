import type { Queryable } from '@tnt/db'

export interface DigestItem {
  productName: string
  variantLabel: string | null
  quantity: number
  /** Calculado desde nuestro espejo de variants, NO desde has_stock_available. */
  inStock: boolean
}

export interface DigestCart {
  /** Teléfono normalizado, o el email si no hay teléfono. */
  personKey: string
  name: string | null
  phone: string | null
  totalArs: number
  abandonedAt: Date
  resumeUrl: string | null
  items: DigestItem[]
}

interface Row {
  checkout_id: string
  name: string | null
  phone: string | null
  email: string | null
  total: string | null
  abandoned_at: Date
  resume_url: string | null
  products: { variant_id?: number; name?: string; quantity?: number }[]
}

/** Solo dígitos: `+54 343 473-5796` y `541155550100` son la misma persona. */
export const normalizePhone = (p: string | null | undefined): string | null => {
  const digits = (p ?? '').replace(/\D/g, '')
  return digits.length >= 8 ? digits : null
}

export async function cartsForDigest(
  sql: Queryable, storeId: number, now: Date, windowHours: number,
): Promise<DigestCart[]> {
  const since = new Date(now.getTime() - windowHours * 3_600_000)

  const rows = await sql<Row[]>`
    SELECT c.id             AS checkout_id,
           c.contact_name   AS name,
           c.contact_phone  AS phone,
           c.contact_email  AS email,
           c.total,
           c.tn_updated_at  AS abandoned_at,
           c.resume_url,
           COALESCE(c.raw->'products', '[]'::jsonb) AS products
    FROM events e
    JOIN checkouts c ON c.store_id = e.store_id AND c.id = e.entity_id
    WHERE e.store_id = ${storeId}
      AND e.type = 'checkout.abandoned'
      AND e.occurred_at >= ${since}
      AND e.occurred_at <= ${now}
      AND c.gone_at IS NULL
    ORDER BY c.tn_updated_at DESC`

  return assembleCarts(sql, storeId, rows)
}

/**
 * Igual que cartsForDigest pero leyendo el espejo directo, sin pasar por
 * eventos. SOLO para el ensayo: el guardia de arranque en frío impide que una
 * tienda ya sincronizada tenga eventos por su backlog, así que un ensayo por
 * la vía de producción imprimiría vacío. Comparte la redacción, no la tubería.
 */
export async function cartsFromMirror(
  sql: Queryable, storeId: number, windowHours: number, now = new Date(),
): Promise<DigestCart[]> {
  const since = new Date(now.getTime() - windowHours * 3_600_000)
  const rows = await sql<Row[]>`
    SELECT c.id             AS checkout_id,
           c.contact_name   AS name,
           c.contact_phone  AS phone,
           c.contact_email  AS email,
           c.total,
           c.tn_updated_at  AS abandoned_at,
           c.resume_url,
           COALESCE(c.raw->'products', '[]'::jsonb) AS products
    FROM checkouts c
    WHERE c.store_id = ${storeId}
      AND c.gone_at IS NULL
      AND c.tn_updated_at >= ${since}
    ORDER BY c.tn_updated_at DESC`
  return assembleCarts(sql, storeId, rows)
}

/** El agrupado por persona compartido por cartsForDigest y cartsFromMirror. */
async function assembleCarts(sql: Queryable, storeId: number, rows: Row[]): Promise<DigestCart[]> {
  if (!rows.length) return []

  const variantIds = [...new Set(
    rows.flatMap(r => r.products.map(p => p.variant_id).filter((v): v is number => typeof v === 'number')))]

  const stock = new Map<number, boolean>()
  const labels = new Map<number, string | null>()
  if (variantIds.length) {
    const vs = await sql<{ id: string; stock: number | null; label: string | null }[]>`
      SELECT id, stock, raw->'values'->0->>'es' AS label
      FROM variants WHERE store_id = ${storeId} AND id = ANY(${variantIds})`
    for (const v of vs) {
      // stock NULL en TN = sin control de stock = disponible.
      stock.set(Number(v.id), v.stock === null || v.stock > 0)
      labels.set(Number(v.id), v.label)
    }
  }

  const byPerson = new Map<string, DigestCart>()
  for (const r of rows) {
    const key = normalizePhone(r.phone) ?? r.email
    if (!key) continue

    const items: DigestItem[] = r.products.map(p => ({
      productName: p.name ?? 'producto',
      variantLabel: typeof p.variant_id === 'number' ? labels.get(p.variant_id) ?? null : null,
      quantity: p.quantity ?? 1,
      inStock: typeof p.variant_id === 'number' ? stock.get(p.variant_id) ?? false : false,
    }))

    const existing = byPerson.get(key)
    if (existing) {
      existing.totalArs += Number(r.total ?? 0)
      existing.items.push(...items)
      if (r.abandoned_at > existing.abandonedAt) existing.abandonedAt = r.abandoned_at
    } else {
      byPerson.set(key, {
        personKey: key,
        name: r.name,
        phone: normalizePhone(r.phone),
        totalArs: Number(r.total ?? 0),
        abandonedAt: r.abandoned_at,
        resumeUrl: r.resume_url,
        items,
      })
    }
  }

  return [...byPerson.values()].sort((a, b) => b.totalArs - a.totalArs)
}
