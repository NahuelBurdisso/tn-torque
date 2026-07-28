import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { TnClient } from './client.ts'
import { TokenBucket } from './rate-limiter.ts'

const bucket = () => new TokenBucket({ capacity: 40, refillPerSec: 2, now: () => 0 })

function client(fetchImpl: typeof fetch, storeId = 123) {
  return new TnClient({
    storeId,
    token: 'tok',
    userAgent: 'TNT (test@example.com)',
    bucket: bucket(),
    fetchImpl,
    sleep: async () => {},
  })
}

const ok = (body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json', ...headers } })

describe('TnClient', () => {
  it('arma la URL y manda los headers obligatorios', async () => {
    const f = vi.fn().mockResolvedValue(ok({ id: 123 }))
    await client(f as unknown as typeof fetch).get('/store')
    const [url, init] = f.mock.calls[0]!
    expect(url).toBe('https://api.tiendanube.com/v1/123/store')
    expect((init.headers as Record<string, string>).Authentication).toBe('bearer tok')
    expect((init.headers as Record<string, string>)['User-Agent']).toBe('TNT (test@example.com)')
  })

  it('serializa los query params', async () => {
    const f = vi.fn().mockResolvedValue(ok([]))
    await client(f as unknown as typeof fetch).get('/products', { per_page: '200', page: '2' })
    expect(f.mock.calls[0]![0]).toBe('https://api.tiendanube.com/v1/123/products?per_page=200&page=2')
  })

  it('reintenta ante 429 y devuelve el resultado', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(new Response('', { status: 429 }))
      .mockResolvedValueOnce(ok({ ok: true }))
    const res = await client(f as unknown as typeof fetch).get('/store')
    expect(f).toHaveBeenCalledTimes(2)
    expect(res).toEqual({ ok: true })
  })

  it('reintenta ante 500', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(new Response('boom', { status: 500 }))
      .mockResolvedValueOnce(ok({ ok: true }))
    await client(f as unknown as typeof fetch).get('/store')
    expect(f).toHaveBeenCalledTimes(2)
  })

  it('NO reintenta ante 422 y lanza', async () => {
    const f = vi.fn().mockResolvedValue(new Response('{"code":422}', { status: 422 }))
    await expect(client(f as unknown as typeof fetch).get('/store')).rejects.toThrow(/422/)
    expect(f).toHaveBeenCalledTimes(1)
  })

  it('lanza TokenRevokedError ante 401', async () => {
    const f = vi.fn().mockResolvedValue(new Response('', { status: 401 }))
    await expect(client(f as unknown as typeof fetch).get('/store')).rejects.toThrow(/401/)
  })

  it('sigue la paginación por el header Link', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(ok([{ id: 1 }], {
        link: '<https://api.tiendanube.com/v1/123/products?page=2>; rel="next"',
      }))
      .mockResolvedValueOnce(ok([{ id: 2 }]))
    const all = await client(f as unknown as typeof fetch).listAll('/products')
    expect(all).toEqual([{ id: 1 }, { id: 2 }])
  })

  describe('write guard', () => {
    // Estos tests pisan NODE_ENV y TNT_DEMO_STORE_ID a propósito para ejercitar
    // el guard. Con singleFork:true todos los archivos de test comparten un
    // solo proceso, así que si no se restauran acá, el valor pisado se filtra
    // a los tests que corran después en el mismo `vitest run`.
    let origNodeEnv: string | undefined
    let origDemoStoreId: string | undefined

    beforeEach(() => {
      origNodeEnv = process.env.NODE_ENV
      origDemoStoreId = process.env.TNT_DEMO_STORE_ID
    })

    afterEach(() => {
      if (origNodeEnv === undefined) delete process.env.NODE_ENV
      else process.env.NODE_ENV = origNodeEnv

      if (origDemoStoreId === undefined) delete process.env.TNT_DEMO_STORE_ID
      else process.env.TNT_DEMO_STORE_ID = origDemoStoreId
    })

    it('rechaza escrituras en NODE_ENV=test sobre una tienda que no es la demo', async () => {
      process.env.NODE_ENV = 'test'
      process.env.TNT_DEMO_STORE_ID = '999'
      const f = vi.fn().mockResolvedValue(ok({}))
      await expect(client(f as unknown as typeof fetch, 123).put('/products/1', { published: false }))
        .rejects.toThrow(/tienda 123/)
      expect(f).not.toHaveBeenCalled()
    })

    it('permite escrituras sobre la tienda demo', async () => {
      process.env.NODE_ENV = 'test'
      process.env.TNT_DEMO_STORE_ID = '999'
      const f = vi.fn().mockResolvedValue(ok({ ok: true }))
      await client(f as unknown as typeof fetch, 999).put('/products/1', { published: false })
      expect(f).toHaveBeenCalledTimes(1)
    })
  })
})
