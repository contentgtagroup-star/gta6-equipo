import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFileSync } from 'node:fs'

test('el servidor rechaza que otra compu reclame una corrección aunque cambie corrige_por', async () => {
  const src = readFileSync(new URL('../api/doc.js', import.meta.url), 'utf8')
    .replace(/^import .*\n/gm, '').replace('export default async function handler', 'async function handler')
  const doc = { datos: { estado: 'corregir', corrige_por: 'Luis', responsable: 'Eze' }, version: 1 }
  const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: doc }) }
  const ctx = { exigir: () => 'Eze', db: () => ({ from: () => q }), coleccionValida: () => true, idValido: () => true,
    responder: (res, codigo, datos) => Object.assign(res, { codigo, datos }) }
  vm.createContext(ctx); vm.runInContext(src, ctx)
  const res = {}
  await ctx.handler({ method: 'POST', body: { op: 'update', col: 'clips', id: 'c1', version: 1,
    datos: { estado: 'corrigiendo', corrige_por: 'Eze', corrige_ahora: 'Eze' } } }, res)
  assert.equal(res.codigo, 403)
  assert.match(res.datos.error, /quien la pidió/)
})
