import { createClient } from '@supabase/supabase-js'
import { timingSafeEqual } from 'node:crypto'

export const COLECCIONES = ['clips', 'usados', 'radar', 'escucha', 'equipo', 'fuentes', 'turnos', 'recop_reservas']
export const BUCKET = 'clips'

let cliente = null
export function db () {
  if (!cliente) cliente = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })
  return cliente
}

// Cada integrante tiene su clave (TEAM_KEYS = {"Cuervo":"...","Eze":"...","Luis":"..."})
export function quien (req) {
  const clave = String(req.headers['x-clave'] || '')
  if (clave.length < 16) return null
  let mapa = {}
  try { mapa = JSON.parse(process.env.TEAM_KEYS || '{}') } catch { return null }
  for (const [nombre, k] of Object.entries(mapa)) {
    const a = Buffer.from(String(k)), b = Buffer.from(clave)
    if (a.length === b.length && timingSafeEqual(a, b)) return nombre
  }
  return null
}

export function responder (res, codigo, datos) {
  res.setHeader('Cache-Control', 'no-store')
  res.status(codigo).json(datos)
}

export function exigir (req, res) {
  const n = quien(req)
  if (!n) { responder(res, 401, { error: 'Clave incorrecta' }); return null }
  return n
}

// Supabase devuelve como máximo 1000 filas por consulta: esto pide de a páginas hasta traer todas
export async function todas (consulta) {
  const filas = []
  for (let desde = 0; ; desde += 1000) {
    const { data, error } = await consulta().order('coleccion').order('id').range(desde, desde + 999)
    if (error) return { data: null, error }
    filas.push(...(data || []))
    if ((data || []).length < 1000) return { data: filas, error: null }
  }
}

export function coleccionValida (c) { return COLECCIONES.includes(c) }
export function idValido (id) { return typeof id === 'string' && /^[A-Za-z0-9_\-.:@+]{1,120}$/.test(id) }
