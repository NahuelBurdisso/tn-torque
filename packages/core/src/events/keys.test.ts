import { describe, it, expect } from 'vitest'
import { backInStockKey, deliveryKey } from './keys.ts'

describe('dedupe keys', () => {
  it('back_in_stock apunta al snapshot que lo causó, no a una fecha', () => {
    expect(backInStockKey(1000001, 98765, 42)).toBe('1000001:variant.back_in_stock:98765:42')
  })

  it('dos transiciones del mismo día producen claves distintas', () => {
    expect(backInStockKey(1, 2, 10)).not.toBe(backInStockKey(1, 2, 11))
  })

  it('la clave de trabajo del módulo incluye el evento', () => {
    expect(deliveryKey('ntfy', 1, 500)).toBe('ntfy:1:500')
  })
})
