const TOKEN_URL = 'https://www.tiendanube.com/apps/authorize/token'

export function authorizeUrl(appId: string): string {
  return `https://www.tiendanube.com/apps/${appId}/authorize/`
}

export interface ExchangeResult {
  accessToken: string
  storeId: number
  scope: string
}

/** El code de OAuth es de UN SOLO USO: si esto falla, hay que pedir uno nuevo. */
export async function exchangeCode(o: {
  appId: string
  clientSecret: string
  code: string
  fetchImpl?: typeof fetch
}): Promise<ExchangeResult> {
  const res = await (o.fetchImpl ?? fetch)(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: o.appId,
      client_secret: o.clientSecret,
      grant_type: 'authorization_code',
      code: o.code,
    }),
  })

  if (!res.ok) {
    throw new Error(
      `El intercambio del code falló con ${res.status}: ${(await res.text()).slice(0, 200)}. ` +
      `El code de OAuth es de un solo uso — pedile a la dueña que vuelva a autorizar y usá el code nuevo.`)
  }

  const body = await res.json() as { access_token: string; user_id: number; scope: string }
  return { accessToken: body.access_token, storeId: body.user_id, scope: body.scope }
}
