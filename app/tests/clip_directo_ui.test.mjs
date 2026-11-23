import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFileSync } from 'node:fs'

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8')
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1]

function baseNodes () {
  const fb = { children: [], textContent: '', replaceChildren (...x) { this.children = x } }
  const nodes = {
    clipDirectoIn: { value: '' },
    clipDirectoNota: { value: '' },
    btnClipDirecto: { disabled: false },
    btnAlimentar: { disabled: false },
    clipDirectoFeedback: fb,
    clipDirectoForm: { addEventListener (tipo, fn) { this[tipo] = fn } },
  }
  return nodes
}

function contexto (nodes, { api, state = {} } = {}) {
  const llamadas = []
  const toasts = []
  const ctx = {
    S: { yo: 'Cuervo', escucha: { Cuervo: { version: 46 } }, versionActual: 46, categoria: '', radar: { videos: [] }, ...state },
    $: id => nodes[id] || { addEventListener () {} },
    el: (tag, attrs = {}, ...children) => ({ tag, attrs, children }),
    api: async (ruta, cuerpo) => { llamadas.push({ ruta, cuerpo }); return api ? api(ruta, cuerpo) : {} },
    toast: t => toasts.push(t),
    cargar: async () => {},
    renderTurno: () => {},
    URL, Number, JSON, Date, String
  }
  vm.createContext(ctx)
  const inicio = script.indexOf('function leerLink')
  const fin = script.indexOf('function renderSetup')
  vm.runInContext(script.slice(inicio, fin), ctx)
  return { ctx, llamadas, toasts }
}

test('hay un solo formulario de clip directo, con nota, botones y feedback', () => {
  new vm.Script(script)
  for (const id of ['clipDirectoForm', 'clipDirectoIn', 'clipDirectoNota', 'btnClipDirecto', 'btnAlimentar', 'clipDirectoFeedback']) {
    assert.equal((html.match(new RegExp(`id="${id}"`, 'g')) || []).length, 1, id)
  }
  assert.ok(html.indexOf('id="clipDirectoForm"') < html.indexOf('id="pasosBox"'))
  assert.match(html, /id="btnAlimentar"[^>]*>ALIMENTAR</)
  assert.doesNotMatch(html, /id="(?:refs|refsBox|linkForm|btnClipDirectoCola)"/)
})

test('cada botón ejecuta su acción y Enter alimenta sin pedir un clip', () => {
  const nodes = baseNodes(), { ctx } = contexto(nodes)
  const acciones = []
  ctx.alimentarReferencia = () => acciones.push('alimentar')
  ctx.procesarClipDirecto = () => acciones.push('clip')
  for (const id of ['btnAlimentar', 'btnClipDirecto', undefined]) {
    nodes.clipDirectoForm.submit({ preventDefault () {}, submitter: id ? { id } : null })
  }
  assert.deepEqual(acciones, ['alimentar', 'clip', 'alimentar'])
})

test('CREAR CLIP envía enlace, plataforma y nota, y no toca el radar', async () => {
  const nodes = baseNodes()
  nodes.clipDirectoIn.value = 'https://youtu.be/dQw4w9WgXcQ?t=30'
  nodes.clipDirectoNota.value = '  El momento del robo  '
  const { ctx, llamadas } = contexto(nodes, { api: async ruta => ruta === '/api/turno' ? { asignado: 'Cuervo' } : {} })
  await ctx.procesarClipDirecto(false)
  const turno = llamadas.find(x => x.ruta === '/api/turno')
  assert.ok(turno)
  assert.equal(JSON.stringify(turno.cuerpo), JSON.stringify({
    op: 'pedir', cantidad: 1, fuente: 'youtube',
    video_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', video_id: 'dQw4w9WgXcQ', video_plataforma: 'youtube',
    nota: 'El momento del robo'
  }))
  assert.equal(llamadas.some(x => x.ruta.startsWith('/api/doc')), false)
  assert.equal(nodes.clipDirectoIn.value, '')
  assert.equal(nodes.clipDirectoNota.value, '')
})

test('si el servidor rechaza el enlace, no borra el formulario ni finge éxito', async () => {
  const nodes = baseNodes()
  nodes.clipDirectoIn.value = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
  nodes.clipDirectoNota.value = 'nota del momento'
  const { ctx, toasts } = contexto(nodes, { api: async () => { throw new Error('Ese enlace ya se usó para un clip. Pegá otro.') } })
  await ctx.procesarClipDirecto(false)
  assert.equal(nodes.clipDirectoIn.value, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ')
  assert.equal(nodes.clipDirectoNota.value, 'nota del momento')
  assert.match(JSON.stringify(nodes.clipDirectoFeedback.children), /ya se usó/)
  assert.match(toasts.join(' '), /ya se usó/)
})

test('ALIMENTAR guarda la referencia y nota sin crear pedido ni tocar radar, incluso sin motor activo', async () => {
  const nodes = baseNodes()
  nodes.clipDirectoIn.value = 'https://clips.twitch.tv/SomeClipSlug'
  nodes.clipDirectoNota.value = 'nota para la IA'
  let referencias = { items: [] }
  const { ctx, llamadas } = contexto(nodes, {
    state: { escucha: {} },
    api: async (ruta, cuerpo) => {
      assert.ok(!ruta.includes('radar'))
      if (ruta.startsWith('/api/doc?')) return { existe: true, datos: referencias, version: 1 }
      if (ruta === '/api/doc') { assert.equal(cuerpo.col, 'fuentes'); assert.equal(cuerpo.id, 'referencias'); referencias = cuerpo.datos; return { ok: true } }
      throw new Error('no debería crear pedido')
    }
  })
  await ctx.alimentarReferencia()
  assert.equal(llamadas.some(x => x.ruta === '/api/turno'), false)
  assert.equal(referencias.items[0].id, 'twitch_cSomeClipSlug')
  assert.equal(referencias.items[0].nota, 'nota para la IA')
  assert.equal(referencias.items[0].agregado_por, 'Cuervo')
  assert.equal(nodes.clipDirectoIn.value, '')
})

test('ALIMENTAR no duplica referencias y conserva el formulario si falla el guardado', async () => {
  for (const falla of [false, true]) {
    const nodes = baseNodes()
    nodes.clipDirectoIn.value = 'https://youtu.be/dQw4w9WgXcQ'
    const { ctx, toasts } = contexto(nodes, {
      api: async ruta => {
        if(falla) throw new Error('No se pudo guardar')
        assert.ok(ruta.startsWith('/api/doc?'))
        return { existe: true, datos: { items: [{ id: 'dQw4w9WgXcQ' }] }, version: 1 }
      }
    })
    await ctx.alimentarReferencia()
    assert.match(toasts.join(' '), falla ? /No se pudo guardar/ : /ya estaba guardado/)
    assert.equal(nodes.clipDirectoIn.value, falla ? 'https://youtu.be/dQw4w9WgXcQ' : '')
    assert.equal(nodes.btnAlimentar.disabled, false)
    assert.equal(nodes.btnClipDirecto.disabled, false)
  }
})
