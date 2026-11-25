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

// Un short ocupa una de seis franjas compartidas por todo el equipo.
// Todos sus destinos reciben el mismo instante y cada red conserva su tope diario.
export function proximaFranjaShort (config, reservas, redes, desde = Date.now(), minuto = 0) {
  const zona = config.zona_horaria
  const inicial = diaLocal(desde, zona)
  for (let n = 0; n < 366; n++) {
    const dia = new Date(Date.parse(inicial + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10)
    const delDia = Object.values(reservas).filter(r => diaLocal(r.fecha, zona) === dia)
    const grupos = new Set(delDia.filter(r => r.short).map(r => r.origen))
    if (grupos.size >= 6 || redes.some(red => delDia.filter(r => r.red === red).length >= config.por_red[red].por_dia)) continue
    for (let franja = 0; franja < 6; franja++) {
      if (delDia.some(r => r.short && r.franja === franja)) continue
      const hora = `${String(9 + 2 * franja).padStart(2, '0')}:${String(minuto).padStart(2, '0')}`
      for (const fecha of instantes(dia, hora, zona)) if (fecha >= desde + 15 * 60000 && !delDia.some(r => redes.includes(r.red) && r.fecha === fecha)) return { fecha, franja }
    }
  }
  throw new Error('No hay una franja libre para el short en el próximo año.')
}
