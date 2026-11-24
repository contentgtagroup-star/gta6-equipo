import test from 'node:test'
import assert from 'node:assert/strict'
import { planReciclaje, planLimpiezaPendientes, humano, DIA } from '../lib/reciclaje.js'

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

test('retiene si falta una fecha de publicación válida en algún destino', () => {
  for (const malo of [
    [{ video_path: 'eze/g.mp4', plataforma: 'instagram', estado: 'publicado' }], // sin fecha
    [{ video_path: 'eze/g.mp4', plataforma: 'instagram', estado: 'publicado', publicado_el: null }],
    [{ video_path: 'eze/g.mp4', plataforma: 'instagram', estado: 'publicado', publicado_el: 'ayer' }],
    [ // una red con fecha antigua, otra sin fecha
      { video_path: 'eze/g.mp4', plataforma: 'instagram', estado: 'publicado', publicado_el: ahora - 30 * DIA },
      { video_path: 'eze/g.mp4', plataforma: 'facebook', estado: 'publicado' }
    ]
  ]) {
    const plan = planReciclaje({ cola: malo, archivos: [archivo('eze/g.mp4', 8)] }, { ahora, dias: 7 })
    assert.equal(plan.candidatos.length, 0, JSON.stringify(malo))
    assert.equal(plan.retenidos[0].motivo, 'falta una fecha de publicación válida en algún destino')
  }
})

test('una sugerencia aprobada sin encolar bloquea el reciclaje; ya encolada no', () => {
  const base = {
    cola: [{ video_path: 'eze/h.mp4', plataforma: 'instagram', estado: 'publicado', publicado_el: ahora - 30 * DIA }],
    archivos: [archivo('eze/h.mp4', 6)]
  }
  const sinEncolar = planReciclaje({ ...base, sugerencias: [{ video_path: 'eze/h.mp4', estado: 'aprobada', encolado: false }] }, { ahora, dias: 7 })
  assert.equal(sinEncolar.candidatos.length, 0)
  assert.match(sinEncolar.retenidos[0].motivo, /pendiente de encolar/)
  const encolada = planReciclaje({ ...base, sugerencias: [{ video_path: 'eze/h.mp4', estado: 'aprobada', encolado: true }] }, { ahora, dias: 7 })
  assert.equal(encolada.candidatos.length, 1)
})

test('un clip con snapshot aprobado pendiente de encolar retiene su archivo', () => {
  const plan = planReciclaje({
    cola: [{ video_path: 'eze/j.mp4', plataforma: 'instagram', estado: 'publicado', publicado_el: ahora - 30 * DIA }],
    clips: [{ id: 'k3', video_path: 'eze/j.mp4', estado: 'aprobado', publicacion_cola: true, publicacion_snapshot: { video_path: 'eze/j.mp4' }, publicacion_encolada: false }],
    archivos: [archivo('eze/j.mp4', 3)]
  }, { ahora, dias: 7 })
  assert.equal(plan.candidatos.length, 0)
})

test('retiene el path del snapshot pendiente aunque el clip ya esté publicado con otro video_path', () => {
  const plan = planReciclaje({
    cola: [{ video_path: 'eze/anterior.mp4', plataforma: 'instagram', estado: 'publicado', publicado_el: ahora - 30 * DIA }],
    clips: [{ id: 'k4', estado: 'publicado', video_path: 'eze/nuevo.mp4', publicacion_cola: true, publicacion_encolada: false, publicacion_snapshot: { video_path: 'eze/anterior.mp4' } }],
    archivos: [archivo('eze/anterior.mp4', 9), archivo('eze/nuevo.mp4', 9)]
  }, { ahora, dias: 7 })
  assert.equal(plan.candidatos.length, 0)
  assert.equal(plan.retenidos.find(r => r.path === 'eze/anterior.mp4')?.motivo, 'clip "k4" con aprobación pendiente de encolar (snapshot)')
})

test('humano formatea bytes legibles', () => {
  assert.equal(humano(0), '0 B')
  assert.equal(humano(1024), '1.0 KB')
  assert.equal(humano(10 * 1024 * 1024), '10.0 MB')
})

test('limpieza propone clips listos sin aprobar ni usar después de 14 días', () => {
  const plan = planLimpiezaPendientes({
    clips: [{ id: 'viejo', estado: 'listo', video_path: 'eze/viejo.mp4', creado: ahora - 20 * DIA }],
    archivos: [archivo('eze/viejo.mp4', 11)]
  }, { ahora, dias: 14 })
  assert.equal(plan.candidatos.length, 1)
  assert.equal(plan.candidatos[0].id, 'viejo')
  assert.equal(plan.bytes_total, 11 * 1024 * 1024)
})

