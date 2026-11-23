import { randomUUID } from 'node:crypto'
import { db, exigir, responder } from '../lib/comun.js'
import { EQUIPO, ESCUCHA_VIGENTE_MS, VERSION_TURNOS } from '../lib/turnos.js'
import { categoriaPorId } from '../lib/categorias.js'
import { promptTurno } from '../lib/prompt_turno.js'
import { normalizarEnlace, normalizarNota } from '../lib/enlaces.js'

const COL = 'turnos'
const ID = 'global'
const ACTIVOS = new Set(['pendiente', 'ejecutando', 'pausa_solicitada', 'pausado'])
const TOMADO_VENCE = 3 * 60 * 60 * 1000
const RESERVA_CAIDA_VENCE = 5 * 60 * 1000

function trabajos (datos) {
  return [...(datos.pedido_id ? [datos] : []), ...(datos.pedidos || [])]
}

function buscar (datos, pedido_id) {
  if (datos.pedido_id === pedido_id) return { trabajo: datos, legado: true }
  const indice = (datos.pedidos || []).findIndex(p => p.pedido_id === pedido_id)
  return indice < 0 ? null : { trabajo: datos.pedidos[indice], indice }
}

function reemplazar (datos, referencia, trabajo) {
  if (referencia.legado) return { ...datos, ...trabajo }
  const pedidos = [...(datos.pedidos || [])]
  pedidos[referencia.indice] = trabajo
  return { ...datos, pedidos }
}

function quitar (datos, referencia) {
  if (!referencia.legado) return { ...datos, pedidos: (datos.pedidos || []).filter((_, i) => i !== referencia.indice) }
  const { pedidos, ultimo, ultima_asignacion } = datos
  return { pedidos: pedidos || [], ...(ultimo ? { ultimo } : {}), ...(ultima_asignacion ? { ultima_asignacion } : {}) }
}

function versionEscucha (escuchas, nombre) {
  return Number((escuchas || []).find(x => x.id === nombre)?.datos?.version) || 0
}

function idsActivos (datos) {
  return new Set(trabajos(datos).filter(p => ACTIVOS.has(p.estado)).map(p => p.pedido_id))
}

function motivoNoDisponible (video, activos, ahora) {
  if (!video) return null
  const estado = video.estado || 'libre'
  if (estado === 'libre') return null
  if (estado === 'hecho') return 'Ese enlace ya se usó para un clip. Pegá otro.'
  if (estado !== 'tomado') return 'Ese enlace no está disponible para un pedido directo.'
  if (video.tomado_pedido && activos.has(video.tomado_pedido)) {
    return 'Ese enlace lo está trabajando otra compu o pedido. Esperá a que termine o pegá otro.'
  }
  const vence = video.tomado_pedido ? RESERVA_CAIDA_VENCE : TOMADO_VENCE
  if (ahora - (video.tomado_el || 0) > vence) return null
  return 'Ese enlace lo está trabajando otra compu o pedido. Esperá a que termine o pegá otro.'
}

function directoDe (trabajo) {
  return trabajo?.video_id
    ? { id: trabajo.video_id, url: trabajo.video_url, nota: trabajo.nota || '', plataforma: trabajo.video_plataforma }
    : null
}

async function leerRadar (sb) {
  const { data, error } = await sb.from('docs').select('datos').eq('coleccion', 'radar').eq('id', 'actual').maybeSingle()
  return error ? { error } : { datos: data?.datos || {} }
}

async function leerUsados (sb, videoId) {
  const { data, error } = await sb.from('docs').select('datos').eq('coleccion', 'usados').eq('id', videoId).maybeSingle()
  return error ? { error } : { tramos: data?.datos?.tramos || [] }
}

// Un tramo reservado de un pedido inactivo y vencido no bloquea el enlace; uno usado sí.
function tramoVigente (tramo, activos, ahora) {
  if (tramo?.estado !== 'reservado') return true
  return (tramo.pedido_id && activos.has(tramo.pedido_id)) || ahora - (tramo.reservado_el || 0) < RESERVA_CAIDA_VENCE
}

function avisoVersion (version, nombre) {
  const de = nombre ? `La compu de ${nombre}` : 'Tu compu'
  return version
    ? `${de} tiene una versión antigua de las herramientas y hay una nueva. Hay que actualizar antes de crear clips: con el motor de clips prendido se actualiza solo en unos minutos, o corré "python3 equipo.py herramientas".`
    : `${de} todavía no tiene el motor de clips configurado. Configuralo en "Preparar mi compu" antes de crear clips.`
}

