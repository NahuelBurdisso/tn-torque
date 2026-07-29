import type { TntModule } from './types.ts'
import { ntfyModule } from './ntfy/index.ts'
import { digestModule } from './digest/index.ts'
import { weeklyModule } from './weekly/index.ts'

/**
 * Único lugar que sabe qué módulos existen. sync.ts y worker.ts consumen
 * esto en vez de nombrar cada módulo por su cuenta — el próximo módulo se
 * agrega acá una sola vez, no en cada consumidor.
 */
export const MODULE_REGISTRY: readonly TntModule[] = [ntfyModule, digestModule, weeklyModule]

export const MODULES_BY_NAME: Readonly<Record<string, TntModule>> =
  Object.fromEntries(MODULE_REGISTRY.map(mod => [mod.name, mod]))
