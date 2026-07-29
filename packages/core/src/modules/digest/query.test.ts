import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { connect, migrate } from '@tnt/db'
import { cartsForDigest, cartsFromMirror } from './query.ts'

const sql = connect(process.env.TNT_TEST_DATABASE_URL!)
const STORE = 1
const NOW = new Date('2026-07-28T12:00:00Z')

beforeEach(async () => {
  await migrate(sql)
  await sql`TRUNCATE stores CASCADE`
  await sql`INSERT INTO stores (id, slug, name, timezone, instance, backfilled_at)
            VALUES (${STORE}, 'demo', 'Demo', 'UTC', 'torque-pc', now() - interval '30 days')`
  await sql`INSERT INTO products (store_id, id, raw)
            VALUES (${STORE}, 900, ${sql.json({ name: { es: 'Sweater Sol de Mayo' } })})`
  await sql`INSERT INTO variants (store_id, id, product_id, raw, stock) VALUES
    (${STORE}, 9001, 900, ${sql.json({ price: '48000', values: [{ es: 'S/M' }] })}, 3),
    (${STORE}, 9002, 900, ${sql.json({ price: '48000', values: [{ es: 'L/XL' }] })}, 0)`
})
afterAll(async () => { await sql.end() })

async function seedCart(o: {
  id: number; phone: string; name: string; total: string; variantId: number
  hoursAgo?: number; eventHoursAgo?: number; gone?: boolean
}) {
  const abandoned = new Date(NOW.getTime() - (o.hoursAgo ?? 3) * 3_600_000)
  await sql`INSERT INTO checkouts (store_id, id, token, raw, tn_created_at, tn_updated_at, gone_at)
    VALUES (${STORE}, ${o.id}, ${'tok' + o.id},
      ${sql.json({
        contact_name: o.name, contact_phone: o.phone, contact_email: `${o.id}@x.com`,
        total: o.total, abandoned_checkout_url: `https://x/checkout/${o.id}`,
        products: [{ variant_id: o.variantId, name: 'Sweater Sol de Mayo', quantity: 1 }],
      })},
      ${abandoned}, ${abandoned}, ${o.gone ? NOW : null})`
  await sql`INSERT INTO events (store_id, type, entity_type, entity_id, payload, dedupe_key, occurred_at)
    VALUES (${STORE}, 'checkout.abandoned', 'checkout', ${o.id}, '{}'::jsonb,
            ${'k' + o.id}, ${new Date(NOW.getTime() - (o.eventHoursAgo ?? 2) * 3_600_000)})`
}

describe('cartsForDigest', () => {
  it('trae los carritos de la ventana', async () => {
    await seedCart({ id: 1, phone: '+541155550100', name: 'Maria', total: '69900', variantId: 9001 })
    const carts = await cartsForDigest(sql, STORE, NOW, 12)
    expect(carts).toHaveLength(1)
    expect(carts[0]!.name).toBe('Maria')
    expect(carts[0]!.totalArs).toBe(69900)
  })

  it('excluye los que ya compraron (gone_at)', async () => {
    await seedCart({ id: 1, phone: '+541155550100', name: 'Maria', total: '69900', variantId: 9001, gone: true })
    expect(await cartsForDigest(sql, STORE, NOW, 12)).toHaveLength(0)
  })

  it('excluye los eventos fuera de la ventana', async () => {
    await seedCart({ id: 1, phone: '+541155550100', name: 'Maria', total: '69900', variantId: 9001, eventHoursAgo: 20 })
    expect(await cartsForDigest(sql, STORE, NOW, 12)).toHaveLength(0)
  })

  it('calcula el stock desde el espejo, no desde el checkout', async () => {
    await seedCart({ id: 1, phone: '+5411111111', name: 'ConStock', total: '48000', variantId: 9001 })
    await seedCart({ id: 2, phone: '+5422222222', name: 'SinStock', total: '48000', variantId: 9002 })
    const carts = await cartsForDigest(sql, STORE, NOW, 12)
    const byName = Object.fromEntries(carts.map(c => [c.name, c]))
    expect(byName.ConStock!.items[0]!.inStock).toBe(true)
    expect(byName.SinStock!.items[0]!.inStock).toBe(false)
  })

  it('agrupa por teléfono normalizado', async () => {
    await seedCart({ id: 1, phone: '+541155550100', name: 'Maria', total: '10000', variantId: 9001 })
    await seedCart({ id: 2, phone: '541155550100',  name: 'Maria', total: '20000', variantId: 9001 })
    const carts = await cartsForDigest(sql, STORE, NOW, 12)
    expect(carts).toHaveLength(1)
    expect(carts[0]!.totalArs).toBe(30000)
    expect(carts[0]!.items).toHaveLength(2)
  })

  it('no agrupa dos teléfonos distintos con el mismo email', async () => {
    await sql`INSERT INTO checkouts (store_id, id, token, raw, tn_created_at, tn_updated_at)
      VALUES (${STORE}, 3, 'tok3', ${sql.json({
        contact_name: 'A', contact_phone: '+5411111111', contact_email: 'mismo@x.com',
        total: '1000', products: [{ variant_id: 9001, name: 'X', quantity: 1 }] })},
        ${NOW}, ${NOW}),
             (${STORE}, 4, 'tok4', ${sql.json({
        contact_name: 'A', contact_phone: '+5422222222', contact_email: 'mismo@x.com',
        total: '1000', products: [{ variant_id: 9001, name: 'X', quantity: 1 }] })},
        ${NOW}, ${NOW})`
    await sql`INSERT INTO events (store_id, type, entity_type, entity_id, payload, dedupe_key, occurred_at)
      VALUES (${STORE}, 'checkout.abandoned', 'checkout', 3, '{}'::jsonb, 'k3', ${NOW}),
             (${STORE}, 'checkout.abandoned', 'checkout', 4, '{}'::jsonb, 'k4', ${NOW})`
    expect(await cartsForDigest(sql, STORE, NOW, 12)).toHaveLength(2)
  })
})

/** Inserta un checkout SIN emitir ningún evento — la situación de acme. */
async function seedCheckoutOnly(o: {
  id: number; phone: string; name: string; total: string; variantId: number
  hoursAgo?: number; gone?: boolean
}) {
  const updated = new Date(NOW.getTime() - (o.hoursAgo ?? 3) * 3_600_000)
  await sql`INSERT INTO checkouts (store_id, id, token, raw, tn_created_at, tn_updated_at, gone_at)
    VALUES (${STORE}, ${o.id}, ${'tok' + o.id},
      ${sql.json({
        contact_name: o.name, contact_phone: o.phone, contact_email: `${o.id}@x.com`,
        total: o.total, abandoned_checkout_url: `https://x/checkout/${o.id}`,
        products: [{ variant_id: o.variantId, name: 'Sweater Sol de Mayo', quantity: 1 }],
      })},
      ${updated}, ${updated}, ${o.gone ? NOW : null})`
}

describe('cartsFromMirror', () => {
  it('trae carritos del espejo aunque no haya ningún evento — la situación de acme', async () => {
    await seedCheckoutOnly({ id: 1, phone: '+541155550100', name: 'Maria', total: '69900', variantId: 9001 })
    const carts = await cartsFromMirror(sql, STORE, 12, NOW)
    expect(carts).toHaveLength(1)
    expect(carts[0]!.name).toBe('Maria')
    expect(carts[0]!.totalArs).toBe(69900)
  })

  it('igual que cartsForDigest, excluye los que ya compraron (gone_at)', async () => {
    await seedCheckoutOnly({ id: 1, phone: '+541155550100', name: 'Maria', total: '69900', variantId: 9001, gone: true })
    expect(await cartsFromMirror(sql, STORE, 12, NOW)).toHaveLength(0)
  })
})