test('limpieza conserva clips recientes, stock, recopilados y con fecha inválida', () => {
  const clips = [
    { id: 'reciente', estado: 'listo', video_path: 'eze/reciente.mp4', creado: ahora - 3 * DIA },
    { id: 'stock', estado: 'listo', video_path: 'eze/stock.mp4', creado: ahora - 30 * DIA, stock: true },
    { id: 'recop', estado: 'listo', video_path: 'eze/recop.mp4', creado: ahora - 30 * DIA, en_recop: 'rc-1' },
    { id: 'sin-fecha', estado: 'listo', video_path: 'eze/sin-fecha.mp4' }
  ]
  const plan = planLimpiezaPendientes({ clips, archivos: clips.map(c => archivo(c.video_path, 1)) }, { ahora, dias: 14 })
  assert.equal(plan.candidatos.length, 0)
  assert.deepEqual(new Set(plan.retenidos.map(c => c.id)), new Set(['reciente', 'stock', 'recop', 'sin-fecha']))
})

test('limpieza usa la actividad más reciente del documento', () => {
  const plan = planLimpiezaPendientes({
    clips: [{ id: 'editado', estado: 'listo', video_path: 'eze/editado.mp4', creado: ahora - 40 * DIA, _actualizado_db: new Date(ahora - 2 * DIA).toISOString() }],
    archivos: [archivo('eze/editado.mp4', 2)]
  }, { ahora, dias: 14 })
  assert.equal(plan.candidatos.length, 0)
  assert.match(plan.retenidos[0].motivo, /actividad/)
})

test('limpieza conserva cualquier archivo referenciado por Publicaciones', () => {
  const base = {
    clips: [{ id: 'referido', estado: 'listo', video_path: 'eze/referido.mp4', creado: ahora - 40 * DIA }],
    archivos: [archivo('eze/referido.mp4', 3)]
  }
  for (const extra of [
    { cola: [{ video_path: 'eze/referido.mp4', estado: 'cancelado' }] },
    { sugerencias: [{ video_path: 'eze/referido.mp4', estado: 'aprobada', encolado: true }] },
    { trabajos: [{ video_path: 'eze/referido.mp4', estado: 'terminado' }] },
    { trabajos: [{ fuente: { video_path: 'eze/referido.mp4' }, estado: 'terminado' }] }
  ]) {
    const plan = planLimpiezaPendientes({ ...base, ...extra }, { ahora, dias: 14 })
    assert.equal(plan.candidatos.length, 0, JSON.stringify(extra))
  }
})

test('limpieza conserva archivos compartidos y clips con publicación asociada', () => {
  const plan = planLimpiezaPendientes({
    clips: [
      { id: 'viejo', estado: 'listo', video_path: 'eze/compartido.mp4', creado: ahora - 40 * DIA },
      { id: 'otro', estado: 'aprobado', video_path: 'eze/compartido.mp4', creado: ahora - 40 * DIA },
      { id: 'cola', estado: 'listo', video_path: 'eze/cola.mp4', creado: ahora - 40 * DIA, publicacion_cola: true }
    ],
    archivos: [archivo('eze/compartido.mp4', 4), archivo('eze/cola.mp4', 5)]
  }, { ahora, dias: 14 })
  assert.equal(plan.candidatos.length, 0)
  assert.deepEqual(new Set(plan.retenidos.map(c => c.id)), new Set(['viejo', 'cola']))
})

test('limpieza conserva un archivo usado por el snapshot de otro clip', () => {
  const plan = planLimpiezaPendientes({
    clips: [
      { id: 'viejo', estado: 'listo', video_path: 'eze/anterior.mp4', creado: ahora - 40 * DIA },
      { id: 'aprobado', estado: 'aprobado', video_path: 'eze/nuevo.mp4', publicacion_snapshot: { video_path: 'eze/anterior.mp4' } }
    ],
    archivos: [archivo('eze/anterior.mp4', 4), archivo('eze/nuevo.mp4', 4)]
  }, { ahora, dias: 14 })
  assert.equal(plan.candidatos.length, 0)
  assert.match(plan.retenidos[0].motivo, /snapshot/)
})

test('limpieza conserva metadata cuando el archivo ya falta del bucket', () => {
  const plan = planLimpiezaPendientes({
    clips: [{ id: 'sin-archivo', estado: 'listo', video_path: 'eze/falta.mp4', creado: ahora - 40 * DIA }],
    archivos: []
  }, { ahora, dias: 14 })
  assert.equal(plan.candidatos.length, 0)
  assert.equal(plan.retenidos[0].motivo, 'el archivo ya no existe en el bucket')
})
