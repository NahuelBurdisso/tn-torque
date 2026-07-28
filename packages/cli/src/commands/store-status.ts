import { db } from '@tnt/db'
import { getStore, listStores } from '@tnt/core'

export async function storeStatus(slug: string | undefined, opts: { json?: boolean }) {
  const sql = db()
  const rows = slug ? [await getStore(sql, slug)].filter(Boolean) : await listStores(sql)
  const out = rows.map(r => ({
    slug: r!.slug,
    store_id: r!.id,
    state: r!.state,
    has_token: Boolean(r!.access_token_sealed),
    backfilled_at: r!.backfilled_at,
  }))
  console.log(opts.json ? JSON.stringify(out) : out.map(fmt).join('\n') || 'sin tiendas dadas de alta')
  await sql.end()
}

const fmt = (r: { slug: string; store_id: number; state: string; has_token: boolean; backfilled_at: Date | null }) =>
  `${r.state === 'active' ? '●' : '○'} ${r.slug.padEnd(16)} store=${r.store_id}  ${r.state}  ` +
  `token=${r.has_token ? 'sí' : 'NO'}  backfill=${r.backfilled_at ? 'sí' : 'NO'}`
