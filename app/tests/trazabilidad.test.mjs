import test from 'node:test'
import assert from 'node:assert/strict'
import handler from '../api/trazabilidad.js'

Object.assign(process.env, { SUPABASE_URL: 'https://unit.supabase.co', SUPABASE_SERVICE_KEY: 'fixture', TEAM_KEYS: '{"Eze":"clave-de-prueba-suficientemente-larga"}' })
const tabla = []
const original = globalThis.fetch
const campo = (d, k) => (k.startsWith('datos->>') ? d.datos?.[k.slice(8)] : d[k])
globalThis.fetch = async (url) => {
  const u = new URL(url)
  if (u.hostname !== 'unit.supabase.co') throw new Error('sin red en test')
  let filas = tabla.filter(d => [...u.searchParams].every(([k, v]) => {
    const val = campo(d, k)
    if (v.startsWith('eq.')) return String(val) === v.slice(3)
    if (v.startsWith('gte.')) return Number(val) >= Number(v.slice(4))
    if (v.startsWith('lte.')) return Number(val) <= Number(v.slice(4))
    return true
  }))
  filas = filas.sort((a, b) => b.datos.el - a.datos.el || (a.id < b.id ? 1 : -1))
  const limit = Number(u.searchParams.get('limit') || 1000)
  return new Response(JSON.stringify(filas.slice(0, limit)), { status: 200, headers: { 'Content-Type': 'application/json' } })
}
async function llamada (query) {
  let salida
  const res = { setHeader () {}, status (c) { this.codigo = c; return this }, json (d) { salida = { codigo: this.codigo, datos: d } } }
  await handler({ method: 'GET', query, headers: { 'x-clave': 'clave-de-prueba-suficientemente-larga' }, body: {} }, res)
  return salida
}
const ev = (id, datos) => ({ coleccion: 'eventos', id, version: 1, datos: { el: 1, ...datos } })

test('trazabilidad filtra por plataforma y acción, ordena por fecha desc', async () => {
  tabla.length = 0
  tabla.push(
    ev('a', { el: 100, accion: 'publicado', plataforma: 'x' }),
    ev('b', { el: 200, accion: 'error', plataforma: 'x' }),
    ev('c', { el: 150, accion: 'publicado', plataforma: 'instagram' })
  )
  const porRed = await llamada({ plataforma: 'x' })
  assert.equal(porRed.codigo, 200)
  assert.deepEqual(porRed.datos.eventos.map(e => e.id), ['b', 'a'])
  const porAccion = await llamada({ accion: 'publicado' })
  assert.deepEqual(porAccion.datos.eventos.map(e => e.id).sort(), ['a', 'c'])
})

test('trazabilidad filtra por rango de fechas', async () => {
  const r = await llamada({ desde: '120', hasta: '180' })
  assert.deepEqual(r.datos.eventos.map(e => e.id), ['c'])
})

test('trazabilidad rechaza una plataforma inválida', async () => {
  assert.equal((await llamada({ plataforma: 'fotolog' })).codigo, 400)
})

test.after(() => { globalThis.fetch = original })
