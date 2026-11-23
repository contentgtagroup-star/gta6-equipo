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
    btnClipDirectoCola: { disabled: false, addEventListener () {} },
    clipDirectoFeedback: fb,
    clipDirectoForm: { addEventListener () {} },
    linkForm: { addEventListener () {} },
    refs: { children: [], replaceChildren (...x) { this.children = x }, append (...x) { this.children.push(...x) } },
    refsCount: { textContent: '' }
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
  const fin = script.indexOf('async function borrarReferencia')
  vm.runInContext(script.slice(inicio, fin), ctx)
  return { ctx, llamadas, toasts }
}

test('hay un solo formulario de clip directo, con nota, botones y feedback', () => {
  for (const id of ['clipDirectoForm', 'clipDirectoIn', 'clipDirectoNota', 'btnClipDirecto', 'btnClipDirectoCola', 'clipDirectoFeedback']) {
    assert.equal((html.match(new RegExp(`id="${id}"`, 'g')) || []).length, 1, id)
  }
  assert.ok(html.indexOf('id="clipDirectoForm"') < html.indexOf('id="refsBox"'))
  assert.match(html, /Referencias para la IA \(<span id="refsCount">/)
})

test('renderReferencias actualiza el contador plegable', () => {
  const nodes = baseNodes()
  const { ctx } = contexto(nodes, { state: { referencias: [{ id: 'a', url: 'https://a', plataforma: 'YouTube' }, { id: 'b', url: 'https://b', plataforma: 'Twitch' }] } })
  const inicio = script.indexOf('function renderReferencias')
  const fin = script.indexOf('function renderSetup')
  vm.runInContext(script.slice(inicio, fin), ctx)
  ctx.renderReferencias()
  assert.equal(nodes.refsCount.textContent, '2')
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

test('Solo a la cola guarda el link en radar y no crea un pedido directo', async () => {
  const nodes = baseNodes()
  nodes.clipDirectoIn.value = 'https://clips.twitch.tv/SomeClipSlug'
  nodes.clipDirectoNota.value = 'nota para el radar'
  let radar = { videos: [] }
  const { ctx, llamadas } = contexto(nodes, {
    api: async (ruta, cuerpo) => {
      if (ruta.startsWith('/api/doc?')) return { existe: true, datos: radar, version: 1 }
      if (ruta === '/api/doc') { radar = cuerpo.datos; return { ok: true } }
      throw new Error('no debería crear pedido')
    }
  })
  await ctx.procesarClipDirecto(true)
  assert.equal(llamadas.some(x => x.ruta === '/api/turno'), false)
  assert.equal(radar.videos[0].id, 'twitch_cSomeClipSlug')
  assert.equal(radar.videos[0].nota, 'nota para el radar')
  assert.equal(radar.videos[0].para, 'Cuervo')
})

test('Solo a la cola no revive un link ya usado ni uno tomado', async () => {
  for (const estado of ['hecho', 'tomado']) {
    const nodes = baseNodes()
    nodes.clipDirectoIn.value = 'https://youtu.be/dQw4w9WgXcQ'
    const { ctx, toasts } = contexto(nodes, {
      api: async ruta => ruta.startsWith('/api/doc?')
        ? { existe: true, datos: { videos: [{ id: 'dQw4w9WgXcQ', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', estado }] }, version: 1 }
        : { ok: true }
    })
    await ctx.procesarClipDirecto(true)
    assert.match(toasts.join(' '), estado === 'hecho' ? /ya se usó/ : /otra compu o pedido/)
    assert.equal(nodes.clipDirectoIn.value, 'https://youtu.be/dQw4w9WgXcQ')
  }
})
