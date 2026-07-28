import { describe, it, expect } from 'vitest'
import { parseStoreConfig } from './store-config.ts'

const valid = `
[store]
slug     = "acme"
name     = "ACME"
timezone = "America/Argentina/Cordoba"
instance = "torque-pc"

[tiendanube]
store_id = 1000001

[sending]
from_name    = "ACME"
from_email   = "hola@acme-store.example"
dns_verified = false
daily_budget = 400

[modules]
ntfy = { enabled = true, mode = "auto" }

[brand]
primary = "#6B2532"
`

describe('parseStoreConfig', () => {
  it('parsea una config válida', () => {
    const cfg = parseStoreConfig(valid)
    expect(cfg.store.slug).toBe('acme')
    expect(cfg.tiendanube.store_id).toBe(1000001)
    expect(cfg.modules.ntfy?.enabled).toBe(true)
  })

  it('pone dns_verified en false cuando falta', () => {
    const cfg = parseStoreConfig(`
[store]
slug = "x"
name = "X"
timezone = "UTC"
instance = "torque-pc"
[tiendanube]
store_id = 1
`)
    expect(cfg.sending.dns_verified).toBe(false)
  })

  it('rechaza un slug que no sea kebab-case', () => {
    expect(() => parseStoreConfig(valid.replace('"acme"', '"ACME Store"'))).toThrow()
  })

  it('rechaza una config sin store_id', () => {
    expect(() => parseStoreConfig(valid.replace('store_id = 1000001', ''))).toThrow()
  })

  it('rechaza un mode desconocido', () => {
    expect(() => parseStoreConfig(valid.replace('"auto"', '"turbo"'))).toThrow()
  })
})
