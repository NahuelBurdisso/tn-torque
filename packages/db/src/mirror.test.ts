import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { connect } from './client.ts'
import { migrate } from './migrate.ts'

const sql = connect(process.env.TNT_TEST_DATABASE_URL!)

beforeEach(async () => {
  await migrate(sql)
  await sql`TRUNCATE stores CASCADE`
  await sql`INSERT INTO stores (id, slug, name, timezone, instance) VALUES (1, 'demo', 'Demo', 'UTC', 'torque-pc')`
})
afterAll(async () => { await sql.end() })

describe('tnt_num', () => {
  it('convierte números válidos', async () => {
    const [r] = await sql`SELECT tnt_num('123.45') AS v`
    expect(Number(r!.v)).toBe(123.45)
  })

  it('devuelve NULL con basura en vez de lanzar', async () => {
    const [r] = await sql`SELECT tnt_num('no soy un número') AS v`
    expect(r!.v).toBeNull()
  })

  it('devuelve NULL con string vacío', async () => {
    const [r] = await sql`SELECT tnt_num('') AS v`
    expect(r!.v).toBeNull()
  })
})

describe('columnas generadas', () => {
  it('extrae el texto localizado en es', async () => {
    await sql`INSERT INTO products (store_id, id, raw)
              VALUES (1, 10, ${sql.json({ name: { es: 'Sweater Sol de Mayo' }, handle: { es: 'sweater-sol' } })})`
    const [p] = await sql`SELECT name, handle FROM products WHERE id = 10`
    expect(p!.name).toBe('Sweater Sol de Mayo')
    expect(p!.handle).toBe('sweater-sol')
  })

  it('un precio corrupto degrada a NULL sin voltear el insert del lote', async () => {
    await sql`INSERT INTO variants (store_id, id, product_id, raw, stock) VALUES
      (1, 100, 10, ${sql.json({ price: '5000.00' })}, 3),
      (1, 101, 10, ${sql.json({ price: 'GRATIS' })}, 1)`
    const rows = await sql`SELECT id, price FROM variants ORDER BY id`
    expect(Number(rows[0]!.price)).toBe(5000)
    expect(rows[1]!.price).toBeNull()
  })

  it('borrar la tienda borra su espejo en cascada', async () => {
    await sql`INSERT INTO products (store_id, id, raw) VALUES (1, 10, '{}'::jsonb)`
    await sql`DELETE FROM stores WHERE id = 1`
    const [{ count }] = await sql`SELECT count(*)::int AS count FROM products`
    expect(count).toBe(0)
  })
})
