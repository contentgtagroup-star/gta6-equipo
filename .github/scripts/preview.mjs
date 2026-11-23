import { readFileSync, appendFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const MARCA = '<!-- gta6-preview -->'
const REPO = 'contentgtagroup-star/gta6-equipo'
const EQUIPO = 'team_teuRF4rK0UsjEY2iUYw3ES4v'

export function leerDeployment (resultado) {
  const d = resultado.deployment || resultado
  if (resultado.status === 'error' || d.readyState !== 'READY' || d.target === 'production') throw new Error('Vercel no confirmó un preview listo.')
  const url = new URL(d.url)
  if (url.protocol !== 'https:' || !/^gta6-equipo-[a-z0-9-]+\.vercel\.app$/.test(url.hostname) || url.port || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Vercel devolvió una URL de preview inesperada.')
  return { url: url.origin, hostname: url.hostname }
}

export async function registrarPreview (resultado, env, remoto = fetch) {
  const deployment = leerDeployment(resultado)
  const pr = Number(env.GTA_PREVIEW_PR), sha = env.GTA_PREVIEW_SHA
  if (env.GITHUB_REPOSITORY !== REPO || !Number.isSafeInteger(pr) || pr < 1 || !/^[a-f0-9]{40}$/.test(sha || '')) throw new Error('El PR o su commit no son válidos.')
  if (!env.GH_TOKEN || !env.VERCEL_TOKEN || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(env.GTA_PREVIEW_REVIEWER_EMAIL || '')) throw new Error('Falta configurar el acceso al preview.')
  async function api (servicio, path, method = 'GET', body) {
    const github = servicio === 'GitHub'
    const r = await remoto((github ? 'https://api.github.com' : 'https://api.vercel.com') + path, {
      method, redirect: 'error', signal: AbortSignal.timeout(30000),
      headers: { Authorization: 'Bearer ' + (github ? env.GH_TOKEN : env.VERCEL_TOKEN), 'Content-Type': 'application/json', ...(github ? { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {})
    })
    if (!r.ok) throw new Error(servicio + ' rechazó el registro del preview (HTTP ' + r.status + ').')
    return r.status === 204 ? null : r.json()
  }
  const actual = await api('GitHub', `/repos/${REPO}/pulls/${pr}`)
  if (actual.head?.sha !== sha || actual.state !== 'open') return { anterior: true }
  // Acceso personal para el revisor; conserva la protección del resto del proyecto.
  await api('Vercel', `/aliases/${deployment.hostname}/protection-bypass?teamId=${EQUIPO}`, 'PATCH', { scope: { email: env.GTA_PREVIEW_REVIEWER_EMAIL, access: 'granted' } })
  let comentario
  for (let pagina = 1; ; pagina++) {
    const comentarios = await api('GitHub', `/repos/${REPO}/issues/${pr}/comments?per_page=100&page=${pagina}`)
    comentario = comentarios.find(c => c.user?.login === 'github-actions[bot]' && c.body?.includes(MARCA))
    if (comentario || comentarios.length < 100) break
  }
  const body = `${MARCA}\n### Preview de GTA\n\n[Abrir preview](${deployment.url})\n\nCommit: \`${sha.slice(0, 7)}\`. Las pruebas pasaron.\n\nEze tiene acceso con su cuenta de Vercel. El panel usa la clave habitual del equipo.\n\nEste enlace se actualiza cuando subís cambios al PR.`
  await api('GitHub', comentario ? `/repos/${REPO}/issues/comments/${comentario.id}` : `/repos/${REPO}/issues/${pr}/comments`, comentario ? 'PATCH' : 'POST', { body })
  return { url: deployment.url }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const resultado = await registrarPreview(JSON.parse(readFileSync(process.argv[2], 'utf8')), process.env)
    if (resultado.url) {
      appendFileSync(process.env.GITHUB_OUTPUT, 'url=' + resultado.url + '\n')
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, '### Preview de GTA\n\n' + resultado.url + '\n')
      console.log('Preview listo; acceso del revisor y enlace del PR actualizados.')
    } else console.log('El PR cambió o se cerró. El preview anterior no reemplaza su enlace actual.')
  } catch (e) { console.error(e.message); process.exitCode = 1 }
}
