import { db, migrate } from '@tnt/db'
import { loadStoreConfig, getStore, buildDigest, cartsForDigest, cartsFromMirror } from '@tnt/core'

/**
 * Imprime el digest sin mandarlo.
 *
 * OJO: con --from-mirror arma el mensaje desde el espejo de checkouts en vez
 * de desde los eventos. Es un camino DISTINTO al de producción, y existe
 * porque el guardia de arranque en frío impide que una tienda ya sincronizada
 * tenga eventos por su backlog. Sirve para validar la REDACCIÓN con datos
 * reales, no la tubería de eventos.
 */
export async function digest(slug: string, opts: { fromMirror?: boolean; window?: string }) {
  const cfg = await loadStoreConfig(slug)
  const sql = db()
  await migrate(sql)

  const row = await getStore(sql, slug)
  if (!row) throw new Error(`la tienda "${slug}" no está dada de alta`)

  const now = new Date()
  const hours = Number(opts.window ?? 12)

  let carts
  if (opts.fromMirror) {
    console.log('⚠  modo espejo: NO es la tubería de producción, se saltea la capa de eventos\n')
    carts = await cartsFromMirror(sql, row.id, hours, now)
  } else {
    carts = await cartsForDigest(sql, row.id, now, hours)
  }

  const message = buildDigest({ storeName: cfg.store.name, carts, now })
  if (!message) { console.log('(digest vacío — no se mandaría nada)'); await sql.end(); return }

  console.log(`── ${message.title} ──\n`)
  console.log(message.body)
  console.log(`\n── ${Buffer.byteLength(message.body, 'utf8')} bytes ──`)
  await sql.end()
}