function rechazoVersion (res, version, nombre) {
  return responder(res, 426, { error: avisoVersion(version, nombre), desactualizado: true, version, version_actual: VERSION_TURNOS })
}

async function leerVersion (sb, nombre) {
  const { data, error } = await sb.from('docs').select('id,datos').eq('coleccion', 'escucha').in('id', [nombre])
  return error ? { error } : { version: versionEscucha(data, nombre) }
}

// Un pedido en pausa por bloqueo de YouTube (tiene reanudar_el) no frena a uno de Twitch: la compu está libre.
function compuOcupada (datos, nombre, pedido_id, fuente) {
  return trabajos(datos).some(p => p.pedido_id !== pedido_id && p.asignado === nombre && ACTIVOS.has(p.estado) &&
    !(fuente === 'twitch' && p.estado === 'pausado' && p.reanudar_el && p.fuente !== 'twitch'))
}

function pedidoAnteriorEnCola (datos, nombre, pedido_id) {
  return trabajos(datos).some(p => p.pedido_id !== pedido_id && p.pedido_por === nombre && p.estado === 'pendiente' && !p.asignado)
}

async function leer (sb) {
  return sb.from('docs').select('datos,version').eq('coleccion', COL).eq('id', ID).maybeSingle()
}

async function guardar (sb, actual, datos) {
  if (!actual) {
    const { error } = await sb.from('docs').insert({ coleccion: COL, id: ID, datos, version: 1 })
    return !error
  }
  const { data, error } = await sb.from('docs').update({ datos, version: actual.version + 1, actualizado: new Date().toISOString() })
    .eq('coleccion', COL).eq('id', ID).eq('version', actual.version).select('version')
  return !error && !!data?.length
}

async function leerFeedback (sb) {
  const feedback = []
  for (let desde = 0; ; desde += 1000) {
    const { data: clips, error } = await sb.from('docs').select('id,datos').eq('coleccion', 'clips').range(desde, desde + 999)
    if (error) return { error }
    feedback.push(...(clips || []).filter(c => c.datos.calificaciones).map(c => ({ id: c.id, ...c.datos })))
    if ((clips || []).length < 1000) break
  }
  return { feedback }
}

async function contarClips (sb, pedido_id) {
  let total = 0
  for (let desde = 0; ; desde += 1000) {
    const { data: clips, error } = await sb.from('docs').select('id,datos').eq('coleccion', 'clips').eq('datos->>turno_id', pedido_id).range(desde, desde + 999)
    if (error) return { error }
    total += (clips || []).filter(c => c.datos?.turno_id === pedido_id && c.datos.estado !== 'descartado' && !c.datos.tipo).length
    if ((clips || []).length < 1000) break
  }
  return { total }
}

const FASES = new Set(['buscando', 'analizando', 'analizado', 'descargando', 'fuente_lista',
  'renderizando', 'video_listo', 'subiendo', 'video_subido', 'listo'])

