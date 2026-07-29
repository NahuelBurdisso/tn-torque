import { describe, it, expect } from 'vitest'
import { weeklyModule } from './index.ts'
import { buildWeekly } from './index.ts'

const AR = 'America/Argentina/Cordoba'

describe('weeklyModule.schedule', () => {
  it('cae un lunes a las 9:00 locales', () => {
    const miercoles = new Date('2026-07-29T13:00:00Z')
    const next = weeklyModule.schedule!.nextRunAt(miercoles, AR)
    // 2026-08-03 es lunes; 09:00 AR = 12:00 UTC
    expect(next.toISOString()).toBe('2026-08-03T12:00:00.000Z')
  })
})

describe('buildWeekly', () => {
  it('se manda aunque no haya carritos', () => {
    const m = buildWeekly({ storeName: 'ACME', carts: 0, totalArs: 0, sinStock: 0,
                            lastSyncAt: new Date('2026-07-28T12:00:00Z'), now: new Date('2026-07-28T12:05:00Z') })
    expect(m.body).toContain('sin carritos')
    expect(m.body).toContain('último sync')
  })

  it('avisa si el último sync es viejo', () => {
    const m = buildWeekly({ storeName: 'ACME', carts: 3, totalArs: 100000, sinStock: 1,
                            lastSyncAt: new Date('2026-07-25T12:00:00Z'), now: new Date('2026-07-28T12:00:00Z') })
    expect(m.body).toContain('⚠')
  })
})
