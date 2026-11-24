import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFileSync } from 'node:fs'

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8')
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1]

test('biblioteca y publicaciones arrancan ocultas; crear queda visible', () => {
  assert.match(html, /id="biblioteca" data-seccion="biblioteca" hidden/)
  assert.match(html, /id="publicaciones" data-seccion="publicaciones" hidden/)
  assert.doesNotMatch(html, /data-seccion="crear"[^>]*hidden/)
  for (const id of ['sidebar', 'navLibCount', 'biblioteca', 'publicaciones']) {
    assert.equal((html.match(new RegExp(`id="${id}"`, 'g')) || []).length, 1, id)
  }
})

test('irA muestra una sección y dibuja lo pesado solo al entrar', () => {
  const src = script.slice(script.indexOf('const SECCIONES'), script.indexOf('window.estoyEn = estoyEn;') + 'window.estoyEn = estoyEn;'.length)
  const secs = ['crear', 'biblioteca', 'publicaciones', 'links', 'ayuda'].map(k => ({ dataset: { seccion: k }, hidden: false }))
  const botones = ['crear', 'biblioteca', 'publicaciones', 'links', 'ayuda'].map(k => ({ dataset: { ir: k }, setAttribute(n, v) { this[n] = v } }))
  const ctx = {
    S: { seccion: 'crear' },
    document: { querySelectorAll: q => q === '[data-seccion]' ? secs : botones },
    ls() {}, location: { hash: '' }, history: { replaceState() {} },
    window: { scrollTo() {}, publicacionesAlEntrar() { ctx.llamadas.push('pub') } },
    renderLib() { ctx.llamadas.push('lib') }, renderRadar() { ctx.llamadas.push('radar') }, llamadas: []
  }
  vm.createContext(ctx); vm.runInContext(src, ctx)
  ctx.irA('biblioteca')
  assert.deepEqual(secs.map(s => s.hidden), [true, false, true, true, true])
  assert.deepEqual(ctx.llamadas, ['lib'])
  assert.equal(botones.find(b => b.dataset.ir === 'biblioteca')['aria-current'], 'page')
  ctx.irA('publicaciones')
  assert.deepEqual(ctx.llamadas, ['lib', 'pub'])
  assert.equal(ctx.estoyEn('publicaciones'), true)
})

test('Publicaciones no consulta la base hasta que el panel abre su sección', async () => {
  const nodos = {}
  const el = (tag, attrs = {}, ...hijos) => ({
    tag, attrs, children: hijos.flat().filter(Boolean), textContent: '',
    append(...nuevos) { this.children.push(...nuevos) },
    replaceChildren(...nuevos) { this.children = nuevos },
    setAttribute() {}, addEventListener() {}
  })
  const $ = id => nodos[id] ||= el('div')
  let pedidos = 0
  const ctx = {
    S: { clave: 'ok' }, $, el, window: { estoyEn: () => false }, document: { hidden: false },
    setInterval() {}, toast() {},
    fetch: async () => { pedidos++; return { status: 200, ok: true, headers: { get: () => null }, json: async () => ({ conexiones: [], automatico_activo: false }) } },
    api: async () => ({ conexiones: [], automatico_activo: false })
  }
  const source = readFileSync(new URL('../public/publicaciones.js', import.meta.url), 'utf8')
  vm.createContext(ctx); vm.runInContext(source, ctx)
  await new Promise(setImmediate)
  assert.equal(pedidos, 0)
  await ctx.window.publicacionesAlEntrar()
  assert.equal(pedidos, 1)
})
