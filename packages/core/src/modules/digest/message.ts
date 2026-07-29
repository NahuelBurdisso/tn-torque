import type { DigestCart } from './query.ts'

const NBSP_FREE = (s: string) => s.replace(/ /g, ' ')

const money = (n: number) =>
  NBSP_FREE(new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 }).format(Math.round(n)))

function ago(from: Date, now: Date): string {
  const h = Math.floor((now.getTime() - from.getTime()) / 3_600_000)
  if (h < 1) return 'recién'
  if (h < 48) return `hace ${h} h`
  return `hace ${Math.floor(h / 24)} d`
}

/** El link `wa.me` necesita solo dígitos: con el `+` no abre nada. */
export function waLink(phoneDigits: string, text: string): string {
  return `https://wa.me/${phoneDigits}?text=${encodeURIComponent(text)}`
}

function invite(cart: DigestCart, storeName: string): string {
  const first = (cart.name ?? '').trim().split(/\s+/)[0] || 'Hola'
  const firstItem = cart.items[0]
  const what = firstItem?.productName ?? 'tu compra'
  // Nombra la variante cuando existe: sin ella, "el Sweater" es ambiguo entre
  // los talles que están en stock y los que no, y la dueña tiene que preguntar.
  const variant = firstItem?.variantLabel ? ` (${firstItem.variantLabel})` : ''
  return `Hola ${first}! Soy de ${storeName} 🙂 Vi que te quedó el ` +
         `${what}${variant} en el carrito. ¿Te ayudo a terminarlo?` +
         (cart.resumeUrl ? ` Lo retomás acá: ${cart.resumeUrl}` : '')
}

function block(cart: DigestCart, storeName: string, now: Date): string {
  const items = cart.items
    .map(i => i.variantLabel ? `${i.productName} (${i.variantLabel}) ×${i.quantity}`
                             : `${i.productName} ×${i.quantity}`)
    .join(', ')
  const allInStock = cart.items.every(i => i.inStock)

  const lines = [
    `${cart.name ?? 'Sin nombre'} — $${money(cart.totalArs)} · ${ago(cart.abandonedAt, now)}`,
    items,
  ]

  if (!allInStock) {
    lines.push('⛔ sin stock — no escribir todavía')
  } else if (cart.phone) {
    lines.push('✅ hay stock de todo')
    lines.push(waLink(cart.phone, invite(cart, storeName)))
  } else {
    lines.push('✅ hay stock — sin teléfono, escribir por mail')
  }

  return lines.join('\n')
}

export interface DigestMessage { title: string; body: string }

/**
 * Arma el mensaje. Puro: sin base, sin red, sin reloj propio.
 * Devuelve null si no hay nada que mandar — el digest vacío no se envía.
 */
export function buildDigest(opts: {
  storeName: string
  carts: DigestCart[]
  now: Date
  maxBytes?: number
}): DigestMessage | null {
  const { storeName, carts, now, maxBytes = 3800 } = opts
  if (!carts.length) return null

  const total = carts.reduce((s, c) => s + c.totalArs, 0)
  const noun = carts.length === 1 ? 'carrito' : 'carritos'
  const title = `${storeName} · ${carts.length} ${noun} · $${money(total)}`

  const sinTel = carts.filter(c => !c.phone).length
  const footer = sinTel ? `\n\n${sinTel} sin teléfono` : ''

  const blocks = carts.map(c => block(c, storeName, now))
  const parts: string[] = []
  let used = Buffer.byteLength(footer, 'utf8')

  for (let i = 0; i < blocks.length; i++) {
    const tail = `\n\ny ${blocks.length - i} más`
    const candidate = (parts.length ? '\n\n' : '') + blocks[i]!
    const size = Buffer.byteLength(candidate, 'utf8')
    if (used + size + Buffer.byteLength(tail, 'utf8') > maxBytes) {
      return { title, body: parts.join('\n\n') + tail + footer }
    }
    parts.push(blocks[i]!)
    used += size
  }

  return { title, body: parts.join('\n\n') + footer }
}
