import { describe, it, expect } from 'vitest'
import { zonedPartsOf, utcForLocalTime, nextLocalTimeAmong, nextLocalWeekday } from './zoned.ts'

const AR = 'America/Argentina/Cordoba'   // UTC-3 fijo, sin horario de verano
const NY = 'America/New_York'            // con horario de verano

describe('zonedPartsOf', () => {
  it('descompone un instante en la hora local de la zona', () => {
    const p = zonedPartsOf(new Date('2026-07-28T15:00:00Z'), AR)
    expect(p).toMatchObject({ year: 2026, month: 7, day: 28, hour: 12 })
  })
})

describe('utcForLocalTime', () => {
  it('resuelve una hora local a UTC en una zona sin DST', () => {
    const d = utcForLocalTime({ year: 2026, month: 7, day: 28, hour: 9, minute: 0 }, AR)
    expect(d.toISOString()).toBe('2026-07-28T12:00:00.000Z')
  })

  it('resuelve correctamente en verano en una zona con DST', () => {
    const d = utcForLocalTime({ year: 2026, month: 7, day: 28, hour: 9, minute: 0 }, NY)
    expect(d.toISOString()).toBe('2026-07-28T13:00:00.000Z')   // EDT, UTC-4
  })

  it('resuelve correctamente en invierno en la misma zona', () => {
    const d = utcForLocalTime({ year: 2026, month: 1, day: 28, hour: 9, minute: 0 }, NY)
    expect(d.toISOString()).toBe('2026-01-28T14:00:00.000Z')   // EST, UTC-5
  })
})

describe('nextLocalTimeAmong', () => {
  it('elige la próxima hora del día que todavía no pasó', () => {
    const now = new Date('2026-07-28T13:00:00Z')          // 10:00 en AR
    const next = nextLocalTimeAmong(now, AR, ['09:00', '18:00'])
    expect(next.toISOString()).toBe('2026-07-28T21:00:00.000Z')   // 18:00 AR
  })

  it('pasa al día siguiente cuando ya pasaron todas', () => {
    const now = new Date('2026-07-28T23:00:00Z')          // 20:00 en AR
    const next = nextLocalTimeAmong(now, AR, ['09:00', '18:00'])
    expect(next.toISOString()).toBe('2026-07-29T12:00:00.000Z')   // 09:00 AR del día siguiente
  })

  it('con una sola hora se comporta como diaria', () => {
    const now = new Date('2026-07-28T13:00:00Z')
    const next = nextLocalTimeAmong(now, AR, ['09:00'])
    expect(next.toISOString()).toBe('2026-07-29T12:00:00.000Z')
  })
})

describe('nextLocalWeekday', () => {
  it('encuentra el próximo lunes a las 9:00 locales', () => {
    const miercoles = new Date('2026-07-29T13:00:00Z')
    // 2026-08-03 es lunes; 09:00 AR = 12:00 UTC
    expect(nextLocalWeekday(miercoles, AR, 1, '09:00').toISOString())
      .toBe('2026-08-03T12:00:00.000Z')
  })
})
