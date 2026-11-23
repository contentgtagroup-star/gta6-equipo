import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFileSync } from 'node:fs'
import { createHash, timingSafeEqual } from 'node:crypto'

function conexion (fallarPerfil = false) {
  const llamadas = [], logs = []
  let guardada
  const src = readFileSync(new URL('../api/conexion/[proveedor].js', import.meta.url), 'utf8')
    .replace(/^import .*\n/gm, '').replace('export default async function handler', 'async function handler')
  const ctx = {
    createHash, timingSafeEqual, Buffer, URL, URLSearchParams,
    leerPub: async col => col === 'oauth' ? { datos: { proveedor: 'tiktok', vence: Date.now() + 60000, por: 'Cuervo' }, version: 1 } : null,
    guardarPub: async () => {}, eventoPub: async () => {},
    guardarConexion: async (p, datos) => { guardada = datos },
    configOAuth: () => ({ id: 'cliente-de-prueba', secret: 'secreto-de-prueba', token: 'https://open.tiktokapis.com/v2/oauth/token/', callback: 'https://panel.example/api/conexion/tiktok' }),
    origenApp: () => 'https://panel.example',
    errorPublicacion: (m, status = 400) => Object.assign(new Error(m), { status }),
    console: { warn: (...args) => logs.push(args) },
    jsonRemoto: async (url, opciones) => {
      llamadas.push({ url, opciones })
      if (url.includes('/oauth/token/')) return { access_token: 'acceso-privado', refresh_token: 'refresco-privado', expires_in: 3600 }
      if (fallarPerfil) throw Object.assign(new Error('TikTok (scope_permission_missed): falta un permiso'), { status: 502, remoto: 400, codigoRemoto: 'scope_permission_missed' })
      return { data: { user: { display_name: 'Cuenta del equipo' } } }
    }
  }
  vm.createContext(ctx); vm.runInContext(src, ctx)
  const state = 'a'.repeat(64)
  const req = { method: 'GET', query: { proveedor: 'tiktok', state, code: 'codigo-privado' }, headers: { cookie: 'gta6_oauth_tiktok=' + state } }
  const res = { setHeader() {}, status(codigo) { this.codigo = codigo; return this }, send(m) { this.mensaje = m }, writeHead(c, h) { this.codigo = c; this.destino = h.Location }, end() {} }
  return { ejecutar: () => ctx.handler(req, res), res, llamadas, logs, guardada: () => guardada }
}

test('TikTok intercambia el código como formulario, consulta el perfil y guarda la conexión', async () => {
  const c = conexion()
  await c.ejecutar()
  assert.equal(c.llamadas[0].opciones.headers['Content-Type'], 'application/x-www-form-urlencoded')
  assert.equal(c.llamadas[0].opciones.body.get('code'), 'codigo-privado')
  assert.equal(c.llamadas[0].opciones.body.get('redirect_uri'), 'https://panel.example/api/conexion/tiktok')
  assert.equal(c.llamadas[1].opciones.method, undefined)
  assert.equal(c.guardada().cuenta, 'Cuenta del equipo')
  assert.equal(c.res.codigo, 303)
  assert.equal(c.logs.length, 0)
})

test('un rechazo del perfil identifica la etapa sin imprimir códigos de autorización ni tokens', async () => {
  const c = conexion(true)
  await c.ejecutar()
  assert.equal(c.res.codigo, 502)
  assert.equal(c.logs[0][1].etapa, 'consultar_cuenta')
  assert.equal(c.logs[0][1].codigo, 'scope_permission_missed')
  assert.doesNotMatch(JSON.stringify(c.logs), /codigo-privado|acceso-privado|refresco-privado|secreto-de-prueba/)
  assert.equal(c.guardada(), undefined)
})
