import { TokenBucket, sleep as realSleep } from './rate-limiter.ts'

const BASE = 'https://api.tiendanube.com/v1'
const RETRYABLE = new Set([429, 500, 502, 503, 504])
const MAX_ATTEMPTS = 5

export class TnHttpError extends Error {
  constructor(readonly status: number, readonly body: string, readonly path: string) {
    super(`TN ${status} en ${path}: ${body.slice(0, 200)}`)
    this.name = 'TnHttpError'
  }
  /** Un 401 significa token revocado: la tienda va a needs_reauth, no se reintenta. */
  get isAuth() { return this.status === 401 }
}

export interface TnClientOpts {
  storeId: number
  token: string
  userAgent: string
  bucket: TokenBucket
  fetchImpl?: typeof fetch
  sleep?: (ms: number) => Promise<void>
}

export class TnClient {
  private readonly fetchImpl: typeof fetch
  private readonly sleep: (ms: number) => Promise<void>

  constructor(private readonly opts: TnClientOpts) {
    this.fetchImpl = opts.fetchImpl ?? fetch
    this.sleep = opts.sleep ?? realSleep
  }

  get storeId() { return this.opts.storeId }

  get<T = unknown>(path: string, params?: Record<string, string>) {
    return this.request<T>('GET', path, { params })
  }
  post<T = unknown>(path: string, body: unknown) {
    return this.request<T>('POST', path, { body })
  }
  put<T = unknown>(path: string, body: unknown) {
    return this.request<T>('PUT', path, { body })
  }

  /** Sigue el header Link hasta que no haya rel="next". */
  async listAll<T = unknown>(path: string, params: Record<string, string> = {}): Promise<T[]> {
    let url: string | undefined = this.url(path, { per_page: '200', ...params })
    const out: T[] = []
    while (url) {
      const { data, next }: { data: T[]; next?: string } = await this.raw<T[]>('GET', url, undefined)
      out.push(...data)
      url = next
    }
    return out
  }

  private url(path: string, params?: Record<string, string>): string {
    const qs = params && Object.keys(params).length ? `?${new URLSearchParams(params)}` : ''
    return `${BASE}/${this.opts.storeId}${path}${qs}`
  }

  private async request<T>(
    method: string,
    path: string,
    o: { params?: Record<string, string>; body?: unknown },
  ): Promise<T> {
    const { data } = await this.raw<T>(method, this.url(path, o.params), o.body)
    return data
  }

  /**
   * Escribir sobre una tienda de cliente desde un test es irreversible.
   * Es un throw, no una convención — vive en raw() para que ningún método
   * de escritura futuro (patch, delete, un bulk endpoint, lo que sea) pueda
   * esquivarla llamando a raw() directo, como ya hace listAll() con GET.
   *
   * Falla cerrado: si TNT_DEMO_STORE_ID no está definida o no es un entero
   * positivo, CUALQUIER escritura en test se rechaza — no se asume una demo
   * en 0. Ninguna tienda real de Tienda Nube tiene store_id 0, pero fallar
   * abierto ahí sería la única excepción a que todos los defaults de
   * seguridad de este repo fallan cerrado (dns_verified, backfill, etc).
   */
  private assertWriteAllowed(method: string) {
    if (method === 'GET') return
    if (process.env.NODE_ENV !== 'test') return

    const raw = process.env.TNT_DEMO_STORE_ID
    const demo = raw === undefined ? NaN : Number(raw)
    if (!Number.isInteger(demo) || demo <= 0) {
      throw new Error(
        `NODE_ENV=test: se rechaza ${method}. Falta TNT_DEMO_STORE_ID (o no es un entero ` +
        `positivo) — sin esa variable ningún test puede escribir en ninguna tienda.`)
    }
    if (this.opts.storeId !== demo) {
      throw new Error(
        `NODE_ENV=test: se rechaza ${method} sobre la tienda ${this.opts.storeId}. ` +
        `Los tests solo pueden escribir en la demo (${demo}).`)
    }
  }

  private async raw<T>(method: string, url: string, body: unknown): Promise<{ data: T; next?: string }> {
    this.assertWriteAllowed(method)
    let lastErr: unknown
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      await this.sleep(this.opts.bucket.reserve())

      const res = await this.fetchImpl(url, {
        method,
        headers: {
          Authentication: `bearer ${this.opts.token}`,
          'Content-Type': 'application/json',
          'User-Agent': this.opts.userAgent,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })

      if (res.ok) {
        const text = await res.text()
        return {
          data: (text ? JSON.parse(text) : null) as T,
          next: parseNextLink(res.headers.get('link')),
        }
      }

      const err = new TnHttpError(res.status, await res.text(), url)
      if (!RETRYABLE.has(res.status)) throw err
      lastErr = err
      if (attempt < MAX_ATTEMPTS) await this.sleep(2 ** attempt * 250)
    }
    throw lastErr
  }
}

export function parseNextLink(header: string | null): string | undefined {
  if (!header) return undefined
  for (const part of header.split(',')) {
    const m = part.match(/<([^>]+)>\s*;\s*rel="next"/)
    if (m) return m[1]
  }
  return undefined
}
