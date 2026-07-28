import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto'

const VERSION = 'v1'

export function keyFromEnv(raw = process.env.TNT_MASTER_KEY): Buffer {
  if (!raw) throw new Error('TNT_MASTER_KEY no está definida')
  const key = Buffer.from(raw, 'base64')
  if (key.length !== 32) throw new Error('TNT_MASTER_KEY debe ser de 32 bytes en base64')
  return key
}

export function seal(plaintext: string, key: Buffer): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return [VERSION, iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), body.toString('base64url')].join('.')
}

export function open(sealed: string, key: Buffer): string {
  const [version, iv, tag, body] = sealed.split('.')
  if (version !== VERSION) throw new Error(`formato sellado no soportado: ${version}`)
  if (!iv || !tag || !body) throw new Error('texto sellado malformado')
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'))
  decipher.setAuthTag(Buffer.from(tag, 'base64url'))
  return Buffer.concat([decipher.update(Buffer.from(body, 'base64url')), decipher.final()]).toString('utf8')
}
