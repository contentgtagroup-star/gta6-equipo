import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { categoriaPorId, categoriasPublicas, validarContenido } from '../lib/categorias.js'
import { promptTurno } from '../lib/prompt_turno.js'

function clip (id = 'easter-eggs') {
  const c = categoriaPorId(id)
  return { categoria: id, estado: 'listo', titulo: 'Tema sugerido: un detalle', receta: {}, calidad: {
    concepto: 'Referencia oculta concreta', hook: 'Tema sugerido: mirá este detalle', desarrollo: 'Contexto', payoff: 'Explicación', cierre: 'Cierre',
    estructura: c.scriptStructure.map(etapa => ({ etapa, texto: 'Contenido de la etapa' })),
    evidencia: [{ url: 'https://example.com/fuente', desde: 1, hasta: 8, estado: ['misterios', 'teorias'].includes(id) ? 'hipotesis' : 'confirmado', detalle: 'Descripción observable' }],
    visuales: [{ descripcion: 'A en escena', desde: 1, hasta: 4 }, { descripcion: 'B en escena', desde: 4, hasta: 8 }],
    ...Object.fromEntries(c.validationRules.map(r => [r, 'Contenido concreto'])),
    elemento_a: 'A', elemento_b: 'B', pasos: '1. Ir al lugar. 2. Interactuar.', actualidad: 'sugerida'
  } }
}

test('ocho módulos completos, sin mutación entre selecciones', () => {
  assert.equal(categoriasPublicas().length, 8)
  for (const c of categoriasPublicas()) {
    const p = promptTurno('Cuervo', 2, [], 'pedido', c.id)
    assert.match(p, new RegExp(`CATEGORÍA DEL PEDIDO: ${c.name}`))
    assert.match(p, /No hagas recopilaciones/)
    assert.doesNotMatch(p, /7b\. RECOPILAR/)
    assert.deepEqual(validarContenido(clip(c.id)), [])
  }
  const legacy = promptTurno('Cuervo', 2, [], 'pedido')
  assert.match(legacy, /7b\. RECOPILAR/)
  assert.doesNotMatch(legacy, /CATEGORÍA DEL PEDIDO/)
  assert.deepEqual(validarContenido({ estado: 'listo' }), [])
})

test('calidad detecta faltantes, duplicados y comparación sin dos visuales', () => {
  assert.ok(validarContenido({ categoria: 'guias' }).length)
  const a = clip()
  assert.ok(validarContenido(a, [a]).includes('Ya existe este concepto en la categoría'))
  assert.deepEqual(validarContenido(a, [clip('misterios')]), [])
  const b = clip('comparaciones'); b.calidad.elemento_b = 'A'
  assert.ok(validarContenido(b).length)
  b.calidad.visuales = {}
  assert.ok(validarContenido(b).length)
  const mal = clip(); mal.calidad.evidencia = [null]; mal.calidad.visuales = [null]
  assert.ok(validarContenido(mal).length)
  const g = clip('guias'); g.calidad.evidencia[0].estado = 'hipotesis'
  assert.ok(validarContenido(g).length)
  const t = clip('tendencias'); t.calidad.actualidad = 'verificada'
  assert.ok(validarContenido(t).length)
})

// Mock de Supabase: ejecuta el handler real, sin credenciales ni escrituras externas.
function apiDocs (inicial = [], turno = {}) {
  const docs = structuredClone(inicial)
  const sb = { from: () => {
    const filtros = {}; let cambios
    const q = {
      select: () => q, eq: (k,v) => { filtros[k]=v; return q },
      maybeSingle: async () => ({ data: filtros.coleccion === 'turnos' ? { datos: turno } : docs.find(x=>x.id===filtros.id) || null }),
      range: async () => ({ data: docs }),
      insert: async d => { docs.push(structuredClone(d)); return {} },
      update: d => { cambios=d; return q },
      then: resolve => { const doc=docs.find(x=>x.id===filtros.id); Object.assign(doc,cambios); resolve({ data:[{version:doc.version}] }) }
    }; return q
  } }
  const src = readFileSync(new URL('../api/doc.js', import.meta.url),'utf8').replace(/^import .*\n/gm,'').replace('export default async function handler','async function handler')
  const ctx = { db:()=>sb, exigir:()=> 'Cuervo', responder:(r,c,d)=>Object.assign(r,{codigo:c,datos:d}), coleccionValida:()=>true, idValido:()=>true, categoriaPorId, validarContenido }
  vm.createContext(ctx); vm.runInContext(src,ctx)
  return { docs, enviar: async body => { const r={}; await ctx.handler({method:'POST',body},r); return r } }
}

test('persistencia aditiva, receta y documentos antiguos', async () => {
  const api = apiDocs([], { pedidos:[{pedido_id:'p1', categoria:'easter-eggs'}] })
  const datos = { ...clip(), turno_id:'p1' }; delete datos.categoria
  const res = await api.enviar({op:'set',col:'clips',id:'nuevo',datos})
  assert.equal(res.codigo,200)
  assert.equal(api.docs[0].datos.categoria,'easter-eggs')
  assert.equal(api.docs[0].datos.receta.categoria,'easter-eggs')
  const actualizado = await api.enviar({op:'update',col:'clips',id:'nuevo',datos:{nota:'Revisar detalle'}})
  assert.equal(actualizado.codigo,200)
  assert.equal(api.docs[0].datos.categoria,'easter-eggs')
  assert.equal((await api.enviar({op:'set',col:'clips',id:'viejo',datos:{estado:'listo',titulo:'Legacy'}})).codigo,200)
  assert.equal(api.docs[1].datos.categoria,undefined)
})

test('API rechaza categorías falsas, cruce de pedido y falta de evidencia', async () => {
  const api = apiDocs([], {pedidos:[{pedido_id:'p1',categoria:'guias'}]})
  for (const datos of [{categoria:'falsa'}, { ...clip(),turno_id:'p1'}, {categoria:'guias',estado:'listo'}]) {
    assert.equal((await api.enviar({op:'set',col:'clips',id:'mal',datos})).codigo,400)
  }
  assert.equal(api.docs.length,0)
})
