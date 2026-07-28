#!/usr/bin/env -S npx tsx
import { existsSync } from 'node:fs'
if (existsSync('.env')) process.loadEnvFile('.env')

import { Command } from 'commander'
import { storeAdd } from './commands/store-add.ts'
import { storeStatus } from './commands/store-status.ts'

const program = new Command()
program.name('tnt').description('TN-Torque').version('0.0.0')

const store = program.command('store').description('gestión de tiendas')

// Se guarda acá (y no dentro de los comandos) el slug del comando en curso,
// para poder nombrar el store.toml roto si lo que falla es una validación de config.
let currentSlug: string | undefined

store.command('add <slug>')
  .description('da de alta una tienda; sin --code imprime la URL de autorización')
  .option('--code <code>', 'code de OAuth devuelto por la autorización (un solo uso)')
  .option('--json', 'salida en JSON')
  .action((slug, opts) => { currentSlug = slug; return storeAdd(slug, opts) })

store.command('status [slug]')
  .description('estado de una tienda, o de todas')
  .option('--json', 'salida en JSON')
  .action((slug, opts) => { currentSlug = slug; return storeStatus(slug, opts) })

try {
  await program.parseAsync()
} catch (err) {
  console.error(formatError(err, currentSlug))
  if (process.env.TNT_DEBUG && err instanceof Error && err.stack) console.error(err.stack)
  process.exit(1)
}

interface ZodLikeError {
  issues: Array<{ path: Array<string | number>; message: string }>
}

// Detección estructural: zod es una dependencia transitiva de @tnt/core, y un
// `instanceof ZodError` puede fallar si es una instancia de otra copia del módulo.
function isZodLikeError(err: unknown): err is ZodLikeError {
  return typeof err === 'object' && err !== null && Array.isArray((err as { issues?: unknown }).issues)
}

function formatError(err: unknown, slug: string | undefined): string {
  if (isZodLikeError(err)) {
    const prefix = slug ? `stores/${slug}/store.toml no es válido:` : 'configuración inválida:'
    const lines = err.issues.map(i => `${i.path.join('.')}: ${i.message}`)
    return [prefix, ...lines].join('\n')
  }
  return err instanceof Error ? err.message : String(err)
}
