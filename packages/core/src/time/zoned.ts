export interface LocalParts {
  year: number
  month: number   // 1-12
  day: number
  hour: number
  minute: number
}

const FORMATTERS = new Map<string, Intl.DateTimeFormat>()

function formatterFor(timezone: string): Intl.DateTimeFormat {
  let f = FORMATTERS.get(timezone)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone, hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    })
    FORMATTERS.set(timezone, f)
  }
  return f
}

/** Descompone un instante en la hora de pared de una zona. */
export function zonedPartsOf(date: Date, timezone: string): LocalParts & { second: number } {
  const p = Object.fromEntries(
    formatterFor(timezone).formatToParts(date).map(x => [x.type, x.value]))
  return {
    year: Number(p.year), month: Number(p.month), day: Number(p.day),
    // Intl devuelve "24" para medianoche en algunas zonas; el módulo lo normaliza.
    hour: Number(p.hour) % 24, minute: Number(p.minute), second: Number(p.second),
  }
}

/** Desfasaje de la zona respecto de UTC, en ms, en ese instante. */
function offsetAt(date: Date, timezone: string): number {
  const p = zonedPartsOf(date, timezone)
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - date.getTime()
}

/**
 * Resuelve una hora de pared a un instante UTC.
 *
 * Se corrige dos veces a propósito: el desfasaje depende del instante, y el
 * instante es justo lo que estamos buscando. La primera corrección deja una
 * fecha muy cerca de la correcta; la segunda usa el desfasaje vigente ahí,
 * que es el bueno salvo justo en el salto de horario de verano.
 */
export function utcForLocalTime(parts: LocalParts, timezone: string): Date {
  const naive = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute)
  const first = new Date(naive - offsetAt(new Date(naive), timezone))
  return new Date(naive - offsetAt(first, timezone))
}

/**
 * El próximo instante que corresponda a una de esas horas de pared, mirando
 * hoy primero y mañana si ya pasaron todas.
 */
export function nextLocalTimeAmong(now: Date, timezone: string, times: string[]): Date {
  const candidates: Date[] = []

  for (const dayOffset of [0, 1]) {
    const dayParts = zonedPartsOf(new Date(now.getTime() + dayOffset * 86_400_000), timezone)
    for (const t of times) {
      const [hh, mm] = t.split(':').map(Number)
      candidates.push(utcForLocalTime({ ...dayParts, hour: hh!, minute: mm! }, timezone))
    }
  }

  const future = candidates.filter(d => d.getTime() > now.getTime())
                           .sort((a, b) => a.getTime() - b.getTime())
  if (!future[0]) throw new Error(`no se pudo resolver la próxima corrida en ${timezone}`)
  return future[0]
}

/** El próximo instante que caiga en ese día de la semana a esa hora local. */
export function nextLocalWeekday(
  now: Date, timezone: string, weekday: number, time: string,
): Date {
  const [hh, mm] = time.split(':').map(Number)
  for (let i = 0; i <= 7; i++) {
    const parts = zonedPartsOf(new Date(now.getTime() + i * 86_400_000), timezone)
    const localMidday = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 12))
    if (localMidday.getUTCDay() !== weekday) continue
    const candidate = utcForLocalTime({ ...parts, hour: hh!, minute: mm! }, timezone)
    if (candidate.getTime() > now.getTime()) return candidate
  }
  throw new Error(`no se pudo resolver el próximo día ${weekday} en ${timezone}`)
}
