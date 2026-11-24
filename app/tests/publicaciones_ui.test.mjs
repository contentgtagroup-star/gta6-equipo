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
    fetch: async () => falla
      ? { status: 503, ok: false, headers: { get: () => null }, json: async () => ({ error: 'La base de Publicaciones todavía no está habilitada.' }) }
      : { status: 200, ok: true, headers: { get: () => 'W/"firma"' }, json: async () => ({ conexiones: [], automatico_activo: false }) },
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

test('Conexiones muestra el método System User y avisa los permisos de métricas que faltan', async () => {
  const nodos = {}
  const el = (tag, attrs = {}, ...hijos) => ({
    tag, attrs, children: hijos.flat().filter(Boolean), textContent: '',
    append(...nuevos) { this.children.push(...nuevos) },
    replaceChildren(...nuevos) { this.children = nuevos },
    setAttribute() {}, addEventListener() {}
  })
  const $ = id => nodos[id] ||= el('div')
  const conexiones = [
    { id: 'instagram', nombre: 'Instagram', cuenta_conectada: '@gta6.clipeado', estado: 'conectada', modo: 'automatico', proveedor: 'meta', metodo: 'system_user', faltan_permisos: ['read_insights'], sincronizada_el: null },
    { id: 'facebook', nombre: 'Facebook', cuenta_conectada: 'Gta 6 Clipeados', estado: 'conectada', modo: 'automatico', proveedor: 'meta', metodo: 'system_user', faltan_permisos: [], sincronizada_el: null }
  ]
  const ctx = { S: { clave: 'sesion-ya-validada' }, $, el, window: {}, document: { hidden: false },
    setInterval() {}, toast() {},
    fetch: async () => ({ status: 200, ok: true, headers: { get: () => 'W/"conex"' }, json: async () => ({ conexiones, automatico_activo: true }) }),
    api: async () => ({ conexiones, automatico_activo: true }) }
  const source = readFileSync(new URL('../public/publicaciones.js', import.meta.url), 'utf8')
    .replace(/\}\)\(\)\s*$/, 'window.prueba = { cargar }; })()')
  vm.createContext(ctx); vm.runInContext(source, ctx)
  await new Promise(setImmediate)
  const texto = nodo => [nodo.textContent, ...nodo.children.map(h => typeof h === 'string' ? h : texto(h))].join(' ')
  const salida = texto($('pubContenido'))
  assert.equal((salida.match(/usuario del sistema de Meta/g) || []).length, 2)
  assert.match(salida, /Faltan permisos para métricas: read_insights/)
  assert.doesNotMatch(salida, /Faltan permisos para métricas: read_insights.*read_insights/s)
})

test('la administración de cola renderiza filtros, contador y acciones sin romper', async () => {
  const nodos = {}
  const el = (tag, attrs = {}, ...hijos) => ({
    tag, attrs, children: hijos.flat().filter(Boolean), textContent: typeof hijos[0] === 'string' ? hijos[0] : '',
    append (...n) { this.children.push(...n) }, replaceChildren (...n) { this.children = n },
    setAttribute (k, v) { this.attrs[k] = v }, addEventListener () {}, set onchange (f) {}, set value (v) {}
  })
  const $ = id => (nodos[id] ||= el('div'))
  const cola = [
    { id: 'a', _version: 1, plataforma: 'instagram', titulo: 'Fallado', estado: 'error', error: 'se cayó', aprobado_por: 'Eze', aprobado_el: 1, proximo_el: 1 },
    { id: 'b', _version: 1, plataforma: 'x', titulo: 'En espera', estado: 'pendiente', aprobado_por: 'Eze', aprobado_el: 2, proximo_el: 2 },
    { id: 'c', _version: 1, plataforma: 'youtube', titulo: 'Para revisar', estado: 'revisar', aprobado_por: 'Eze', aprobado_el: 3, proximo_el: 3 }
  ]
  const ctx = { S: { clave: 'ok' }, $, el, window: {}, document: { hidden: false }, setInterval () {}, toast () {}, Date,
    fetch: async () => ({ status: 200, ok: true, headers: { get: () => 'W/"x"' }, json: async () => ({ cola, conexiones: [], automatico_activo: true }) }) }
  const source = readFileSync(new URL('../public/publicaciones.js', import.meta.url), 'utf8')
    .replace(/\}\)\(\)\s*$/, 'window.prueba = { render, P }; })()')
  vm.createContext(ctx); vm.runInContext(source, ctx)
  await new Promise(setImmediate)
  ctx.window.prueba.P.datos = { cola, conexiones: [], sugerencias: [], fuentes: [], trabajos: [], eventos: [], automatico_activo: true }
  ctx.window.prueba.P.tab = 'cola'
  ctx.window.prueba.render()
  const texto = nodo => [nodo.textContent, ...nodo.children.map(h => typeof h === 'string' ? h : texto(h))].join(' ')
  const t = texto($('pubContenido'))
  assert.match(t, /3 en cola/)
  assert.match(t, /1 con error/)
  assert.match(t, /Reintentar fallados \(1\)/)
  assert.match(t, /trabado/)
})