export default async function handler (req, res) {
  const yo = exigir(req, res); if (!yo) return
  if (req.method !== 'POST') return responder(res, 405, { error: 'Método no permitido' })
  const sb = db()
  const op = req.body?.op
  const { data: actual, error } = await leer(sb)
  if (error) return responder(res, 500, { error: error.message })
  const turno = actual?.datos || {}
  const ahora = Date.now()

  if (op === 'pedir') {
    const categoria = req.body?.categoria
    try { categoriaPorId(categoria) } catch (e) { return responder(res, 400, { error: e.message }) }
    const fuentePedida = req.body?.fuente === 'twitch' ? 'twitch' : 'youtube'
    let fuente = fuentePedida
    let cantidad = req.body?.cantidad
    let directo = null
    const pedidoDirecto = ['video_url', 'video_id', 'video_plataforma'].some(k => req.body?.[k] !== undefined)
    if (pedidoDirecto) {
      const enlace = normalizarEnlace(req.body?.video_url)
      if (!enlace) return responder(res, 400, { error: 'El enlace no es de YouTube, Twitch o Kick (video, directo o clip)' })
      if (req.body?.video_id !== enlace.id) return responder(res, 400, { error: 'El id del video no coincide con el enlace' })
      if (req.body?.video_plataforma !== enlace.plataforma) return responder(res, 400, { error: 'La plataforma no coincide con el enlace' })
      if (req.body?.fuente !== undefined && fuentePedida !== enlace.plataforma) {
        return responder(res, 400, { error: 'La fuente del pedido no coincide con el enlace' })
      }
      if (cantidad === undefined) cantidad = 1
      if (cantidad !== 1) return responder(res, 400, { error: 'El pedido desde un enlace crea un solo clip' })
      let nota
      try { nota = normalizarNota(req.body?.nota) } catch (e) { return responder(res, 400, { error: e.message }) }
      fuente = enlace.plataforma
      directo = { id: enlace.id, url: enlace.url, plataforma: enlace.plataforma, nota }
    }
    if (!Number.isInteger(cantidad) || cantidad < 1 || cantidad > 5) return responder(res, 400, { error: 'Pedido inválido' })
    const { data: escuchas, error: e2 } = await sb.from('docs').select('id,datos').eq('coleccion', 'escucha').in('id', EQUIPO)
    if (e2) return responder(res, 500, { error: e2.message })
    if (versionEscucha(escuchas, yo) < VERSION_TURNOS) return rechazoVersion(res, versionEscucha(escuchas, yo))
    const activos = (escuchas || []).filter(x => ahora - x.datos.ultima < ESCUCHA_VIGENTE_MS && x.datos.version >= VERSION_TURNOS).map(x => x.id)
    const { feedback, error: e3 } = await leerFeedback(sb)
    if (e3) return responder(res, 500, { error: e3.message })
    if (directo) {
      const { datos: radar, error: er } = await leerRadar(sb)
      if (er) return responder(res, 500, { error: er.message })
      const video = (radar.videos || []).find(v => v?.id === directo.id)
      const motivo = motivoNoDisponible(video, idsActivos(turno), ahora)
      if (motivo) return responder(res, 409, { error: motivo })
      const { tramos, error: eu } = await leerUsados(sb, directo.id)
      if (eu) return responder(res, 500, { error: eu.message })
      if (tramos.some(t => tramoVigente(t, idsActivos(turno), ahora))) {
        return responder(res, 409, { error: 'Ese enlace ya se usó para un clip. Pegá otro.' })
      }
    }
    const pedido_id = randomUUID()
    let registro = actual
    for (let intento = 0; intento < 8; intento++) {
      const datos = registro?.datos || {}
      if (directo && trabajos(datos).some(p => p.pedido_id !== pedido_id && ACTIVOS.has(p.estado) && p.video_id === directo.id)) {
        return responder(res, 409, { error: 'Ya hay un pedido en curso para ese enlace. Esperá a que termine o pegá otro.' })
      }
      const asignado = activos.includes(yo) && !compuOcupada(datos, yo, null, fuente) && !pedidoAnteriorEnCola(datos, yo) ? yo : null
      const nuevo = { estado: 'pendiente', pedido_id, pedido_por: yo, pedido_el: ahora,
        asignado, asignado_el: ahora, cantidad, pausa_compatible: true, fuente,
        ...(categoria ? { categoria, categoria_version: categoriaPorId(categoria).configurationVersion } : {}),
        ...(directo ? { video_id: directo.id, video_url: directo.url, video_plataforma: directo.plataforma,
          ...(directo.nota ? { nota: directo.nota } : {}) } : {}),
        prompt: asignado ? promptTurno(asignado, cantidad, feedback, pedido_id, categoria, fuente, directo) : null }
      const previos = datos.pedidos || []
      const pedidos = [...previos.filter(p => ACTIVOS.has(p.estado)),
        ...previos.filter(p => !ACTIVOS.has(p.estado)).slice(-12), nuevo]
      if (await guardar(sb, registro, { ...datos, pedidos })) return responder(res, 200, { ok: true, asignado, pedido_id })
      const { data, error: e4 } = await leer(sb)
      if (e4) return responder(res, 500, { error: e4.message })
      registro = data
    }
    return responder(res, 409, { error: 'Los pedidos cambiaron; probá de nuevo' })
  }

  if (op === 'reintentar') {
    const ref = buscar(turno, req.body?.pedido_id)
    const t = ref?.trabajo
    if (!t || !['error', 'terminado'].includes(t.estado)) return responder(res, 409, { error: 'Ese pedido ya cambió' })
    if (t.estado === 'terminado') {
      const { total, error: e2 } = await contarClips(sb, t.pedido_id)
      if (e2) return responder(res, 500, { error: e2.message })
      if (total >= t.cantidad) return responder(res, 409, { error: 'Ese pedido ya está completo' })
    }
    const { data: escuchas, error: e2 } = await sb.from('docs').select('id,datos').eq('coleccion', 'escucha').in('id', EQUIPO)
    if (e2) return responder(res, 500, { error: e2.message })
    const activos = (escuchas || []).filter(x => ahora - x.datos.ultima < ESCUCHA_VIGENTE_MS && x.datos.version >= VERSION_TURNOS).map(x => x.id)
    const dueño = t.pedido_por || yo
    if (versionEscucha(escuchas, dueño) < VERSION_TURNOS) return rechazoVersion(res, versionEscucha(escuchas, dueño), dueño === yo ? null : dueño)
    const asignado = activos.includes(dueño) && !compuOcupada(turno, dueño, t.pedido_id, t.fuente) && !pedidoAnteriorEnCola(turno, dueño, t.pedido_id) ? dueño : null
    const { feedback, error: e3 } = await leerFeedback(sb)
    if (e3) return responder(res, 500, { error: e3.message })
    const nuevo = { ...t, estado: 'pendiente', asignado, asignado_el: ahora, pausa_compatible: true,
      etapa: null, avance: null, avance_base: null, resumen: null, terminado_el: null, run_id: null,
      prompt: asignado ? promptTurno(asignado, t.cantidad, feedback, t.pedido_id, t.categoria, t.fuente, directoDe(t)) : null }
    const datos = reemplazar(turno, ref, nuevo)
    if (!await guardar(sb, actual, datos)) return responder(res, 409, { error: 'El pedido cambió; probá de nuevo' })
    return responder(res, 200, { ok: true, asignado, pedido_id: t.pedido_id })
  }

  if (op === 'cancelar' || op === 'borrar') {
    const ref = buscar(turno, req.body?.pedido_id)
    const t = ref?.trabajo
    if (!t) return responder(res, 409, { error: 'Ese pedido ya no está' })
    if (['ejecutando', 'pausa_solicitada'].includes(t.estado)) return responder(res, 409, { error: 'Ese pedido se está ejecutando. Pausalo y después borralo.' })
    if (!await guardar(sb, actual, quitar(turno, ref))) return responder(res, 409, { error: 'El pedido cambió; probá de nuevo' })
    return responder(res, 200, { ok: true })
  }

  if (op === 'pausar' || op === 'reanudar') {
    let registro = actual
    for (let intento = 0; intento < 3; intento++) {
      const datosActuales = registro?.datos || {}
      const ref = buscar(datosActuales, req.body?.pedido_id)
      const t = ref?.trabajo
      if (!t) return responder(res, 409, { error: 'Ese pedido ya no está disponible' })
      const pausando = op === 'pausar'
      if (pausando && !['pendiente', 'ejecutando'].includes(t.estado)) return responder(res, 409, { error: 'Este pedido no se puede pausar ahora' })
      // Si la pausa todavía no se hizo efectiva, reanudar solo la cancela y la PC sigue con lo que estaba haciendo
      if (!pausando && t.estado === 'pausa_solicitada') {
        const { etapa, pausado_el, ...sigue } = t
        if (await guardar(sb, registro, reemplazar(datosActuales, ref, { ...sigue, estado: 'ejecutando' }))) return responder(res, 200, { ok: true, estado: 'ejecutando' })
        const { data, error: e2 } = await leer(sb)
        if (e2) return responder(res, 500, { error: e2.message })
        registro = data
        continue
      }
      if (!pausando && t.estado !== 'pausado') return responder(res, 409, { error: 'Este pedido todavía no se puede reanudar' })
      if (!t.pausa_compatible && (pausando ? t.estado === 'ejecutando' : t.etapa === 'ejecutando')) return responder(res, 409, { error: 'La pausa de un clip en curso está disponible en pedidos nuevos' })
      const dueño = t.pedido_por || t.asignado
      if (!pausando && dueño) {
        const { version, error: ev } = await leerVersion(sb, dueño)
        if (ev) return responder(res, 500, { error: ev.message })
        if (version < VERSION_TURNOS) return rechazoVersion(res, version, dueño === yo ? null : dueño)
      }
      let prompt = t.prompt
      if (!pausando && dueño && dueño !== t.asignado) {
        const { feedback, error: e2 } = await leerFeedback(sb)
        if (e2) return responder(res, 500, { error: e2.message })
        prompt = promptTurno(dueño, t.cantidad, feedback, t.pedido_id, t.categoria, t.fuente, directoDe(t))
      }
      const datos = pausando
        ? { ...t, estado: t.estado === 'pendiente' ? 'pausado' : 'pausa_solicitada', etapa: t.estado, pausado_el: ahora }
        : { ...t, estado: 'pendiente', etapa: null, avance: null, avance_base: null, reanudar_el: null,
            asignado: dueño, prompt, asignado_el: ahora, reanudado_el: ahora, run_id: null }
      if (await guardar(sb, registro, reemplazar(datosActuales, ref, datos))) return responder(res, 200, { ok: true, estado: datos.estado })
      const { data, error: e2 } = await leer(sb)
      if (e2) return responder(res, 500, { error: e2.message })
      registro = data
    }
    return responder(res, 409, { error: 'El pedido cambió; probá de nuevo' })
  }

  if (op === 'recuperar') {
    const ref = buscar(turno, req.body?.pedido_id)
    const t = ref?.trabajo
    if (t?.estado !== 'pendiente') return responder(res, 409, { error: 'Ese pedido ya no está disponible' })
    // El dueño es quien lo pidió; en datos anteriores vale la compu asignada. Nunca se toma un pedido ajeno.
    const dueño = t.pedido_por || t.asignado
    if (!dueño || dueño !== yo) {
      return responder(res, 409, { error: dueño ? `Ese pedido es de la compu de ${dueño}; esperá a que retome` : 'Ese pedido no tiene dueño conocido; no se puede tomar desde otra compu' })
    }
    if (t.asignado === yo || compuOcupada(turno, yo, t.pedido_id, t.fuente) ||
      (t.asignado && ahora - (t.asignado_el || t.pedido_el || ahora) < ESCUCHA_VIGENTE_MS)) {
      return responder(res, 409, { error: 'El pedido todavía está en la compu asignada' })
    }
    const { data: escuchas, error: e2 } = await sb.from('docs').select('id,datos').eq('coleccion', 'escucha').in('id', [yo])
    if (e2) return responder(res, 500, { error: e2.message })
    if (!(escuchas || []).some(x => x.id === yo && ahora - x.datos.ultima < ESCUCHA_VIGENTE_MS && x.datos.version >= VERSION_TURNOS)) {
      return responder(res, 409, { error: 'Esta compu no está activa o actualizada' })
    }
    const { feedback, error: e3 } = await leerFeedback(sb)
    if (e3) return responder(res, 500, { error: e3.message })
    const nuevo = { ...t, asignado: yo, asignado_el: ahora,
      prompt: promptTurno(yo, t.cantidad, feedback, t.pedido_id, t.categoria, t.fuente, directoDe(t)) }
    if (!await guardar(sb, actual, { ...reemplazar(turno, ref, nuevo), ultima_asignacion: yo })) return responder(res, 409, { error: 'El pedido cambió' })
    return responder(res, 200, { ok: true, asignado: yo, pedido_id: t.pedido_id })
  }

  if (op === 'tomar') {
    const ref = buscar(turno, req.body?.pedido_id)
    const t = ref?.trabajo
    if (t?.estado !== 'pendiente' || t.asignado !== yo || (t.pedido_por && t.pedido_por !== yo) || compuOcupada(turno, yo, t.pedido_id, t.fuente)) return responder(res, 409, { error: 'Ese turno ya no está disponible' })
    const { version, error: ev } = await leerVersion(sb, yo)
    if (ev) return responder(res, 500, { error: ev.message })
    if (version < VERSION_TURNOS) return responder(res, 409, { error: avisoVersion(version), desactualizado: true })
    const { total, error: e2 } = await contarClips(sb, t.pedido_id)
    if (e2) return responder(res, 500, { error: e2.message })
    const run_id = randomUUID()
    const nuevo = { ...t, estado: 'ejecutando', iniciado_el: ahora, latido: ahora,
      avance: 'preparando', avance_base: total, run_id, tiempos: [{ f: 'preparando', t: ahora }] }
    if (!await guardar(sb, actual, reemplazar(turno, ref, nuevo))) return responder(res, 409, { error: 'Otro proceso tomó el turno' })
    return responder(res, 200, { ok: true, pedido_id: t.pedido_id, run_id, prompt: t.prompt, cantidad: t.cantidad, categoria: t.categoria || null, fuente: t.fuente || 'youtube',
      ...(t.video_id ? { video_id: t.video_id, video_url: t.video_url, video_plataforma: t.video_plataforma, nota: t.nota || '' } : {}) })
  }

  if (op === 'avance') {
    const fase = req.body?.fase
    if (!FASES.has(fase)) return responder(res, 400, { error: 'Etapa inválida' })
    const { total, error: e2 } = await contarClips(sb, req.body?.pedido_id)
    if (e2) return responder(res, 500, { error: e2.message })
    let registro = actual
    for (let intento = 0; intento < 3; intento++) {
      const datosActuales = registro?.datos || {}
      const ref = buscar(datosActuales, req.body?.pedido_id)
      const t = ref?.trabajo
      if (!['ejecutando', 'pausa_solicitada'].includes(t?.estado) || t.asignado !== yo ||
        t.pedido_id !== req.body?.pedido_id || t.run_id !== req.body?.run_id) {
        return responder(res, 409, { error: 'Ese turno ya no está en esta PC' })
      }
      // Se registra cada cambio de etapa para saber dónde se va el tiempo de un pedido
      const tiempos = t.avance === fase ? t.tiempos : [...(t.tiempos || []), { f: fase, t: ahora }].slice(-120)
      const nuevo = { ...t, avance: fase, avance_base: total, avance_el: ahora, latido: ahora, ...(tiempos ? { tiempos } : {}) }
      if (await guardar(sb, registro, reemplazar(datosActuales, ref, nuevo))) return responder(res, 200, { ok: true })
      const { data, error: e3 } = await leer(sb)
      if (e3) return responder(res, 500, { error: e3.message })
      registro = data
    }
    return responder(res, 409, { error: 'El turno cambió' })
  }

  if (op === 'latido' || op === 'terminar' || op === 'cerrar') {
    let clipsFinales = null
    if (op !== 'latido' && req.body?.ok === true) {
      const { total, error: e2 } = await contarClips(sb, req.body?.pedido_id)
      if (e2) return responder(res, 500, { error: e2.message })
      clipsFinales = total
    }
    let registro = actual
    for (let intento = 0; intento < 3; intento++) {
      const datosActuales = registro?.datos || {}
      const ref = buscar(datosActuales, req.body?.pedido_id)
      const t = ref?.trabajo
      if (!['ejecutando', 'pausa_solicitada'].includes(t?.estado) || t.asignado !== yo || t.pedido_id !== req.body?.pedido_id || t.run_id !== req.body?.run_id) {
        return responder(res, 409, { error: 'Ese turno ya no está en esta PC' })
      }
      const incompleto = clipsFinales !== null && clipsFinales < t.cantidad
      const cambios = op === 'latido' ? { latido: ahora } : req.body?.youtube === true ?
        // YouTube frenó la conexión de esta PC: el pedido queda en pausa y la misma PC lo reanuda sola después
        { estado: 'pausado', etapa: 'ejecutando', pausado_el: ahora, latido: ahora, run_id: null, reanudar_el: ahora + 45 * 60000,
          resumen: 'YouTube frenó las descargas desde esta conexión. El pedido se reanuda solo cuando pase el bloqueo.' } :
        t.estado === 'pausa_solicitada' ?
        { estado: 'pausado', etapa: 'ejecutando', pausado_el: ahora, latido: ahora, run_id: null,
          resumen: String(req.body?.resumen || '').slice(-600) } :
        { estado: req.body?.ok === true && !incompleto ? 'terminado' : 'error', terminado_el: ahora, ultimo: yo,
          resumen: (incompleto ? `Se crearon ${clipsFinales}/${t.cantidad} clips. ` : '') + String(req.body?.resumen || '').slice(-500), prompt: null, run_id: null }
      if (op !== 'latido' && t.tiempos) cambios.tiempos = [...t.tiempos, { f: 'fin', t: ahora }].slice(-120)
      const nuevo = reemplazar(datosActuales, ref, { ...t, ...cambios })
      if (await guardar(sb, registro, { ...nuevo, ultimo: op === 'latido' ? datosActuales.ultimo : yo })) return responder(res, 200, { ok: true, estado: cambios.estado || t.estado })
      const { data, error: e2 } = await leer(sb)
      if (e2) return responder(res, 500, { error: e2.message })
      registro = data
    }
    return responder(res, 409, { error: 'El turno cambió' })
  }

  responder(res, 400, { error: 'Operación inválida' })
}
