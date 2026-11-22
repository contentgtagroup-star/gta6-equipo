import test from 'node:test'
import assert from 'node:assert/strict'
import { fuenteValida, contenidoValido, ventanaMetricas, REDES } from '../lib/publicacion.js'
import { cifrarConexion, descifrarConexion, jsonRemoto, configOAuth } from '../lib/conexiones.js'

const contenido = { titulo: 'Una caja escondida en GTA 6', descripcion: '¿Qué encuentra cuando la abre?', plataformas: ['instagram'], media: 'reusar', video_path: 'Eze/clip.mp4' }

test('las fuentes se normalizan y rechazan red interna, credenciales y protocolos inseguros', () => {
  assert.equal(fuenteValida({ url: 'x.com/SourceVI', tipo: 'perfil' }).url, 'https://x.com/SourceVI')
  for (const url of ['http://x.com/uno', 'https://localhost/test', 'https://127.0.0.1', 'https://x.com@evil.test/', 'https://clave:secreto@x.com/uno', 'file:///tmp/uno', 'https://x.com:999/uno']) assert.throws(() => fuenteValida({ url, tipo: 'perfil' }), url)
})

test('el ruteo conserva YouTube y TikTok en borrador', () => {
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

test('la respuesta exitosa de TikTok con error.code=ok se acepta y los errores no filtran tokens', async () => {
  const original = globalThis.fetch
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({ data: { publish_id: 'uno' }, error: { code: 'ok' } }), { status: 200 })
    assert.equal((await jsonRemoto('https://example.test')).data.publish_id, 'uno')
    globalThis.fetch = async () => new Response(JSON.stringify({ error: { code: 'invalid_token', message: 'token-secreto-no-mostrar' } }), { status: 401 })
    await assert.rejects(jsonRemoto('https://example.test'), e => e.status === 424 && !e.message.includes('token-secreto'))
  } finally { globalThis.fetch = original }
})
