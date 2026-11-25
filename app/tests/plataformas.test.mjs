import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PLATAFORMAS, plataformaDe, hostBase } from '../lib/plataformas.js'
import { fuenteValida } from '../lib/publicacion.js'

test('fuenteValida acepta cada host de publicación del mapa canónico', () => {
  for (const [host, info] of Object.entries(PLATAFORMAS)) {
    if (!info.publicacion) continue
    const r = fuenteValida({ url: 'https://' + host + '/algo/status/123', tipo: 'publicacion' })
    assert.equal(r.plataforma, info.nombre, host)
  }
})

test('hostBase y plataformaDe clasifican bien', () => {
  assert.equal(hostBase('www.x.com'), 'x.com')
  assert.equal(hostBase('m.facebook.com'), 'facebook.com')
  assert.equal(plataformaDe('www.youtube.com'), 'YouTube')
  assert.equal(plataformaDe('desconocido.com'), '')
})

test('el leerLink del panel reconoce las plataformas sociales de publicación (anti-drift)', () => {
  const src = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8')
  const m = src.match(/function leerLink\(txt\)\{[\s\S]*?\n\}/)
  assert.ok(m, 'leerLink debe existir en index.html')
  const leerLink = eval('(' + m[0] + ')') // eslint-disable-line no-eval
  const ejemplos = {
    X: 'https://x.com/u/status/123',
    YouTube: 'https://www.youtube.com/watch?v=abcdefghijk',
    TikTok: 'https://www.tiktok.com/@u/video/999',
    Instagram: 'https://www.instagram.com/reel/ABC/',
    Facebook: 'https://facebook.com/u/videos/555'
  }
  for (const [nombre, url] of Object.entries(ejemplos)) {
    const r = leerLink(url)
    assert.ok(r && r.fuente === nombre, 'leerLink debería reconocer ' + nombre)
  }
})
