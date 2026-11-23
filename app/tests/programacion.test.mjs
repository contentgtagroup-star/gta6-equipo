import test from 'node:test'
import assert from 'node:assert/strict'
import { elegirHorario, diaArgentina, MAX_DIARIO } from '../lib/programacion.js'

const minimo = a => a, ahora = Date.parse('2026-11-23T08:00:00-03:00')
test('diecinueve shorts comparten un máximo de seis reservas por día', () => {
  const reservas = {}, dias = {}
  for (let n = 0; n < 19; n++) {
    const r = elegirHorario(reservas, {}, ahora, minimo)
    reservas['clip-' + n] = r; dias[r.dia] = (dias[r.dia] || 0) + 1
    assert.ok(r.programado_el >= ahora + 15 * 60000)
    const hora = new Date(r.programado_el - 3 * 3600000).getUTCHours()
    assert.ok(hora >= 9 && hora < 21)
  }
  assert.deepEqual(Object.values(dias), [6, 6, 6, 1])
  assert.equal(new Set(Object.values(reservas).map(r => r.programado_el)).size, 19)
})
test('usa día argentino al cruzar medianoche UTC y no agenda en el pasado', () => {
  const t = Date.parse('2026-11-24T01:00:00Z')
  assert.equal(diaArgentina(t), '2026-11-23')
  assert.equal(elegirHorario({}, {}, t, minimo).dia, '2026-11-24')
})
test('el minuto es aleatorio y seis salidas reales bloquean el día', () => {
  assert.notEqual(elegirHorario({}, {}, ahora, minimo).programado_el, elegirHorario({}, {}, ahora, (a, b) => b - 1).programado_el)
  const ejecuciones = { '2026-11-23': Object.fromEntries(Array.from({ length: MAX_DIARIO }, (_, n) => ['clip-' + n, ahora])) }
  assert.equal(elegirHorario({}, ejecuciones, ahora, minimo).dia, '2026-11-24')
})
