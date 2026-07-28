import { describe, it, expect, vi } from 'vitest'
import { authorizeUrl, exchangeCode } from './oauth.ts'

describe('oauth', () => {
  it('arma la URL de autorización', () => {
    expect(authorizeUrl('4321')).toBe('https://www.tiendanube.com/apps/4321/authorize/')
  })

  it('canjea el code por un token', async () => {
    const f = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ access_token: 'tok', user_id: 1000001, scope: 'read_products' }),
      { status: 200, headers: { 'content-type': 'application/json' } }))
    const res = await exchangeCode({ appId: '4321', clientSecret: 'sh', code: 'abc', fetchImpl: f as unknown as typeof fetch })
    expect(res).toEqual({ accessToken: 'tok', storeId: 1000001, scope: 'read_products' })
    const [url, init] = f.mock.calls[0]!
    expect(url).toBe('https://www.tiendanube.com/apps/authorize/token')
    expect(JSON.parse(init.body as string)).toEqual({
      client_id: '4321', client_secret: 'sh', grant_type: 'authorization_code', code: 'abc',
    })
  })

  it('lanza un error claro si el code ya fue usado', async () => {
    const f = vi.fn().mockResolvedValue(new Response('{"error":"invalid_grant"}', { status: 400 }))
    await expect(exchangeCode({ appId: '1', clientSecret: 's', code: 'usado', fetchImpl: f as unknown as typeof fetch }))
      .rejects.toThrow(/un solo uso/)
  })
})
