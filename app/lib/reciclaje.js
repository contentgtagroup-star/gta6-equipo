// Selección de archivos reciclables del bucket de clips. Lógica pura y testeable:
// no toca Supabase ni borra nada; recibe el inventario y devuelve el plan.
//
// Política (acordada con Cuervo, R2 2026-11-23):
// - Conservar el MP4/imagen 7 días desde la última publicación confirmada de
//   TODOS sus destinos. Conservar siempre metadata, IDs remotos y enlaces.
// - No reciclar si algún destino sigue en juego (pendiente/procesando/enviando/
//   error/revisión/borrador/manual) o si otro clip, sugerencia o trabajo activo
//   necesita ese mismo archivo (se chequea por path, no solo por clip_id).
// - Solo son candidatos los archivos que efectivamente se publicaron desde la
//   app. Los "huérfanos" (subidos y nunca publicados) quedan fuera, a propósito.

export const DIA = 86400000

// Estados de un envío de la cola que mantienen el archivo "en juego".
export const EN_JUEGO = new Set(['pendiente', 'procesando', 'enviando', 'error', 'revisar', 'borrador', 'manual'])

const pathsDe = x => [x && x.video_path, ...((x && x.imagenes) || [])].filter(Boolean)

// Clip que todavía necesita su archivo: sigue en la biblioteca y no terminó de publicarse.
const clipActivo = c => c && !['publicado', 'descartado', 'reciclado'].includes(c.estado)

export function planReciclaje ({ cola = [], clips = [], sugerencias = [], trabajos = [], archivos = [] } = {}, { ahora = Date.now(), dias = 7 } = {}) {
  const limite = ahora - dias * DIA
  const tam = new Map(archivos.map(a => [a.path, Math.max(0, Number(a.size) || 0)]))

  // 1) Paths que NO se pueden tocar porque algo activo los necesita.
  const motivoRetencion = new Map()
  const retener = (p, motivo) => { if (p && tam.has(p) && !motivoRetencion.has(p)) motivoRetencion.set(p, motivo) }
  for (const c of cola) if (EN_JUEGO.has(c.estado)) for (const p of pathsDe(c)) retener(p, 'envío de ' + (c.plataforma || 'una red') + ' en estado "' + c.estado + '"')
  for (const c of clips) if (clipActivo(c)) for (const p of pathsDe(c)) retener(p, 'clip "' + (c.id || c.titulo || '') + '" todavía en publicación')
  for (const s of sugerencias) if (s.estado !== 'aprobada') for (const p of pathsDe(s)) retener(p, 'sugerencia sin cerrar necesita el archivo')
  for (const t of trabajos) if (['pendiente', 'ejecutando'].includes(t.estado)) for (const p of pathsDe(t)) retener(p, 'trabajo en curso usa el archivo')

  // 2) Última publicación confirmada por path (entre los envíos ya publicados).
  const ultimoPub = new Map()
  for (const c of cola) if (c.estado === 'publicado') for (const p of pathsDe(c)) {
    const t = Number(c.publicado_el) || 0
    if (t >= (ultimoPub.get(p) || 0)) ultimoPub.set(p, t)
  }

  // 3) Clasificar cada archivo real del bucket.
  const candidatos = [], retenidos = []
  for (const [path, bytes] of tam) {
    if (!ultimoPub.has(path)) continue // nunca se publicó desde la app: fuera del alcance de este reciclaje
    if (motivoRetencion.has(path)) { retenidos.push({ path, bytes, motivo: motivoRetencion.get(path) }); continue }
    const publicado_el = ultimoPub.get(path)
    if (publicado_el > limite) { retenidos.push({ path, bytes, motivo: 'publicado hace menos de ' + dias + ' días', publicado_el }); continue }
    candidatos.push({ path, bytes, publicado_el, motivo: 'publicado en todos sus destinos hace más de ' + dias + ' días' })
  }
  candidatos.sort((a, b) => b.bytes - a.bytes)
  return { candidatos, retenidos, bytes_total: candidatos.reduce((s, c) => s + c.bytes, 0), parametros: { ahora, dias, limite } }
}

export function humano (bytes) {
  const u = ['B', 'KB', 'MB', 'GB', 'TB']
  let n = Math.max(0, Number(bytes) || 0), i = 0
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++ }
  return (i === 0 ? n : n.toFixed(1)) + ' ' + u[i]
}
