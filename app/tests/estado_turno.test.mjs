import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { categoriasPublicas } from '../lib/categorias.js'

test('el estado muestra el turno sin exponer el prompt que ejecuta la PC', async () => {
  const source = readFileSync(new URL('../api/estado.js', import.meta.url), 'utf8')
    .replace(/^import .*\n/gm, '').replace('export default async function handler', 'async function handler')
  const sb = { from: () => ({ select: () => {
    const q = { in: () => q, order: () => q, range: async () => ({ data: [], error: null }), eq: () => q,
      maybeSingle: async () => ({ data: { datos: { estado: 'ejecutando', pedido_id: 'p1', asignado: 'Eze', pausa_compatible: true, avance: 'renderizando', avance_base: 1, prompt: 'privado', run_id: 'r1',
        pedidos: [{ estado: 'pendiente', pedido_id: 'p2', asignado: 'Luis', prompt: 'privado 2', run_id: 'r2' }] } }, error: null }) }
    return q
  } }) }
  let salida
  const ctx = { VERSION_TURNOS: 33, todas: async c => c().range(0, 999), db: () => sb, exigir: () => 'Cuervo', responder: (res, codigo, datos) => { salida = { codigo, datos } }, BUCKET: 'clips', categoriasPublicas, Date, Promise, Object }
  vm.createContext(ctx)
  vm.runInContext(source, ctx)
  await ctx.handler({}, {})
  assert.equal(salida.codigo, 200)
  assert.equal(salida.datos.turno.estado, 'ejecutando')
  assert.equal(salida.datos.turno.asignado, 'Eze')
  assert.equal(salida.datos.turno.pausa_compatible, true)
  assert.equal(salida.datos.turno.avance, 'renderizando')
  assert.equal(salida.datos.turno.avance_base, 1)
  assert.equal(salida.datos.turno.prompt, undefined)
  assert.equal(salida.datos.turno.run_id, undefined)
  assert.equal(salida.datos.turnos.length, 2)
  assert.equal(salida.datos.turnos[1].asignado, 'Luis')
  assert.equal(salida.datos.turnos[1].prompt, undefined)
})
