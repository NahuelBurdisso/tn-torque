/**
 * Clave de deduplicación para variant.back_in_stock.
 *
 * El discriminador es el snapshot que causó la transición, NO una fecha.
 * Con fecha falla en los dos extremos: una variante que se agota y vuelve
 * dos veces el mismo día perdería el segundo evento, y una con una unidad
 * de stock emitiría todos los días.
 *
 * DEBE coincidir exactamente con el format() de 004_events.sql en apply.ts.
 * El test de la Tarea 11 verifica que no se separen.
 */
export const backInStockKey = (storeId: number, variantId: number, snapshotId: number) =>
  `${storeId}:variant.back_in_stock:${variantId}:${snapshotId}`

/** Clave de un trabajo generado por un módulo a partir de un evento. */
export const deliveryKey = (module: string, storeId: number, eventId: number) =>
  `${module}:${storeId}:${eventId}`
