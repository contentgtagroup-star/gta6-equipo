import test from 'node:test'
import assert from 'node:assert/strict'
import handler from '../api/herramienta.js'

Object.assign(process.env, {
  TEAM_KEYS: JSON.stringify({ Eze: 'clave-de-prueba-suficientemente-larga' }),
  SUPABASE_URL: 'https://unit.supabase.co', SUPABASE_SERVICE_KEY: 'fixture'
})

function pedir (nombre, conClave = true) {
  let out
  const res = { setHeader () {}, status (c) { this.c = c; return this }, send (b) { out = { c: this.c, body: b } }, json (d) { out = { c: this.c, body: d } } }
  return handler({ method: 'GET', query: { nombre }, headers: conClave ? { 'x-clave': 'clave-de-prueba-suficientemente-larga' } : {} }, res).then(() => out)
}

test('sirve las herramientas nuevas del generador (capturar/imagenes/SELLO)', async () => {
  for (const n of ['capturar.py', 'imagenes.py', 'SELLO.png']) {
    const r = await pedir(n)
    assert.equal(r.c, 200, n)
    assert.ok(r.body && r.body.length > 0, n)
  }
})

test('sirve las herramientas base sin crashear', async () => {
  for (const n of ['CAMBIOS.json', 'procesar.py', 'equipo.py']) {
    assert.equal((await pedir(n)).c, 200, n)
  }
})

test('un nombre no permitido devuelve 404 (y nunca FUNCTION_INVOCATION_FAILED)', async () => {
  assert.equal((await pedir('equipo.json')).c, 404)
  assert.equal((await pedir('../.env')).c, 404)
})

test('sin la clave del equipo no sirve nada', async () => {
  assert.equal((await pedir('procesar.py', false)).c, 401)
})
