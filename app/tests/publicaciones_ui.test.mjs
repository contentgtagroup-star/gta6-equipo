import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFileSync } from 'node:fs'

test('Publicaciones conserva la sesión ante un error de base y se recupera al actualizar', async () => {
  const nodos = {}
  const el = (tag, attrs = {}, ...hijos) => ({
    tag, attrs, children: hijos.flat().filter(Boolean), textContent: '',
    append(...nuevos) { this.children.push(...nuevos) },
    replaceChildren(...nuevos) { this.children = nuevos },
    setAttribute(k, v) { this.attrs[k] = v }, addEventListener() {}
  })
  const $ = id => nodos[id] ||= el('div')
  let falla = true
  const ctx = { S: { clave: 'sesion-ya-validada' }, $, el, window: {}, document: { hidden: false },
    setInterval() {}, toast() {},
    api: async () => {
      if (falla) throw Object.assign(new Error('La base de Publicaciones todavía no está habilitada.'), { status: 503 })
      return { conexiones: [], automatico_activo: false }
    } }
  const source = readFileSync(new URL('../public/publicaciones.js', import.meta.url), 'utf8')
    .replace(/\}\)\(\)\s*$/, 'window.prueba = { cargar }; })()')
  vm.createContext(ctx); vm.runInContext(source, ctx)
  await new Promise(setImmediate)
  const texto = nodo => [nodo.textContent, ...nodo.children.map(h => typeof h === 'string' ? h : texto(h))].join(' ')
  assert.match($('pubEstado').textContent, /base.*no está habilitada/)
  assert.match(texto($('pubContenido')), /No necesitás volver a ingresar tu clave/)
  assert.equal(ctx.S.clave, 'sesion-ya-validada')
  falla = false
  await ctx.window.prueba.cargar(true)
  assert.doesNotMatch(texto($('pubContenido')), /clave|Cargando/)
  falla = true
  await ctx.window.prueba.cargar()
  falla = false
  await ctx.window.prueba.cargar()
  assert.doesNotMatch(texto($('pubContenido')), /clave|Cargando/)
  assert.match($('pubEstado').textContent, /preparar y revisar/)
})
test('Aprobar programa con un clic y bloquea el doble clic sin abrir diálogo', async () => {
  const nodos = {}, pedidos = [], mensajes = []
  const el = (tag, attrs = {}, ...children) => ({ tag, attrs, children: children.flat().filter(Boolean), append() {}, replaceChildren(...c) { this.children = c }, setAttribute() {}, addEventListener() {} })
  let terminar
  const espera = new Promise(resolve => { terminar = resolve })
  const ctx = { S: { clave: 'sesion' }, $: id => nodos[id] ||= el('div'), el, window: { cargar: async () => {} }, document: { hidden: false }, setInterval() {}, toast: m => mensajes.push(m),
    api: async (url, body) => {
      if (!body) return { conexiones: [], automatico_activo: true }
      pedidos.push({ url, body }); await espera
      return { programado_el: Date.parse('2026-11-24T16:23:00-03:00') }
    } }
  vm.createContext(ctx); vm.runInContext(readFileSync(new URL('../public/publicaciones.js', import.meta.url), 'utf8'), ctx)
  await new Promise(setImmediate)
  const c = { id: 'clip-uno', _version: 3 }
  const primero = ctx.window.aprobarClipPublicacion(c)
  await ctx.window.aprobarClipPublicacion(c)
  assert.equal(pedidos.length, 1)
  assert.equal(pedidos[0].body.op, 'aprobar_clip')
  assert.equal(pedidos[0].body.plataformas, undefined)
  terminar(); await primero
  assert.match(mensajes[0], /programado.*16:23.*Argentina/)
})
