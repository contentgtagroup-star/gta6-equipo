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

test('el prompt General conserva exactamente la salida anterior', async () => {
  const { createHash } = await import('node:crypto')
  // SHA-256 de la salida anterior a esta actualización para estos parámetros.
  assert.equal(createHash('sha256').update(promptTurno('Luis', 3, [], 'legacy')).digest('hex'),
    'de83f11239becd8963c3f3cac0570b63037164d21547033ba4c67cd19ce29bfe')
})
