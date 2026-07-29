import { db, migrate } from '@tnt/db'
import {
  loadStoreConfig, keyFromEnv, storeToken, TnClient, TokenBucket, syncStore,
  dispatch, MODULE_REGISTRY, getStore,
} from '@tnt/core'

export async function sync(slug: string, opts: { json?: boolean }) {
  const cfg = await loadStoreConfig(slug)
  const sql = db()
  await migrate(sql)

  const row = await getStore(sql, slug)
  if (!row) throw new Error(`la tienda "${slug}" no está dada de alta — corré: tnt store add ${slug}`)
  if (row.state !== 'active') throw new Error(`la tienda "${slug}" está en estado ${row.state}`)

  const client = new TnClient({
    storeId: cfg.tiendanube.store_id,
    token: await storeToken(sql, slug, keyFromEnv()),
    userAgent: process.env.TNT_USER_AGENT ?? 'TN-Torque',
    bucket: new TokenBucket({ capacity: 40, refillPerSec: 2 }),
  })

  const stats = await syncStore(sql, client, cfg.tiendanube.store_id, cfg)
  const { dispatched, failed } = await dispatch(sql, MODULE_REGISTRY, cfg.tiendanube.store_id, {
    store: cfg, now: () => new Date(),
  })

  const out = { slug, ...stats, dispatched, failed }
  console.log(opts.json
    ? JSON.stringify(out)
    : `${slug}: ${stats.mode} · ${stats.rowsSeen} vistas · ${stats.rowsChanged} cambiadas · ` +
      `${stats.eventsEmitted} eventos · ${stats.checkouts.rowsSeen} checkouts · ` +
      `${stats.scheduled} agendados · ${dispatched} despachados` +
      (failed ? ` · ${failed} FALLIDOS (ver event_deliveries)` : ''))
  await sql.end()
}
