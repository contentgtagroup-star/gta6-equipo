import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { exigir, responder } from '../lib/comun.js'

const PERMITIDAS = { 'categorias.json': 'application/json', 'procesar.py': 'text/plain', 'recopilar.py': 'text/plain', 'radar.py': 'text/plain', 'publicaciones.py': 'text/plain', 'capturar.py': 'text/plain', 'imagenes.py': 'text/plain', 'equipo.py': 'text/plain', 'CAMBIOS.json': 'application/json', 'BowlbyOne-Regular.ttf': 'font/ttf', 'OFL.txt': 'text/plain', 'OVERLAY.png': 'image/png', 'SELLO.png': 'image/png' }

export default async function handler (req, res) {
  const yo = exigir(req, res); if (!yo) return
  const nombre = String(req.query.nombre || '')
  // las compus con la versión vieja todavía piden este archivo al actualizarse: se manda vacío y la versión nueva lo borra
  if (nombre === 'consumo_statusline.py') { res.setHeader('Content-Type', 'text/plain'); return res.status(200).send('# ya no se usa\n') }
  if (!PERMITIDAS[nombre]) return responder(res, 404, { error: 'No existe' })
  const buf = await readFile(path.join(process.cwd(), 'herramientas', nombre))
  res.setHeader('Content-Type', PERMITIDAS[nombre])
  res.setHeader('Cache-Control', 'no-store')
  res.status(200).send(buf)
}
