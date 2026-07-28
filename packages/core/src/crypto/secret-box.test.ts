import { describe, it, expect } from 'vitest'
import { randomBytes } from 'node:crypto'
import { seal, open, keyFromEnv } from './secret-box.ts'

const key = randomBytes(32)

describe('secret-box', () => {
  it('desella lo que selló', () => {
    expect(open(seal('token-secreto', key), key)).toBe('token-secreto')
  })

  it('produce cifrados distintos para el mismo texto', () => {
    expect(seal('a', key)).not.toBe(seal('a', key))
  })

  it('falla si el texto cifrado fue manipulado', () => {
    const sealed = seal('token', key)
    const parts = sealed.split('.')
    parts[3] = Buffer.from('otracosa').toString('base64url')
    expect(() => open(parts.join('.'), key)).toThrow()
  })

  it('falla con la clave equivocada', () => {
    expect(() => open(seal('token', key), randomBytes(32))).toThrow()
  })

  it('rechaza una clave que no sea de 32 bytes', () => {
    expect(() => keyFromEnv(randomBytes(16).toString('base64'))).toThrow(/32 bytes/)
  })
})
