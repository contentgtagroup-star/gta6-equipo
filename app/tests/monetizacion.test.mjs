import test from 'node:test'
import assert from 'node:assert/strict'
import { avanceMonetizacion, REQUISITOS } from '../lib/monetizacion.js'

test('avanceMonetizacion calcula % por meta y total, con lo que falta', () => {
  const r = avanceMonetizacion('tiktok', { seguidores: 5000, vistas: 100000 })
  assert.equal(r.programa, REQUISITOS.tiktok.programa)
  const seg = r.metas.find(m => m.clave === 'seguidores')
  assert.equal(seg.pct, 50)
  assert.equal(seg.falta, 5000)
  const vis = r.metas.find(m => m.clave === 'vistas')
  assert.equal(vis.pct, 100)
  assert.equal(vis.falta, 0)
  assert.equal(r.pct, 75) // (50 + 100) / 2
})

test('avanceMonetizacion sin datos da 0% y clampa a 100%', () => {
  assert.equal(avanceMonetizacion('x', {}).pct, 0)
  assert.equal(avanceMonetizacion('x', { seguidores: 999999, impresiones: 9e9 }).metas[0].pct, 100)
  assert.equal(avanceMonetizacion('red-inexistente'), null)
})

test('hay requisitos para las cinco redes', () => {
  for (const red of ['instagram', 'facebook', 'x', 'youtube', 'tiktok']) {
    assert.ok(REQUISITOS[red]?.metas?.length, 'faltan metas para ' + red)
  }
})
