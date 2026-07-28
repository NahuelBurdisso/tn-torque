import { describe, it, expect } from 'vitest'
import { TokenBucket } from './rate-limiter.ts'

function fakeClock(start = 0) {
  let t = start
  return { now: () => t, advance: (ms: number) => { t += ms } }
}

describe('TokenBucket', () => {
  it('deja pasar sin espera mientras haya capacidad', () => {
    const clock = fakeClock()
    const b = new TokenBucket({ capacity: 3, refillPerSec: 2, now: clock.now })
    expect(b.reserve()).toBe(0)
    expect(b.reserve()).toBe(0)
    expect(b.reserve()).toBe(0)
  })

  it('hace esperar cuando se agota', () => {
    const clock = fakeClock()
    const b = new TokenBucket({ capacity: 1, refillPerSec: 2, now: clock.now })
    expect(b.reserve()).toBe(0)
    expect(b.reserve()).toBe(500)   // 1 token a 2/s = 500ms
  })

  it('encola: cada reserva extra suma su propia espera', () => {
    const clock = fakeClock()
    const b = new TokenBucket({ capacity: 1, refillPerSec: 2, now: clock.now })
    b.reserve()
    expect(b.reserve()).toBe(500)
    expect(b.reserve()).toBe(1000)
  })

  it('recarga con el paso del tiempo', () => {
    const clock = fakeClock()
    const b = new TokenBucket({ capacity: 2, refillPerSec: 2, now: clock.now })
    b.reserve(); b.reserve()
    clock.advance(1000)             // +2 tokens, tope 2
    expect(b.reserve()).toBe(0)
    expect(b.reserve()).toBe(0)
    expect(b.reserve()).toBe(500)
  })

  it('nunca acumula más que la capacidad', () => {
    const clock = fakeClock()
    const b = new TokenBucket({ capacity: 2, refillPerSec: 10, now: clock.now })
    clock.advance(60_000)
    expect(b.reserve()).toBe(0)
    expect(b.reserve()).toBe(0)
    expect(b.reserve()).toBe(100)
  })
})
