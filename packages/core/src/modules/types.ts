import type { Db } from '@tnt/db'
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

/** Lo que ve handle(): ni base ni red. Sin sql acá, TypeScript rechaza cualquier await adentro. */
export interface ModuleContext {
  store: StoreConfig
  now: () => Date
}

/** Lo que ve execute(): el único lugar con permiso para tener efectos. */
export interface ExecuteContext extends ModuleContext {
  sql: Db
  fetchImpl?: typeof fetch
}

/**
 * Lo que handle() devuelve: las dos intenciones que puede expresar sobre la
 * cola, calculadas puro. dispatch() es quien las ejecuta.
 */
export interface HandleResult {
  enqueue: JobSpec[]
  /** cancel_key a matar. Opcional: la mayoría de los módulos solo encolan. */
  cancel?: string[]
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
  handle(event: TntEvent, ctx: ModuleContext): HandleResult
  /** El único lugar con efectos. */
  execute(job: Job, ctx: ExecuteContext): Promise<void>
}
