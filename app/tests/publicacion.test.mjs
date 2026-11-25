import test from 'node:test'
import assert from 'node:assert/strict'
import { fuenteValida, contenidoValido, ventanaMetricas, REDES, cadenciaValida } from '../lib/publicacion.js'

test('cadenciaValida limpia por_dia, horarios y zona horaria', () => {
  const c = cadenciaValida({ por_red: { instagram: { por_dia: 999, horarios: ['10:00', '25:99', '14:30', '10:00'] }, x: { por_dia: -3 } }, zona_horaria: 'rm -rf', activo: true })
  assert.equal(c.por_red.instagram.por_dia, 50)
  assert.deepEqual(c.por_red.instagram.horarios, ['10:00', '14:30'])
  assert.equal(c.por_red.x.por_dia, 0)
  assert.equal(c.zona_horaria, 'America/Argentina/Cordoba')
  assert.equal(c.activo, true)
  for (const red of Object.keys(REDES)) assert.ok(c.por_red[red], 'cada red presente: ' + red)
})
import { cifrarConexion, descifrarConexion, jsonRemoto, configOAuth } from '../lib/conexiones.js'
import { leerPub, listarPub } from '../lib/publicacion_store.js'

const contenido = { titulo: 'Una caja escondida en GTA 6', descripcion: '¿Qué encuentra cuando la abre?', plataformas: ['instagram'], media: 'reusar', video_path: 'Eze/clip.mp4' }

test('la lectura distingue tabla pendiente de un fallo de conexión sin filtrar el error interno', async () => {
  for (const code of ['PGRST205', '42P01', 'PGRST000']) {
    const error = { code, message: 'detalle-interno-no-mostrar' }
    const q = { select: () => q, eq: () => q, order: () => q,
      maybeSingle: async () => ({ error }), range: async () => ({ error }) }
    const sb = { from: () => q }
    for (const leer of [() => leerPub('fuentes', 'f1', sb), () => listarPub('fuentes', sb)]) {
      await assert.rejects(leer, e => e.status === 503 && !e.message.includes(error.message) &&
        (code === 'PGRST000' ? /conexión/.test(e.message) : /Supabase/.test(e.message)))
    }
  }
})

test('las fuentes se normalizan y rechazan red interna, credenciales y protocolos inseguros', () => {
  assert.equal(fuenteValida({ url: 'x.com/SourceVI', tipo: 'perfil' }).url, 'https://x.com/SourceVI')
  for (const url of ['http://x.com/uno', 'https://localhost/test', 'https://127.0.0.1', 'https://x.com@evil.test/', 'https://clave:secreto@x.com/uno', 'file:///tmp/uno', 'https://x.com:999/uno']) assert.throws(() => fuenteValida({ url, tipo: 'perfil' }), url)
})

test('acepta Facebook (incluido m.facebook.com) como fuente', () => {
  assert.equal(fuenteValida({ url: 'https://facebook.com/gta6/posts/123', tipo: 'publicacion' }).plataforma, 'Facebook')
  assert.equal(fuenteValida({ url: 'https://m.facebook.com/gta6/posts/123', tipo: 'publicacion' }).plataforma, 'Facebook')
})

test('el ruteo conserva YouTube y TikTok en borrador y el resto automático', () => {
  assert.equal(REDES.youtube.modo, 'borrador')
  assert.equal(REDES.tiktok.modo, 'borrador')
  for (const r of ['instagram', 'facebook', 'x']) assert.equal(REDES[r].modo, 'automatico')
})

test('no acepta videos externos ni mezcla imágenes y video ni destinos inventados', () => {
  assert.deepEqual(contenidoValido(contenido).imagenes, [])
  assert.throws(() => contenidoValido({ ...contenido, video_path: 'https://evil.test/clip.mp4' }))
  assert.throws(() => contenidoValido({ ...contenido, imagenes: ['Eze/imagen.png'] }))
  assert.throws(() => contenidoValido({ ...contenido, plataformas: ['otra'] }))
  assert.throws(() => contenidoValido({ ...contenido, plataformas: [] }))
  assert.throws(() => contenidoValido({ ...contenido, titulo: 'a'.repeat(61) }))
  assert.throws(() => contenidoValido({ ...contenido, video_path: '', imagenes: ['../clave.png'] }))
})

test('compara períodos equivalentes y no fabrica una ventana previa al histórico', () => {
  const v = ventanaMetricas('7d', 2000000000)
  assert.equal(v.hasta - v.desde, v.anterior_hasta - v.anterior_desde)
  assert.equal(ventanaMetricas('historico').anterior_desde, null)
})

