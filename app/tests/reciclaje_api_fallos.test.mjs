import test from 'node:test'
import assert from 'node:assert/strict'

const clave = 'clave-de-prueba-suficientemente-larga'
Object.assign(process.env, {
  SUPABASE_URL: 'https://reciclaje-fallos.supabase.co',
  SUPABASE_SERVICE_KEY: 'fixture',
  TEAM_KEYS: JSON.stringify({ Cuervo: clave })
})

const haceDias = dias => new Date(Date.now() - dias * 86400000).toISOString()
const clipOriginal = () => ({ estado: 'listo', video_path: 'Cuervo/viejo.mp4', creado: haceDias(30), stock: false })
const docs = [{ coleccion: 'clips', id: 'viejo', datos: clipOriginal(), version: 1, actualizado: haceDias(30) }]
const eventos = []
let modo = 'fallo-borrado'
let parches = 0
let borrados = []
const originalFetch = globalThis.fetch

globalThis.fetch = async (url, opciones = {}) => {
  const u = new URL(url)
  const metodo = opciones.method || 'GET'
  if (u.pathname === '/storage/v1/object/list/clips') {
    const body = JSON.parse(opciones.body)
    return Response.json(body.prefix
      ? [{ name: 'viejo.mp4', id: 'objeto-1', metadata: { size: 7 * 1024 * 1024 } }]
      : [{ name: 'Cuervo', id: null, metadata: null }])
  }
  if (u.pathname === '/storage/v1/object/clips' && metodo === 'DELETE') {
    if (modo === 'fallo-borrado') return Response.json({ message: 'Storage caído' }, { status: 500 })
    borrados.push(...JSON.parse(opciones.body).prefixes)
    return Response.json([])
  }
  const nombre = u.pathname.split('/').at(-1)
  if (nombre === 'publicacion_docs') {
    if (metodo === 'POST') eventos.push(JSON.parse(opciones.body))
    return Response.json(metodo === 'POST' ? [{}] : [])
  }
  assert.equal(nombre, 'docs', u.pathname)
  const coincide = d => [...u.searchParams].every(([k, v]) => {
    if (k === 'coleccion' && v.startsWith('eq.')) return d.coleccion === v.slice(3)
    if (k === 'id' && v.startsWith('eq.')) return d.id === v.slice(3)
    if (k === 'version' && v.startsWith('eq.')) return d.version === Number(v.slice(3))
    if (k === 'datos->>estado' && v.startsWith('eq.')) return d.datos.estado === v.slice(3)
    if (k === 'datos->>limpieza_id' && v.startsWith('eq.')) return d.datos.limpieza_id === v.slice(3)
    return true
  })
  const filas = docs.filter(coincide)
  if (metodo === 'PATCH') {
    parches++
    if (modo === 'fallo-cierre' && parches === 2) return Response.json({ message: 'Base caída' }, { status: 500 })
    const cambios = JSON.parse(opciones.body)
    for (const d of filas) Object.assign(d, cambios)
  }
  return Response.json(filas)
}

const { default: handler } = await import('../api/reciclaje.js')
async function llamar () {
  let salida
  const res = { setHeader () {}, status (codigo) { this.codigo = codigo; return this }, json (datos) { salida = { codigo: this.codigo, datos } } }
  await handler({ method: 'POST', headers: { 'x-clave': clave }, query: {}, body: { op: 'limpiar_sin_aprobar', confirmar: 'DESCARTAR_CLIPS_SIN_APROBAR' } }, res)
  return salida
}

function reiniciar (modoNuevo) {
  modo = modoNuevo
  parches = 0
  borrados = []
  docs[0].datos = clipOriginal()
  docs[0].version = 1
  docs[0].actualizado = haceDias(30)
}

test('si el storage falla, el clip vuelve a listo y no se marca borrado', async () => {
  reiniciar('fallo-borrado')
  const r = await llamar()
  assert.equal(r.codigo, 200)
  assert.equal(r.datos.ok, false)
  assert.equal(r.datos.borrados, 0)
  assert.equal(r.datos.resultados[0].restaurado, true)
  assert.equal(docs[0].datos.estado, 'listo')
  assert.equal(docs[0].datos.limpieza_id, undefined)
  assert.deepEqual(borrados, [])
})

test('si falla el cierre de metadata, reintenta con la versión actual', async () => {
  reiniciar('fallo-cierre')
  const r = await llamar()
  assert.equal(r.codigo, 200)
  assert.equal(r.datos.ok, true)
  assert.equal(r.datos.borrados, 1, JSON.stringify(r.datos))
  assert.deepEqual(borrados, ['Cuervo/viejo.mp4'])
  assert.equal(docs[0].datos.estado, 'descartado')
  assert.equal(docs[0].datos.archivo_reciclado_path, 'Cuervo/viejo.mp4')
  assert.ok(eventos.length > 0)
})

test.after(() => { globalThis.fetch = originalFetch })
