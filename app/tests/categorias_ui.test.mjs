import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFileSync } from 'node:fs'
import { categoriasPublicas } from '../lib/categorias.js'

// DOM mínimo para ejecutar el selector y envío reales; no reemplaza prueba visual.
test('selector cambia ocho categorías sin tocar pedidos ni enviar instrucciones', async () => {
  const html = readFileSync(new URL('../public/index.html', import.meta.url),'utf8')
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1]
  new vm.Script(script) // Sintaxis de la SPA completa.
  const state = {categoria:'',categorias:categoriasPublicas(),turnos:[{pedido_id:'activo',categoria:'misterios'}]}
  const nodes = {categorias:{dataset:{},children:[],replaceChildren(){this.children=[]},append(c){this.children.push(c)}},categoriaAyuda:{},cuantos:{value:'2'}}
  let enviado
  const ctx = {S:state, $:id=>nodes[id], el:(tag,attrs,...children)=>({tag,attrs,children}),
    cargar:async()=>{},renderTurno:()=>{},toast:()=>{},api:async(r,body)=>{enviado=body;return {}}, Number, JSON}
  vm.createContext(ctx)
  vm.runInContext(script.slice(script.indexOf('function nombreCategoria'),script.indexOf('async function reintentarTurno')),ctx)
  ctx.renderCategorias()
  assert.equal(nodes.categorias.children.length,9)
  for (const c of categoriasPublicas()) {
    nodes.categorias.children.find(b=>b.children[0]===c.name).attrs.onclick()
    assert.equal(state.categoria,c.id)
    assert.equal(nodes.categorias.children.filter(b=>b.attrs['aria-pressed']==='true').length,1)
    await ctx.pedirTurno()
    assert.equal(enviado.categoria,c.id)
    assert.equal(enviado.systemInstructions,undefined)
    assert.equal(state.turnos[0].categoria,'misterios')
  }
  nodes.categorias.children[0].attrs.onclick()
  await ctx.pedirTurno()
  assert.equal(enviado.categoria,undefined)
})
