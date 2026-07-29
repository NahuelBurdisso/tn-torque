import { describe, it, expect } from 'vitest'
import { buildDigest, waLink } from './message.ts'
import type { DigestCart } from './query.ts'

const NOW = new Date('2026-07-28T12:00:00Z')

const cart = (o: Partial<DigestCart> = {}): DigestCart => ({
  personKey: '541155550100',
  name: 'Maria Claudia Gigena',
  phone: '541155550100',
  totalArs: 69900,
  abandonedAt: new Date(NOW.getTime() - 14 * 3_600_000),
  resumeUrl: 'https://acme-store.example/checkout/1',
  items: [{ productName: 'Sweater Sol de Mayo', variantLabel: 'L/XL', quantity: 1, inStock: true }],
  ...o,
})

describe('waLink', () => {
  it('arma el link sin el +', () => {
    expect(waLink('541155550100', 'Hola')).toBe('https://wa.me/541155550100?text=Hola')
  })

  it('escapa el texto', () => {
    expect(waLink('54911', 'Hola María ¿cómo va?')).toContain('Hola%20Mar%C3%ADa')
  })
})

describe('buildDigest', () => {
  it('devuelve null cuando no hay carritos', () => {
    expect(buildDigest({ storeName: 'ACME', carts: [], now: NOW })).toBeNull()
  })

  it('arma título con cantidad y monto', () => {
    const d = buildDigest({ storeName: 'ACME', carts: [cart(), cart({ personKey: 'x', phone: '5499', totalArs: 30100 })], now: NOW })
    expect(d!.title).toBe('ACME · 2 carritos · $100.000')
  })

  it('usa singular con un solo carrito', () => {
    const d = buildDigest({ storeName: 'ACME', carts: [cart()], now: NOW })
    expect(d!.title).toBe('ACME · 1 carrito · $69.900')
  })

  it('incluye nombre, monto y antigüedad', () => {
    const d = buildDigest({ storeName: 'ACME', carts: [cart()], now: NOW })
    expect(d!.body).toContain('Maria Claudia Gigena')
    expect(d!.body).toContain('$69.900')
    expect(d!.body).toContain('hace 14 h')
  })

  it('pone link cuando hay stock', () => {
    const d = buildDigest({ storeName: 'ACME', carts: [cart()], now: NOW })
    expect(d!.body).toContain('wa.me/541155550100')
  })

  it('NO pone link cuando falta stock', () => {
    const d = buildDigest({ storeName: 'ACME', carts: [cart({
      items: [{ productName: 'Sweater', variantLabel: 'S/M', quantity: 1, inStock: false }] })], now: NOW })
    expect(d!.body).not.toContain('wa.me')
    expect(d!.body).toContain('sin stock')
  })

  it('lista sin link a quien no tiene teléfono, y lo cuenta', () => {
    const d = buildDigest({ storeName: 'ACME', carts: [
      cart(), cart({ personKey: 'a@x.com', phone: null, name: 'Sin Tel' })], now: NOW })
    expect(d!.body).toContain('Sin Tel')
    expect(d!.body).toContain('1 sin teléfono')
  })

  it('trunca y avisa cuántos quedaron afuera', () => {
    const many = Array.from({ length: 40 }, (_, i) =>
      cart({ personKey: `p${i}`, phone: `5490000${i}`, name: `Persona ${i}` }))
    const d = buildDigest({ storeName: 'ACME', carts: many, now: NOW, maxBytes: 800 })
    expect(Buffer.byteLength(d!.body, 'utf8')).toBeLessThanOrEqual(800)
    expect(d!.body).toMatch(/y \d+ más/)
  })

  it('muestra los talles de las variantes', () => {
    const d = buildDigest({ storeName: 'ACME', carts: [cart()], now: NOW })
    expect(d!.body).toContain('Sweater Sol de Mayo (L/XL)')
  })

  it('nombra la variante en el texto pre-escrito del wa.me', () => {
    const d = buildDigest({ storeName: 'ACME', carts: [cart()], now: NOW })
    const link = d!.body.match(/https:\/\/wa\.me\/\S+/)![0]
    expect(decodeURIComponent(link)).toContain('Sweater Sol de Mayo (L/XL)')
  })

  it('sin variantLabel no deja paréntesis vacíos en el texto pre-escrito', () => {
    const d = buildDigest({ storeName: 'ACME', carts: [cart({
      items: [{ productName: 'Sweater Sol de Mayo', variantLabel: null, quantity: 1, inStock: true }] })], now: NOW })
    const link = d!.body.match(/https:\/\/wa\.me\/\S+/)![0]
    const decoded = decodeURIComponent(link)
    expect(decoded).not.toContain('()')
    expect(decoded).not.toContain('(null)')
  })
})
