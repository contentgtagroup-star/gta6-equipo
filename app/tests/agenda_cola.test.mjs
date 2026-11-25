import test from 'node:test'
import assert from 'node:assert/strict'
import { diaLocal, proximaFranja } from '../lib/agenda_cola.js'

const zona = 'America/Argentina/Buenos_Aires'
const config = (por_dia, horarios = []) => ({ activo: true, zona_horaria: zona, por_red: { x: { por_dia, horarios } } })

test('reserva horarios distintos y respeta el cupo diario de la red', () => {
  const inicio = Date.parse('2026-11-25T10:00:00Z')
  const c = config(2, ['09:00', '18:00'])
  const a = proximaFranja(c, 'x', [], inicio)
  const b = proximaFranja(c, 'x', [a], inicio)
  const siguiente = proximaFranja(c, 'x', [a, b], inicio)
  assert.equal(new Date(a).toISOString(), '2026-11-25T12:00:00.000Z')
  assert.equal(new Date(b).toISOString(), '2026-11-25T21:00:00.000Z')
  assert.equal(diaLocal(siguiente, zona), '2026-11-26')
})

test('sin horarios reparte el cupo entre las 9 y las 21 y no adelanta un envío', () => {
  const inicio = Date.parse('2026-11-25T10:00:00Z')
  const c = config(3)
  const ocupados = []
  for (let n = 0; n < 3; n++) ocupados.push(proximaFranja(c, 'x', ocupados, inicio))
  assert.equal(new Set(ocupados).size, 3)
  assert.ok(ocupados.every(ms => ms > inicio && diaLocal(ms, zona) === '2026-11-25'))
  assert.equal(diaLocal(proximaFranja(c, 'x', ocupados, inicio), zona), '2026-11-26')
})
