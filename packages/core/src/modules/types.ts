import type { StoreConfig } from '../config/store-config.ts'
import type { Job, JobSpec } from '../queue/queue.ts'

export type { Job, JobSpec }

export interface TntEvent {
  id: number
  storeId: number
  type: string
  entityType: string
  entityId: number
  payload: Record<string, unknown>
  occurredAt: Date
}

export interface ModuleContext {
  store: StoreConfig
  now: () => Date
  fetchImpl?: typeof fetch
}

export interface TntModule {
  name: string
  /** Tipos de evento que consume. El despachador filtra por esto. */
  subscribes: string[]
  /** Candados de config que deben estar en true, p.ej. ['dns_verified']. */
  requires?: string[]
  /**
   * PURO: no manda nada, no toca la red, no escribe en la base.
   * Recibe un evento y devuelve qué haría. Eso es lo que hace que los tests
   * sean funciones puras y que el modo aprobación salga gratis.
   */
  handle(event: TntEvent, ctx: ModuleContext): JobSpec[]
  /** El único lugar con efectos. */
  execute(job: Job, ctx: ModuleContext): Promise<void>
}
