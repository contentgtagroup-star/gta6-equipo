// Requisitos de monetización por red (umbrales medibles con nuestras métricas).
// Cambian seguido y varios están en transición; son una referencia para medir el avance, no una garantía.
export const REQUISITOS = {
  youtube: {
    programa: 'YouTube Partner Program',
    nota: 'Suscriptores + 4.000 h de reproducción (12 meses) o 10M vistas de Shorts (90 días). Acá medimos suscriptores y vistas acumuladas.',
    metas: [{ clave: 'seguidores', nombre: 'Suscriptores', meta: 1000 }, { clave: 'vistas', nombre: 'Vistas (aprox. horas/Shorts)', meta: 4000 }]
  },
  tiktok: {
    programa: 'TikTok Creator Rewards',
    nota: 'Al menos 10.000 seguidores y 100.000 vistas en los últimos 30 días (videos de más de 1 min, +18).',
    metas: [{ clave: 'seguidores', nombre: 'Seguidores', meta: 10000 }, { clave: 'vistas', nombre: 'Vistas (30 días)', meta: 100000 }]
  },
  instagram: {
    programa: 'Suscripciones / monetización de Instagram',
    nota: 'Suscripciones y herramientas de monetización arrancan en ~10.000 seguidores con cuenta profesional.',
    metas: [{ clave: 'seguidores', nombre: 'Seguidores', meta: 10000 }]
  },
  facebook: {
    programa: 'Facebook Content Monetization',
    nota: 'Meta pasó a un programa por invitación (Content Monetization / Creator Fast Track). Referencia histórica: 5.000 seguidores.',
    metas: [{ clave: 'seguidores', nombre: 'Seguidores', meta: 5000 }]
  },
  x: {
    programa: 'X Creator Revenue',
    nota: 'Requiere Premium. Referencia: 500 seguidores verificados + 5M impresiones en 3 meses. El programa está en transición (2026).',
    metas: [{ clave: 'seguidores', nombre: 'Seguidores', meta: 500 }, { clave: 'impresiones', nombre: 'Impresiones (3 meses)', meta: 5000000 }]
  }
}

export function avanceMonetizacion (red, actual = {}) {
  const req = REQUISITOS[red]
  if (!req) return null
  const metas = req.metas.map(m => {
    const valor = Number(actual[m.clave]) || 0
    const pct = Math.max(0, Math.min(100, Math.round(valor / m.meta * 100)))
    return { clave: m.clave, nombre: m.nombre, meta: m.meta, valor, falta: Math.max(0, m.meta - valor), pct }
  })
  const pct = Math.round(metas.reduce((s, m) => s + m.pct, 0) / (metas.length || 1))
  return { programa: req.programa, nota: req.nota, metas, pct }
}
