import test from 'node:test'
import assert from 'node:assert/strict'
import { planReciclaje, humano, DIA } from '../lib/reciclaje.js'

const ahora = 100000 * DIA
const archivo = (path, mb) => ({ path, size: mb * 1024 * 1024 })

test('recicla un archivo publicado en todos sus destinos hace más de 7 días', () => {
  const plan = planReciclaje({
    cola: [
      { video_path: 'eze/a.mp4', plataforma: 'instagram', estado: 'publicado', publicado_el: ahora - 10 * DIA },
      { video_path: 'eze/a.mp4', plataforma: 'facebook', estado: 'publicado', publicado_el: ahora - 8 * DIA }
    ],
    archivos: [archivo('eze/a.mp4', 10)]
  }, { ahora, dias: 7 })
  assert.equal(plan.candidatos.length, 1)
  assert.equal(plan.candidatos[0].path, 'eze/a.mp4')
  assert.equal(plan.bytes_total, 10 * 1024 * 1024)
})

test('conserva el archivo publicado hace menos de 7 días', () => {
  const plan = planReciclaje({
    cola: [{ video_path: 'eze/b.mp4', plataforma: 'x', estado: 'publicado', publicado_el: ahora - 3 * DIA }],
    archivos: [archivo('eze/b.mp4', 5)]
  }, { ahora, dias: 7 })
  assert.equal(plan.candidatos.length, 0)
  assert.equal(plan.retenidos[0].motivo, 'publicado hace menos de 7 días')
})

test('no recicla si algún destino sigue en juego (borrador/manual/error/pendiente)', () => {
  for (const estado of ['pendiente', 'procesando', 'enviando', 'error', 'revisar', 'borrador', 'manual']) {
    const plan = planReciclaje({
      cola: [
        { video_path: 'eze/c.mp4', plataforma: 'instagram', estado: 'publicado', publicado_el: ahora - 30 * DIA },
        { video_path: 'eze/c.mp4', plataforma: 'youtube', estado }
      ],
      archivos: [archivo('eze/c.mp4', 7)]
    }, { ahora, dias: 7 })
    assert.equal(plan.candidatos.length, 0, estado)
    assert.match(plan.retenidos[0].motivo, new RegExp(estado))
  }
})

test('no recicla si un clip, sugerencia o trabajo activo necesita el mismo path', () => {
  const base = {
    cola: [{ video_path: 'eze/d.mp4', plataforma: 'instagram', estado: 'publicado', publicado_el: ahora - 30 * DIA }],
    archivos: [archivo('eze/d.mp4', 9)]
  }
  for (const extra of [
    { clips: [{ id: 'k1', video_path: 'eze/d.mp4', estado: 'aprobado' }] },
    { sugerencias: [{ video_path: 'eze/d.mp4', estado: 'pendiente' }] },
    { trabajos: [{ video_path: 'eze/d.mp4', estado: 'ejecutando' }] }
  ]) {
    const plan = planReciclaje({ ...base, ...extra }, { ahora, dias: 7 })
    assert.equal(plan.candidatos.length, 0, JSON.stringify(extra))
    assert.equal(plan.retenidos.length, 1)
  }
})

test('un clip ya publicado o reciclado no bloquea el reciclaje de su archivo', () => {
  for (const estado of ['publicado', 'reciclado', 'descartado']) {
    const plan = planReciclaje({
      cola: [{ video_path: 'eze/e.mp4', plataforma: 'instagram', estado: 'publicado', publicado_el: ahora - 30 * DIA }],
      clips: [{ id: 'k2', video_path: 'eze/e.mp4', estado }],
      archivos: [archivo('eze/e.mp4', 4)]
    }, { ahora, dias: 7 })
    assert.equal(plan.candidatos.length, 1, estado)
  }
})

test('un archivo nunca publicado desde la app no es candidato ni cuenta como recuperable', () => {
  const plan = planReciclaje({
    cola: [{ video_path: 'eze/f.mp4', plataforma: 'instagram', estado: 'cancelado' }],
    archivos: [archivo('eze/f.mp4', 12), archivo('eze/huerfano.mp4', 50)]
  }, { ahora, dias: 7 })
  assert.equal(plan.candidatos.length, 0)
  assert.equal(plan.bytes_total, 0)
})

test('las imágenes del envío también se consideran por path', () => {
  const plan = planReciclaje({
    cola: [{ imagenes: ['eze/i1.png', 'eze/i2.png'], plataforma: 'facebook', estado: 'publicado', publicado_el: ahora - 20 * DIA }],
    archivos: [archivo('eze/i1.png', 1), archivo('eze/i2.png', 2)]
  }, { ahora, dias: 7 })
  assert.equal(plan.candidatos.length, 2)
  assert.equal(plan.bytes_total, 3 * 1024 * 1024)
})

test('humano formatea bytes legibles', () => {
  assert.equal(humano(0), '0 B')
  assert.equal(humano(1024), '1.0 KB')
  assert.equal(humano(10 * 1024 * 1024), '10.0 MB')
})
