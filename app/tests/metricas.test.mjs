import test from 'node:test'
import assert from 'node:assert/strict'
import handler from '../api/metricas.js'

Object.assign(process.env, { SUPABASE_URL: 'https://unit.supabase.co', SUPABASE_SERVICE_KEY: 'fixture', TEAM_KEYS: '{"Eze":"clave-de-prueba-suficientemente-larga"}' })
const tabla = []
const original = globalThis.fetch
globalThis.fetch = async (url, opciones = {}) => {
  const u = new URL(url)
  if (u.hostname !== 'unit.supabase.co') throw new Error('sin red en test: ' + u.hostname)
  const coincide = d => [...u.searchParams].every(([k, v]) => v.startsWith('eq.') ? String(d[k]) === v.slice(3) : true)
  const metodo = opciones.method || 'GET'
  let filas = tabla.filter(coincide)
  if (metodo === 'POST') { const dato = JSON.parse(opciones.body); if (tabla.some(d => d.id === dato.id && d.coleccion === dato.coleccion)) return new Response('{"code":"23505"}', { status: 409 }); tabla.push(dato); filas = [dato] }
  else if (metodo === 'PATCH') { const c = JSON.parse(opciones.body); for (const d of filas) Object.assign(d, c) }
  const offset = Number(u.searchParams.get('offset') || 0), limit = Number(u.searchParams.get('limit') || 1000)
  return new Response(JSON.stringify(filas.slice(offset, offset + limit)), { status: 200, headers: { 'Content-Type': 'application/json' } })
}
async function llamada (query) {
  let salida
  const res = { setHeader () {}, status (c) { this.codigo = c; return this }, json (d) { salida = { codigo: this.codigo, datos: d } } }
  await handler({ method: 'GET', query, headers: { 'x-clave': 'clave-de-prueba-suficientemente-larga' }, body: {} }, res)
  return salida
}

test('la serie devuelve los snapshots diarios filtrados por red y ordenados por fecha', async () => {
  tabla.length = 0
  tabla.push(
    { coleccion: 'metricas', id: 'dia-x-2026-11-24', version: 1, datos: { red: 'x', dia: '2026-11-24', seguidores: 100 } },
    { coleccion: 'metricas', id: 'dia-x-2026-11-23', version: 1, datos: { red: 'x', dia: '2026-11-23', seguidores: 90 } },
    { coleccion: 'metricas', id: 'dia-youtube-2026-11-24', version: 1, datos: { red: 'youtube', dia: '2026-11-24', seguidores: 500 } },
    { coleccion: 'metricas', id: 'x-7d', version: 1, datos: { red: 'x', ventana: '7d' } }
  )
  const r = await llamada({ serie: '1', red: 'x' })
  assert.equal(r.codigo, 200)
  assert.deepEqual(r.datos.serie.map(s => s.dia), ['2026-11-23', '2026-11-24'])
  const todas = await llamada({ serie: '1' })
  assert.equal(todas.datos.serie.length, 3)
})

test('la serie rechaza una red inválida', async () => {
  const r = await llamada({ serie: '1', red: 'fotolog' })
  assert.equal(r.codigo, 400)
})

test('la serie separa ventanas del mismo día y conserva las capturas anteriores', async () => {
  tabla.length = 0
  const comun = { coleccion: 'metricas', version: 1 }
  tabla.push(
    { ...comun, id: 'dia-x-2026-11-23', datos: { red: 'x', dia: '2026-11-23', ventana: '7d', impresiones: 5 } },
    { ...comun, id: 'dia-x-2026-11-24', datos: { red: 'x', dia: '2026-11-24', ventana: '7d', impresiones: 10, capturado_el: 1 } },
    { ...comun, id: 'dia-x-2026-11-24-7d', datos: { red: 'x', dia: '2026-11-24', ventana: '7d', impresiones: 20, capturado_el: 2 } },
    { ...comun, id: 'dia-x-2026-11-24-historico', datos: { red: 'x', dia: '2026-11-24', ventana: 'historico', impresiones: 50, capturado_el: 3 } }
  )
  for (const [ventana, esperadas] of [['7d', [5, 20]], ['historico', [50]]]) {
    const r = await llamada({ serie: '1', red: 'x', ventana })
    assert.equal(r.codigo, 200)
    assert.deepEqual(r.datos.serie.map(s => s.impresiones), esperadas)
  }
  assert.equal((await llamada({ serie: '1', red: 'x', ventana: 'otra' })).codigo, 400)
})

test.after(() => { globalThis.fetch = original })
