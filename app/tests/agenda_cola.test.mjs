import test from 'node:test'
import assert from 'node:assert/strict'
import { diaLocal, proximaFranja, proximaFranjaShort } from '../lib/agenda_cola.js'

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

test('el short usa seis franjas globales y exige quince minutos de anticipación', () => {
  const c = { activo: true, zona_horaria: zona, por_red: { x: { por_dia: 6 }, youtube: { por_dia: 6 } } }
  const inicio = Date.parse('2026-11-25T11:50:00Z') // 08:50 Argentina: 09:00 ya no cumple 15 minutos.
  const reservas = {}
  for (let i = 0; i < 7; i++) {
    const { fecha, franja } = proximaFranjaShort(c, reservas, ['x', 'youtube'], inicio, 0)
    assert.ok(fecha >= inicio + 15 * 60000)
    for (const red of ['x', 'youtube']) reservas[i + '-' + red] = { red, fecha, franja, origen: String(i), short: true }
  }
  const dias = Object.values(reservas).filter(r => r.red === 'x').map(r => diaLocal(r.fecha, zona))
  assert.equal(dias.filter(d => d === '2026-11-25').length, 5)
  assert.equal(dias.filter(d => d === '2026-11-26').length, 2)
})
