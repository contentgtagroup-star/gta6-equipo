import { randomInt } from 'node:crypto'

export const ZONA_PUBLICACION = 'America/Argentina/Cordoba'
export const MAX_DIARIO = 6
const DIA = 86400000, MINUTO = 60000
export const diaArgentina = t => new Date(t - 3 * 3600000).toISOString().slice(0, 10)

// Seis franjas de dos horas, con un minuto aleatorio en la primera hora.
// Deja al menos una hora entre shorts y conserva el mismo turno en cada red.
export function elegirHorario (reservas, ejecuciones, ahora = Date.now(), azar = randomInt) {
  const inicio = Date.parse(diaArgentina(ahora) + 'T00:00:00-03:00')
  for (let n = 0; n < 366; n++) {
    const medianoche = inicio + n * DIA, dia = diaArgentina(medianoche)
    const ocupadas = Object.values(reservas).filter(r => r.dia === dia)
    const usados = new Set([...Object.entries(reservas).filter(([, r]) => r.dia === dia).map(([id]) => id), ...Object.keys(ejecuciones[dia] || {})])
    if (usados.size >= MAX_DIARIO) continue
    for (let franja = 0; franja < MAX_DIARIO; franja++) {
      if (ocupadas.some(r => r.franja === franja)) continue
      const desde = medianoche + (9 + franja * 2) * 3600000
      const minimo = Math.max(0, Math.ceil((ahora + 15 * MINUTO - desde) / MINUTO))
      if (minimo >= 60) continue
      return { programado_el: desde + azar(minimo, 60) * MINUTO, dia, franja }
    }
  }
  throw new Error('La agenda está llena para el próximo año.')
}
