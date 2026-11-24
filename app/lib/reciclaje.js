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

// Clip que todavía necesita su archivo: sigue en la biblioteca sin terminar de
// publicarse, o tiene una aprobación con snapshot que el worker aún va a encolar.
const clipActivo = c => !!c && (
  !['publicado', 'descartado', 'reciclado'].includes(c.estado) ||
  (c.publicacion_cola && c.publicacion_snapshot && c.publicacion_encolada !== true)
)

// Sugerencia que todavía necesita su archivo: no está aprobada, o está aprobada
// pero el worker todavía la va a encolar (encolado !== true).
const sugerenciaActiva = s => !!s && !(s.estado === 'aprobada' && s.encolado === true)

export function planReciclaje ({ cola = [], clips = [], sugerencias = [], trabajos = [], archivos = [] } = {}, { ahora = Date.now(), dias = 7 } = {}) {
  const limite = ahora - dias * DIA
  const tam = new Map(archivos.map(a => [a.path, Math.max(0, Number(a.size) || 0)]))

  // 1) Paths que NO se pueden tocar porque algo activo los necesita.
  const motivoRetencion = new Map()
  const retener = (p, motivo) => { if (p && tam.has(p) && !motivoRetencion.has(p)) motivoRetencion.set(p, motivo) }
  for (const c of cola) if (EN_JUEGO.has(c.estado)) for (const p of pathsDe(c)) retener(p, 'envío de ' + (c.plataforma || 'una red') + ' en estado "' + c.estado + '"')
  for (const c of clips) {
    const id = (c && (c.id || c.titulo)) || ''
    if (clipActivo(c)) for (const p of pathsDe(c)) retener(p, 'clip "' + id + '" todavía en publicación')
    // El worker encola el SNAPSHOT, cuyos paths pueden diferir del video_path actual del clip.
    if (c && c.publicacion_cola && c.publicacion_snapshot && c.publicacion_encolada !== true)
      for (const p of pathsDe(c.publicacion_snapshot)) retener(p, 'clip "' + id + '" con aprobación pendiente de encolar (snapshot)')
  }
  for (const s of sugerencias) if (sugerenciaActiva(s)) for (const p of pathsDe(s)) retener(p, s.estado === 'aprobada' ? 'aprobación pendiente de encolar necesita el archivo' : 'sugerencia sin cerrar necesita el archivo')
  for (const t of trabajos) if (['pendiente', 'ejecutando'].includes(t.estado)) for (const p of pathsDe(t)) retener(p, 'trabajo en curso usa el archivo')

  // 2) Última publicación confirmada por path. Si algún destino publicado no
  // trae una fecha válida, no se puede afirmar que pasaron los días: se retiene.
  const pub = new Map() // path -> { ultimo, faltaFecha }
  for (const c of cola) if (c.estado === 'publicado') for (const p of pathsDe(c)) {
    const info = pub.get(p) || { ultimo: 0, faltaFecha: false }
    const t = Number(c.publicado_el)
    if (Number.isFinite(t) && t > 0) info.ultimo = Math.max(info.ultimo, t)
    else info.faltaFecha = true
    pub.set(p, info)
  }

  // 3) Clasificar cada archivo real del bucket.
  const candidatos = [], retenidos = []
  for (const [path, bytes] of tam) {
    if (!pub.has(path)) continue // nunca se publicó desde la app: fuera del alcance de este reciclaje
    if (motivoRetencion.has(path)) { retenidos.push({ path, bytes, motivo: motivoRetencion.get(path) }); continue }
    const { ultimo: publicado_el, faltaFecha } = pub.get(path)
    if (faltaFecha) { retenidos.push({ path, bytes, motivo: 'falta una fecha de publicación válida en algún destino' }); continue }
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
