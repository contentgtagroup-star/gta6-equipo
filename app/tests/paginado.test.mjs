import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

// comun.js importa supabase-js (no instalado en local): se evalúa solo la función
const fuente = readFileSync(new URL('../lib/comun.js', import.meta.url), 'utf8').match(/export async function todas[\s\S]*?\n}\n/)[0]
const ctx = {}; vm.createContext(ctx); vm.runInContext(fuente.replace('export ', '') + 'this.todas = todas', ctx)
const { todas } = ctx

test('todas trae más de 1000 filas pidiendo de a páginas', async () => {
  const filas = Array.from({ length: 2500 }, (_, i) => ({ id: String(i) }))
  const pedidas = []
  const consulta = () => { const q = { order: () => q, range: async (a, b) => { pedidas.push([a, b]); return { data: filas.slice(a, b + 1), error: null } } }; return q }
  const { data, error } = await todas(consulta)
  assert.equal(error, null)
  assert.equal(data.length, 2500)
  assert.deepEqual(pedidas, [[0, 999], [1000, 1999], [2000, 2999]])
})