test('los tokens quedan cifrados, autenticados y ligados a su proveedor', () => {
  process.env.PUBLICACION_CIPHER_KEY = Buffer.alloc(32, 1).toString('base64')
  const datos = { access_token: 'token-de-prueba', refresh_token: 'refresco-de-prueba' }
  const sobre = cifrarConexion('google', datos)
  assert.ok(!JSON.stringify(sobre).includes(datos.access_token))
  assert.deepEqual(descifrarConexion('google', sobre), datos)
  assert.throws(() => descifrarConexion('meta', sobre))
  assert.throws(() => descifrarConexion('google', { ...sobre, tag: Buffer.alloc(16).toString('base64') }))
})

test('TikTok pide video.upload y usa un callback sin query', () => {
  Object.assign(process.env, { PUBLICACION_ORIGIN: 'https://equipo.example', TIKTOK_CLIENT_KEY: 'prueba', TIKTOK_CLIENT_SECRET: 'prueba' })
  const c = configOAuth('tiktok')
  assert.ok(c.scope.split(',').includes('video.upload'))
  assert.ok(!c.scope.split(',').includes('video.publish'))
  assert.equal(c.callback, 'https://equipo.example/api/conexion/tiktok')
})

test('TikTok sandbox usa sus propias claves y solicita los permisos de métricas', () => {
  const nombres = ['TIKTOK_ENV', 'TIKTOK_SANDBOX_CLIENT_KEY', 'TIKTOK_SANDBOX_CLIENT_SECRET']
  const antes = nombres.map(n => process.env[n])
  try {
    Object.assign(process.env, { TIKTOK_ENV: 'sandbox', TIKTOK_SANDBOX_CLIENT_KEY: 'sandbox-prueba', TIKTOK_SANDBOX_CLIENT_SECRET: 'sandbox-secreto-prueba' })
    const c = configOAuth('tiktok')
    assert.equal(c.id, 'sandbox-prueba')
    assert.equal(c.secret, 'sandbox-secreto-prueba')
    assert.deepEqual(c.scope.split(','), ['user.info.basic', 'user.info.stats', 'video.upload', 'video.list'])
    delete process.env.TIKTOK_SANDBOX_CLIENT_SECRET
    assert.throws(() => configOAuth('tiktok'), /Falta configurar/)
  } finally {
    nombres.forEach((n, i) => { if (antes[i] === undefined) delete process.env[n]; else process.env[n] = antes[i] })
  }
})

test('la respuesta exitosa de TikTok con error.code=ok se acepta y los errores no filtran tokens', async () => {
  const original = globalThis.fetch
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({ data: { publish_id: 'uno' }, error: { code: 'ok' } }), { status: 200 })
    assert.equal((await jsonRemoto('https://example.test')).data.publish_id, 'uno')
    globalThis.fetch = async () => new Response(JSON.stringify({ error: { code: 'invalid_token', message: 'token-secreto-no-mostrar' } }), { status: 401 })
    await assert.rejects(jsonRemoto('https://example.test'), e => e.status === 424 && !e.message.includes('token-secreto'))
  } finally { globalThis.fetch = original }
})

test('Meta distingue token inválido de permiso denegado', async () => {
  const original = globalThis.fetch
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({ error: { code: 190, message: 'token-no-mostrar' } }), { status: 400 })
    await assert.rejects(jsonRemoto('https://graph.facebook.com/v27.0/me'), e => e.codigoRemoto === 'invalid_token' && !e.message.includes('no-mostrar'))
    globalThis.fetch = async () => new Response(JSON.stringify({ error: { code: 200, message: 'permiso-no-mostrar' } }), { status: 403 })
    await assert.rejects(jsonRemoto('https://graph.facebook.com/v27.0/me'), e => e.remoto === 403 && !e.codigoRemoto && !e.message.includes('no-mostrar'))
  } finally { globalThis.fetch = original }
})

test('los errores OAuth y de perfil de TikTok se explican sin mostrar descripciones privadas', async () => {
  const original = globalThis.fetch
  try {
    for (const [error, esperado] of [
      ['invalid_client', 'invalid_client'],
      ['invalid_grant', 'invalid_grant'],
      [{ code: 'scope_permission_missed', message: 'token-no-mostrar' }, 'scope_permission_missed'],
      ['texto-secreto-no-mostrar', 'error_no_identificado']
    ]) {
      globalThis.fetch = async () => new Response(JSON.stringify({ error, error_description: 'token-no-mostrar' }), { status: 400 })
      await assert.rejects(jsonRemoto('https://open.tiktokapis.com/v2/oauth/token/'), e =>
        e.codigoRemoto === esperado && e.remoto === 400 && !e.message.includes('no-mostrar'))
    }
    globalThis.fetch = async () => new Response(JSON.stringify({ error: 'invalid_request', error_description: 'Redirect_uri is not matched; token-no-mostrar' }), { status: 400 })
    await assert.rejects(jsonRemoto('https://open.tiktokapis.com/v2/oauth/token/'), e => e.codigoRemoto === 'redirect_uri_mismatch' && !e.message.includes('no-mostrar'))
  } finally { globalThis.fetch = original }
})
