import { db, migrate } from '@tnt/db'
import { loadStoreConfig, tick, complete, fail, recoverRunning, ntfyModule, type Job } from '@tnt/core'

const MODULES = { ntfy: ntfyModule }

export async function worker(opts: { once?: boolean; interval?: string }) {
  const sql = db()
  await migrate(sql)

  const recovered = await recoverRunning(sql)
  if (recovered) console.log(`recuperados ${recovered} trabajos colgados de un reinicio`)

  const everyMs = Number(opts.interval ?? 60) * 1000
  const configs = new Map<number, Awaited<ReturnType<typeof loadStoreConfig>>>()

  const runOnce = async () => {
    const jobs = await tick(sql)
    for (const job of jobs) await runJob(sql, job, configs)
    if (jobs.length) console.log(`procesados ${jobs.length} trabajos`)
  }

  await runOnce()
  if (opts.once) { await sql.end(); return }

  console.log(`worker corriendo, tick cada ${everyMs / 1000}s. Ctrl-C para salir.`)
  setInterval(() => { void runOnce() }, everyMs)
}

async function runJob(
  sql: ReturnType<typeof db>, job: Job,
  configs: Map<number, Awaited<ReturnType<typeof loadStoreConfig>>>,
) {
  try {
    const mod = MODULES[job.module as keyof typeof MODULES]
    if (!mod) throw new Error(`módulo desconocido: ${job.module}`)

    if (!configs.has(job.store_id)) {
      const [row] = await sql<{ slug: string }[]>`SELECT slug FROM stores WHERE id = ${job.store_id}`
      configs.set(job.store_id, await loadStoreConfig(row!.slug))
    }

    await mod.execute(job, { store: configs.get(job.store_id)!, now: () => new Date() })
    await complete(sql, job.id)
  } catch (err) {
    await fail(sql, job.id, String(err))
    console.error(`trabajo ${job.id} falló: ${err}`)
  }
}
