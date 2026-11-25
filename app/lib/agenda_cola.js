// Cálculo puro de franjas. La reserva concurrente se hace en el store.
const partes = (ms, zona) => Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
  timeZone: zona, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
}).formatToParts(ms).filter(p => p.type !== 'literal').map(p => [p.type, p.value]))

export function diaLocal (ms, zona) {
  const p = partes(ms, zona)
  return `${p.year}-${p.month}-${p.day}`
}

function instantes (dia, hora, zona) {
  const base = Date.parse(dia + 'T' + hora + ':00Z')
  const encontrados = []
  // Cubre cambios de horario de verano, incluso horas repetidas o inexistentes.
  for (let delta = -14 * 60; delta <= 14 * 60; delta += 15) {
    const ms = base + delta * 60000, p = partes(ms, zona)
    if (`${p.year}-${p.month}-${p.day}` === dia && `${p.hour}:${p.minute}` === hora) encontrados.push(ms)
  }
  return encontrados
}

export function proximaFranja (config, red, ocupados = [], desde = Date.now()) {
  if (!config.activo) return desde
  const zona = config.zona_horaria, ajuste = config.por_red?.[red]
  if (!ajuste?.por_dia) return desde
  const usados = new Set(ocupados)
  for (let n = 0; n < 366; n++) {
    const inicial = diaLocal(desde, zona)
    const dia = new Date(Date.parse(inicial + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10)
    const horarios = ajuste.horarios.length ? ajuste.horarios : Array.from({ length: ajuste.por_dia }, (_, i) => {
      const minutos = Math.floor((9 * 60) + (12 * 60 * (i + 0.5) / ajuste.por_dia))
      return `${String(Math.floor(minutos / 60)).padStart(2, '0')}:${String(minutos % 60).padStart(2, '0')}`
    })
    const delDia = [...usados].filter(ms => diaLocal(ms, zona) === dia).length
    if (delDia >= ajuste.por_dia) continue
    for (const hora of horarios) for (const ms of instantes(dia, hora, zona)) {
      if (ms > desde && !usados.has(ms)) return ms
    }
  }
  throw new Error('No hay un horario libre en la cadencia configurada.')
}
