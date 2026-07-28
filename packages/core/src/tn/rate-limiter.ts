export interface TokenBucketOpts {
  /** Tokens que puede acumular en reposo. TN permite ráfagas de ~40. */
  capacity: number
  /** Tokens por segundo. TN sostiene ~2/s por tienda. */
  refillPerSec: number
  now?: () => number
}

export class TokenBucket {
  private tokens: number
  private last: number
  private readonly capacity: number
  private readonly refillPerSec: number
  private readonly now: () => number

  constructor(opts: TokenBucketOpts) {
    this.capacity = opts.capacity
    this.refillPerSec = opts.refillPerSec
    this.now = opts.now ?? Date.now
    this.tokens = opts.capacity
    this.last = this.now()
  }

  /**
   * Reserva un slot y devuelve los milisegundos que hay que esperar antes de usarlo.
   * Siempre reserva: si no hay tokens, el saldo va a negativo y la espera crece,
   * que es lo que hace que N llamadas concurrentes se serialicen solas.
   */
  reserve(): number {
    const t = this.now()
    this.tokens = Math.min(this.capacity, this.tokens + ((t - this.last) / 1000) * this.refillPerSec)
    this.last = t

    const deficit = 1 - this.tokens
    this.tokens -= 1
    if (deficit <= 0) return 0
    return Math.ceil((deficit / this.refillPerSec) * 1000)
  }
}

export const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))
