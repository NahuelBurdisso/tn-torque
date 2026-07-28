import { db, migrate } from '@tnt/db'
import { loadStoreConfig, keyFromEnv, authorizeUrl, exchangeCode, upsertStore, getStore } from '@tnt/core'

export async function storeAdd(slug: string, opts: { code?: string; json?: boolean }) {
  const cfg = await loadStoreConfig(slug)
  const appId = requireEnv('TNT_APP_ID')
  const sql = db()
  await migrate(sql)

  if (!opts.code) {
    const url = authorizeUrl(appId)
    if (opts.json) console.log(JSON.stringify({ slug, authorize_url: url }))
    else {
      console.log(`\nMandale este link a la dueña de "${cfg.store.name}":\n\n  ${url}\n`)
      console.log(`Cuando autorice, la va a redirigir a una URL con ?code=XXXX. Después corré:\n`)
      console.log(`  tnt store add ${slug} --code XXXX\n`)
      console.log(`El code es de UN SOLO USO y vence rápido.\n`)
    }
    await sql.end()
    return
  }

  const creds = await exchangeCode({ appId, clientSecret: requireEnv('TNT_CLIENT_SECRET'), code: opts.code })
  if (creds.storeId !== cfg.tiendanube.store_id) {
    await sql.end()
    throw new Error(
      `El code autoriza la tienda ${creds.storeId}, pero stores/${slug}/store.toml dice ${cfg.tiendanube.store_id}. ` +
      `Corregí el store_id o usá el code de la tienda correcta.`)
  }

  await upsertStore(sql, cfg, creds, keyFromEnv())
  const row = await getStore(sql, slug)
  const out = { slug, store_id: row!.id, state: row!.state, scope: row!.scope, backfilled: false }
  console.log(opts.json ? JSON.stringify(out) : `✓ "${slug}" dada de alta (store ${row!.id}). Ahora: tnt sync ${slug}`)
  await sql.end()
}

function requireEnv(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`${name} no está definida en .env`)
  return v
}
