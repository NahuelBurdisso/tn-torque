import { describe, it, expect, vi } from 'vitest'
import { digestModule } from './index.ts'

const AR = 'America/Argentina/Cordoba'

describe('digestModule.schedule', () => {
  it('no se suscribe a ningún evento: es agendado, no reactivo', () => {
    expect(digestModule.subscribes).toEqual([])
  })

  it('elige la próxima corrida de las dos del día', () => {
    const now = new Date('2026-07-28T13:00:00Z')            // 10:00 AR
    expect(digestModule.schedule!.nextRunAt(now, AR).toISOString())
      .toBe('2026-07-28T21:00:00.000Z')                     // 18:00 AR
  })

  it('la clave lleva el instante, no la fecha', () => {
    const manana = new Date('2026-07-28T12:00:00Z')
    const tarde  = new Date('2026-07-28T21:00:00Z')
    expect(digestModule.schedule!.dedupe('acme', manana, AR))
      .not.toBe(digestModule.schedule!.dedupe('acme', tarde, AR))
  })
})
