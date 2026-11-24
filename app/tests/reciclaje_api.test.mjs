import test from 'node:test'
import assert from 'node:assert/strict'

const clave = 'clave-de-prueba-suficientemente-larga'
Object.assign(process.env, { SUPABASE_URL: 'https://reciclaje-test.supabase.co', SUPABASE_SERVICE_KEY: 'fixture', TEAM_KEYS: JSON.stringify({ Cuervo: clave }) })

const haceDias = dias => new Date(Date.now() - dias * 86400000).toISOString()
const clipOriginal = { estado: 'listo', video_path: 'Cuervo/viejo.mp4', creado: haceDias(30), stock: false }
const tablas = {
  docs: [{ coleccion: 'clips', id: 'viejo', datos: { ...clipOriginal }, version: 1, actualizado: haceDias(30) }],
  publicacion_docs: []
}
let borrados = []
const originalFetch = globalThis.fetch

globalThis.fetch = async (url, opciones = {}) => {
  const u = new URL(url)
  assert.equal(u.hostname, 'reciclaje-test.supabase.co')
  const metodo = opciones.method || 'GET'
  if (u.pathname === '/storage/v1/object/list/clips') {
    const body = JSON.parse(opciones.body)
    return Response.json(body.prefix
      ? [{ name: 'viejo.mp4', id: 'objeto-1', metadata: { size: 7 * 1024 * 1024 } }]
      : [{ name: 'Cuervo', id: null, metadata: null }])
  }
  if (u.pathname === '/storage/v1/object/clips' && metodo === 'DELETE') {
    borrados.push(...JSON.parse(opciones.body).prefixes)
    return Response.json([])
  }
  const nombre = u.pathname.split('/').at(-1)
  const tabla = tablas[nombre]
  assert.ok(tabla, u.pathname)
  const coincide = d => [...u.searchParams].every(([k, v]) => {
    if (k === 'coleccion' && v.startsWith('eq.')) return d.coleccion === v.slice(3)
    if (k === 'id' && v.startsWith('eq.')) return d.id === v.slice(3)
    if (k === 'version' && v.startsWith('eq.')) return d.version === Number(v.slice(3))
    if (k === 'datos->>estado' && v.startsWith('eq.')) return d.datos.estado === v.slice(3)
    if (k === 'datos->>limpieza_id' && v.startsWith('eq.')) return d.datos.limpieza_id === v.slice(3)
    return true
  })
  let filas = tabla.filter(coincide)
  if (metodo === 'PATCH') {
    const cambios = JSON.parse(opciones.body)
    for (const d of filas) Object.assign(d, cambios)
  } else if (metodo === 'POST') {
    const nuevo = JSON.parse(opciones.body)
    tabla.push(nuevo); filas = [nuevo]
  }
  return Response.json(filas)
}

const { default: handler } = await import('../api/reciclaje.js')
async function llamar (body, method = 'POST') {
  let salida
  const res = { setHeader () {}, status (codigo) { this.codigo = codigo; return this }, json (datos) { salida = { codigo: this.codigo, datos } } }
  await handler({ method, headers: { 'x-clave': clave }, query: {}, body }, res)
  return salida
}

test('la limpieza exige la frase de confirmación y no borra sin ella', async () => {
  borrados = []
  const r = await llamar({ op: 'limpiar_sin_aprobar' })
  assert.equal(r.codigo, 400)
  assert.deepEqual(borrados, [])
  assert.equal(tablas.docs[0].datos.estado, 'listo')
})

test('la limpieza bloquea, borra y conserva metadata del clip descartado', async () => {
  borrados = []
  const r = await llamar({ op: 'limpiar_sin_aprobar', confirmar: 'DESCARTAR_CLIPS_SIN_APROBAR', dias: 14, maximo: 10 })
  assert.equal(r.codigo, 200)
  assert.equal(r.datos.ok, true)
  assert.equal(r.datos.borrados, 1)
  assert.equal(r.datos.bytes_recuperados, 7 * 1024 * 1024)
  assert.deepEqual(borrados, ['Cuervo/viejo.mp4'])
  assert.equal(tablas.docs[0].datos.estado, 'descartado')
  assert.equal(tablas.docs[0].datos.video_path, undefined)
  assert.equal(tablas.docs[0].datos.archivo_reciclado_path, 'Cuervo/viejo.mp4')
  assert.equal(tablas.publicacion_docs[0].coleccion, 'eventos')
  assert.equal(tablas.publicacion_docs[0].datos.accion, 'clip_sin_aprobar_descartado')
})

test.after(() => { globalThis.fetch = originalFetch })
