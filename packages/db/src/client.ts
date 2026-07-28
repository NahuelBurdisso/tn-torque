import postgres, { type Sql } from 'postgres'

export type Db = Sql<{}>

let cached: Db | undefined

export function db(url = process.env.TNT_DATABASE_URL): Db {
  if (!url) throw new Error('TNT_DATABASE_URL no está definida')
  cached ??= postgres(url, { onnotice: () => {}, transform: { undefined: null } })
  return cached
}

export function connect(url: string): Db {
  return postgres(url, { onnotice: () => {}, transform: { undefined: null } })
}
