import test from 'node:test'
import assert from 'node:assert/strict'

const clave = 'clave-de-prueba-suficientemente-larga'
Object.assign(process.env, {
  SUPABASE_URL: 'https://mime-test.supabase.co',
  SUPABASE_SERVICE_KEY: 'fixture',
  TEAM_KEYS: JSON.stringify({ Cuervo: clave, Eze: 'clave-de-eze-suficientemente-larga' })
})

const bucket = {
  id: 'clips',
  name: 'clips',
  public: false,
  file_size_limit: 14680064,
  allowed_mime_types: ['video/mp4', 'image/png']
}
const llamadas = []

globalThis.fetch = async (url, opciones = {}) => {
  const u = new URL(url)
  assert.equal(u.hostname, 'mime-test.supabase.co')
  assert.equal(u.pathname, '/storage/v1/bucket/clips')
  llamadas.push({ metodo: opciones.method || 'GET', cuerpo: opciones.body && JSON.parse(opciones.body), headers: opciones.headers })
  if (opciones.method === 'PUT') Object.assign(bucket, JSON.parse(opciones.body))
  return Response.json(bucket)
}

const { default: handler } = await import('../api/mime-clips.js')
async function llamar (body, method = 'POST', xClave = clave) {
  let salida
  const res = { setHeader () {}, status (codigo) { this.codigo = codigo; return this }, json (datos) { salida = { codigo: this.codigo, datos } } }
  await handler({ method, headers: { 'x-clave': xClave }, query: {}, body }, res)
  return salida
}

test('GET informa los MIME actuales sin modificar nada', async () => {
  llamadas.length = 0
  const r = await llamar(null, 'GET')
  assert.equal(r.codigo, 200)
  assert.deepEqual(r.datos.mime_actuales, ['video/mp4', 'image/png'])
  assert.deepEqual(r.datos.mime_finales, ['video/mp4', 'image/png', 'image/jpeg'])
  assert.equal(llamadas.length, 1)
  assert.equal(llamadas[0].metodo, 'GET')
})

test('POST agrega image/jpeg conservando tipos, privacidad y límite', async () => {
  llamadas.length = 0
  const r = await llamar({ op: 'habilitar_jpeg' })
  assert.equal(r.codigo, 200)
  assert.equal(r.datos.ok, true)
  assert.deepEqual(r.datos.mime_despues, ['video/mp4', 'image/png', 'image/jpeg'])
  assert.equal(r.datos.publico, false)
  const put = llamadas.find(c => c.metodo === 'PUT')
  assert.deepEqual(put.cuerpo.allowed_mime_types, ['video/mp4', 'image/png', 'image/jpeg'])
  assert.equal(put.cuerpo.public, false)
  assert.equal(put.cuerpo.file_size_limit, 14680064)
  assert.equal(put.headers.apikey, 'fixture')
})

test('POST es idempotente', async () => {
  llamadas.length = 0
  const r = await llamar({ op: 'habilitar_jpeg' })
  assert.equal(r.codigo, 200)
  assert.equal(llamadas.filter(c => c.metodo === 'PUT').length, 0)
})

test('otro integrante no puede cambiar la configuración', async () => {
  llamadas.length = 0
  const r = await llamar({ op: 'habilitar_jpeg' }, 'POST', 'clave-de-eze-suficientemente-larga')
  assert.equal(r.codigo, 403)
  assert.equal(llamadas.length, 0)
})

test('sin clave no pasa', async () => {
  llamadas.length = 0
  const r = await llamar({ op: 'habilitar_jpeg' }, 'POST', '')
  assert.equal(r.codigo, 401)
  assert.equal(llamadas.length, 0)
})
