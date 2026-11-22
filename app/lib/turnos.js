import { readFileSync } from 'node:fs'

export const EQUIPO = ['Cuervo', 'Eze', 'Luis']

// La versión vigente es la de CAMBIOS.json: una compu con una versión menor no puede crear clips
export const VERSION_TURNOS = JSON.parse(readFileSync(new URL('../herramientas/CAMBIOS.json', import.meta.url), 'utf8')).version
export const ESCUCHA_VIGENTE_MS = 8 * 60 * 1000
