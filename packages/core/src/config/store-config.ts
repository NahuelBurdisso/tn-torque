import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parse as parseToml } from 'smol-toml'
import { z } from 'zod'

const ModuleCfg = z.object({
  enabled: z.boolean().default(false),
  mode: z.enum(['approval', 'auto']).default('approval'),
}).passthrough()

export const StoreConfigSchema = z.object({
  store: z.object({
    slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'slug debe ser kebab-case'),
    name: z.string().min(1),
    timezone: z.string().min(1),
    instance: z.string().min(1),
  }),
  tiendanube: z.object({
    store_id: z.number().int().positive(),
  }),
  sending: z.object({
    from_name: z.string().optional(),
    from_email: z.string().email().optional(),
    dns_verified: z.boolean().default(false),
    daily_budget: z.number().int().positive().default(200),
  }).default({}),
  modules: z.record(ModuleCfg).default({}),
  brand: z.record(z.string()).default({}),
})

export type StoreConfig = z.infer<typeof StoreConfigSchema>

export function parseStoreConfig(toml: string): StoreConfig {
  return StoreConfigSchema.parse(parseToml(toml))
}

export async function loadStoreConfig(slug: string, root = 'stores'): Promise<StoreConfig> {
  const cfg = parseStoreConfig(await readFile(join(root, slug, 'store.toml'), 'utf8'))
  if (cfg.store.slug !== slug)
    throw new Error(`la carpeta es "${slug}" pero store.slug dice "${cfg.store.slug}"`)
  const instance = process.env.TNT_INSTANCE
  if (instance && cfg.store.instance !== instance)
    throw new Error(
      `la tienda "${slug}" pertenece a la instancia "${cfg.store.instance}", ` +
      `y esta es "${instance}". Dos instancias sobre la misma tienda duplican todos los envíos.`)
  return cfg
}
