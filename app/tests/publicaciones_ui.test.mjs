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
