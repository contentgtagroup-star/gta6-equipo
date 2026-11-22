import test from 'node:test'
import assert from 'node:assert/strict'
import { promptTurno } from '../lib/prompt_turno.js'

test('el prompt fijo recibe las calificaciones del equipo', () => {
  const prompt = promptTurno('Luis', 3, [
    { id: 'bueno', calificaciones: { Cuervo: 5, Eze: 4 }, titulo: 'Persecución', motivo: 'reacción fuerte' },
    { id: 'malo', calificaciones: { Cuervo: 1 }, titulo: 'Charla', motivo: 'sin acción' }
  ], 'pedido-123')
  assert.match(prompt, /Luis/)
  assert.match(prompt, /bueno/)
  assert.match(prompt, /malo/)
  assert.match(prompt, /1★: 1/)
  assert.match(prompt, /5★: 1/)
  assert.match(prompt, /Hacé un clip a la vez/)
  assert.match(prompt, /turno_id "pedido-123"/)
  assert.match(prompt, /hacé solo los faltantes/)
  assert.match(prompt, /equipo\.py comprobar-turno/)
  assert.match(prompt, /equipo\.py reservar-tramo/)
  assert.match(prompt, /--video-id/)
  assert.match(prompt, /watch.*fuente\.mp4/)
})

test('el prompt General mantiene el flujo y suma retención y limpieza de reservas', () => {
  const prompt = promptTurno('Luis', 3, [], 'legacy')
  for (const regla of ['7b. RECOPILAR', 'No publiques nada en redes', 'primer segundo', 'sin inventar datos', 'liberar-tramo', 'No instales paquetes durante el turno']) assert.ok(prompt.includes(regla), regla)
})
