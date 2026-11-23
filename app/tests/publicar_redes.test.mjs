import test from 'node:test'
import assert from 'node:assert/strict'
import { pasoPublicacion } from '../lib/publicar_redes.js'
import { cifrarConexion } from '../lib/conexiones.js'

Object.assign(process.env, { SUPABASE_URL: 'https://unit.supabase.co', SUPABASE_SERVICE_KEY: 'fixture', PUBLICACION_CIPHER_KEY: Buffer.alloc(32, 3).toString('base64'), BUFFER_API_KEY: 'fixture', BUFFER_CHANNEL_ID: 'canal-x' })
const original = globalThis.fetch, llamadas = []
const respuesta = (d, status = 200) => new Response(JSON.stringify(d), { status, headers: { 'Content-Type': 'application/json' } })
const item = plataforma => ({ plataforma, video_path: 'Eze/clip.mp4', titulo: 'Una caja escondida', descripcion: '¿Qué tiene adentro?', hashtags: ['#GTA6'], aprobado_por: 'Eze' })
let red = '', enviado = false
globalThis.fetch = async (url, op = {}) => {
  const u = new URL(url); llamadas.push({ url: u.href, op })
  if (u.hostname === 'unit.supabase.co') {
    if (u.pathname.startsWith('/rest/')) {
      const p = u.searchParams.get('id').slice(3)
      return respuesta([{ id: p, version: 1, datos: { sobre: cifrarConexion(p, { access_token: 'fixture', page_id: 'pagina', ig_id: 'ig', expira_el: Date.now() + 9999999 }) } }])
    }
    if (u.pathname.includes('/sign/')) return respuesta({ signedURL: '/object/sign/clips/Eze/clip.mp4?token=fixture' })
    return new Response('video-fixture', { status: 200, headers: { 'Content-Type': 'video/mp4' } })
  }
  if (red === 'youtube' && u.hostname === 'www.googleapis.com') return respuesta({ id: 'yt-uno' })
  if (red === 'tiktok' && u.pathname.endsWith('/inbox/video/init/')) return respuesta({ data: { publish_id: 'tt-uno', upload_url: 'https://upload.tiktokapis.com/video/uno' }, error: { code: 'ok' } })
  if (red === 'tiktok' && u.hostname === 'upload.tiktokapis.com') return new Response('', { status: 201 })
  if (red === 'tiktok' && u.pathname.endsWith('/status/fetch/')) return respuesta({ data: { status: 'SEND_TO_USER_INBOX' }, error: { code: 'ok' } })
  if (red === 'x' && u.hostname === 'api.buffer.com') {
    const { query } = JSON.parse(op.body)
    if (query.includes('channel(')) return respuesta({ data: { channel: { service: 'twitter', isDisconnected: false, isLocked: false } } })
    return respuesta({ data: { createPost: { post: { id: 'buf-uno', sentAt: '2026-11-22T12:00:00Z', externalLink: 'https://x.com/cuenta/status/123' } } } })
  }
  if (red === 'facebook' && u.pathname.endsWith('/video')) return respuesta({ status: { processing_phase: { status: 'completed' }, publishing_phase: { publish_status: enviado ? 'published' : 'draft' } } })
  if (red === 'facebook' && u.pathname.endsWith('/video_reels')) { enviado = true; return respuesta({ success: true }) }
  throw new Error('Solicitud inesperada: ' + u.href)
}
test('YouTube sube privado aunque el destino sea un Short', async () => {
  red = 'youtube'; llamadas.length = 0
  const pasos = [], d = await pasoPublicacion(item(red), async p => pasos.push(p))
  assert.equal(d.estado, 'borrador')
  const subida = llamadas.find(l => l.url.includes('/upload/youtube/'))
  assert.match(subida.op.body.toString(), /"privacyStatus":"private"/)
  assert.ok(!subida.op.body.toString().includes('"privacyStatus":"public"'))
  assert.equal(pasos[0].etapa, 'subiendo_borrador')
})
test('TikTok transfiere el archivo al Inbox y espera su confirmación', async () => {
  red = 'tiktok'; llamadas.length = 0
  const pasos = [], d = await pasoPublicacion(item(red), async p => pasos.push(p))
  assert.equal(d.remoto_id, 'tt-uno')
  assert.equal(pasos[0].remoto_id, 'tt-uno')
  assert.equal(JSON.parse(llamadas.find(l => l.url.includes('/inbox/')).op.body).source_info.source, 'FILE_UPLOAD')
  assert.ok(llamadas.some(l => l.op.method === 'PUT'))
  assert.equal((await pasoPublicacion({ ...item(red), remoto_id: 'tt-uno' }, async () => {})).estado, 'borrador')
})
test('X verifica el canal y publica por Buffer, sin usar la API de X', async () => {
  red = 'x'; llamadas.length = 0
  const d = await pasoPublicacion(item(red), async () => {})
  assert.equal(d.estado, 'publicado')
  const mutation = llamadas.find(l => l.url === 'https://api.buffer.com/' && JSON.parse(l.op.body).query.includes('createPost'))
  assert.match(JSON.parse(mutation.op.body).query, /mode: shareNow/)
  assert.ok(llamadas.every(l => !new URL(l.url).hostname.endsWith('x.com')))
})
test('Facebook espera confirmación sin repetir finish', async () => {
  red = 'facebook'; llamadas.length = 0; enviado = false
  assert.equal((await pasoPublicacion({ ...item(red), remoto_id: 'video', etapa: 'procesando' }, async () => {})).etapa, 'confirmando')
  assert.equal((await pasoPublicacion({ ...item(red), remoto_id: 'video', etapa: 'confirmando' }, async () => {})).estado, 'publicado')
  assert.equal(llamadas.filter(l => l.url.includes('/video_reels')).length, 1)
})
test.after(() => { globalThis.fetch = original })
