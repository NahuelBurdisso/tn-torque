import postgres, { type Sql, type TransactionSql } from 'postgres'

export type Db = Sql<{}>

/**
 * Lo que aceptan las funciones que pueden correr sueltas o adentro de
 * `sql.begin()`. `TransactionSql` no es asignable a `Db` — le faltan `end`,
 * `begin` y el resto de lo que solo tiene sentido a nivel de conexión — así
 * que una función que solo hace queries y quiere poder recibir el `tx` de
 * una transacción declara este tipo en vez de `Db`.
 */
export type Queryable = Db | TransactionSql<{}>

/**
 * Tipo exacto que espera `sql.json()`. postgres.js no lo exporta a nivel de
 * módulo (vive dentro de su namespace), así que lo derivamos de la firma real
 * del método para poder tipar los valores que cruzan ese límite sin `any`.
 */
export type Json = Parameters<Db['json']>[0]

let cached: Db | undefined

export function db(url = process.env.TNT_DATABASE_URL): Db {
  if (!url) throw new Error('TNT_DATABASE_URL no está definida')
  cached ??= postgres(url, { onnotice: () => {}, transform: { undefined: null } })
  return cached
}

export function connect(url: string): Db {
  return postgres(url, { onnotice: () => {}, transform: { undefined: null } })
}
