/* Usa la conexión, componentes y paleta del panel existente. */
(() => {
  const P = { tab: 'conexiones', datos: null, cargando: false, modal: false, firma: '', error: '' }
  const redes = { instagram: 'Instagram', facebook: 'Facebook', x: 'X', youtube: 'YouTube', tiktok: 'TikTok' }
  const etiquetas = { sin_conectar: 'Sin conectar', sin_verificar: 'Por verificar', conectada: 'Conectada', token_vencido: 'Token vencido', pendiente: 'En cola', procesando: 'Procesando', enviando: 'Enviando', revisar: 'Revisar en la red', error: 'Error', borrador: 'Borrador · falta publicar', publicado: 'Publicado', cancelado: 'Cancelado', ejecutando: 'Trabajando', terminado: 'Terminado' }
  const fecha = t => t ? new Date(t).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' }) : 'Todavía no'
  const num = n => typeof n === 'number' && Number.isFinite(n) ? n.toLocaleString('es-AR', { maximumFractionDigits: 1 }) : '—'
  const post = cuerpo => api('/api/publicacion', cuerpo)
  function boton(texto, accion, clase = 'tiny') {
    return el('button', { type: 'button', class: clase, onclick: async e => {
      e.currentTarget.disabled = true
      try { await accion() } catch (err) { toast(err.message || 'No se pudo completar.') }
      finally { e.target.disabled = false }
    } }, texto)
  }
  const campo = (texto, nodo) => el('label', { class: 'small' }, texto, nodo)
  function entrada(valor = '', attrs = {}) { return el('input', { value: valor, ...attrs }) }
  function selector(opciones, valor) {
    const s = el('select', {}, opciones.map(([value, text]) => el('option', { value }, text)))
    s.value = valor; return s
  }
  function checksRedes(valor = Object.keys(redes)) {
    const inputs = Object.entries(redes).map(([id, nombre]) => {
      const input = entrada('', { type: 'checkbox', checked: valor.includes(id), style: 'width:auto' })
      input.dataset.red = id
      return campo(nombre + (['youtube', 'tiktok'].includes(id) ? ' · borrador' : ' · automático'), input)
    })
    const box = el('div', { class: 'row', style: 'flex-wrap:wrap' }, inputs)
    box.valores = () => [...box.querySelectorAll('input:checked')].map(i => i.dataset.red)
    return box
  }
  function dialogo(titulo, contenido, guardar, texto = 'Guardar') {
    const antes = document.activeElement, d = el('dialog', { class: 'card', style: 'width:min(680px,95vw);max-height:90vh;overflow:auto;color:var(--fg);background:var(--surface);border:1px solid var(--line)' })
    const form = el('form', { style: 'display:grid;gap:16px' }, el('h2', {}, titulo), contenido)
    const cancelar = boton('Cancelar', () => d.close())
    const submit = el('button', { type: 'submit', class: 'primary' }, texto)
    form.append(el('div', { class: 'row' }, submit, cancelar))
    form.addEventListener('submit', async e => {
      e.preventDefault(); submit.disabled = true
      try { await guardar(); d.close(); await cargar(true) }
      catch (err) { toast(err.message || 'No se pudo guardar.'); submit.disabled = false }
    })
    d.append(form); document.body.append(d); P.modal = true; d.showModal()
    d.addEventListener('close', () => { P.modal = false; d.remove(); antes?.focus() }, { once: true })
    return d
  }
  async function cargar(forzar = false) {
    if (!S.clave || P.cargando || P.modal && !forzar) return
    P.cargando = true
    P.error = ''
    if (!P.datos) render()
    try {
      const datos = await api('/api/publicacion'), firma = JSON.stringify(datos)
      const sinDatos = !P.datos
      P.datos = datos
      $('pubEstado').textContent = datos.automatico_activo ? 'Solo se envía material aprobado. YouTube y TikTok quedan en borrador.' : 'Podés preparar y revisar publicaciones. Los envíos automáticos todavía están en espera.'
      if (firma !== P.firma || forzar || sinDatos) { P.firma = firma; render() }
    } catch (e) {
      P.error = e.message || 'No se pudieron cargar las publicaciones. Probá Actualizar.'
      P.datos = null
      $('pubEstado').textContent = P.error
      render()
    }
    finally { P.cargando = false }
  }
  function render() {
    const tabs = { conexiones: 'Conexiones', fuentes: 'Cuentas a rastrear', sugerencias: 'Sugerencias', cola: 'Cola', actividad: 'Actividad', metricas: 'Métricas' }
    $('pubTabs').replaceChildren(...Object.entries(tabs).map(([id, texto]) => boton(texto, () => { P.tab = id; render() }, 'tiny' + (P.tab === id ? ' primary' : ''))))
    for (const b of $('pubTabs').children) b.setAttribute('aria-pressed', b.textContent === tabs[P.tab] ? 'true' : 'false')
    const box = $('pubContenido'); box.replaceChildren()
    if (!S.clave) { box.append(el('p', { class: 'small muted' }, 'Entrá al panel para ver las publicaciones.')); return }
    if (!P.datos) {
      box.append(el('p', { class: 'small muted' }, P.error ? 'Ya estás dentro del panel. No necesitás volver a ingresar tu clave. La biblioteca y el motor de clips siguen disponibles.' : 'Cargando publicaciones…'))
      return
    }
    ;({ conexiones, fuentes, sugerencias, cola, actividad, metricas })[P.tab](box)
  }
  function conexiones(box) {
    const grid = el('div', { class: 'people', style: 'grid-template-columns:repeat(auto-fit,minmax(190px,1fr))' })
    for (const c of P.datos.conexiones) {
      grid.append(el('article', { class: 'person' }, el('h3', {}, c.nombre), el('p', { class: 'small' }, c.cuenta_conectada || c.cuenta),
        el('p', {}, etiquetas[c.estado] || c.estado), el('p', { class: 'small muted' }, c.modo === 'automatico' ? 'Publica después de aprobar.' : c.id === 'tiktok' ? 'Llega al Inbox: terminás de publicar en TikTok.' : 'Se sube como privado: revisás el Short en YouTube Studio.'),
        c.entorno === 'sandbox' && el('p', { class: 'small muted' }, 'TikTok sandbox: conexión de prueba, con las cuentas autorizadas en esa app.'),
        c.metodo === 'system_user' && el('p', { class: 'small muted' }, 'Conexión con el usuario del sistema de Meta. Si se renueva el token en Vercel, tocá Reconectar.'),
        c.faltan_permisos?.length > 0 && el('p', { class: 'small' }, 'Faltan permisos para métricas: ' + c.faltan_permisos.join(', ') + '. La publicación sigue funcionando.'),
        el('p', { class: 'small muted' }, 'Última sincronización: ' + fecha(c.sincronizada_el)),
        boton(c.estado === 'conectada' ? 'Reconectar' : 'Conectar', async () => {
          const d = await api('/api/conexion/' + c.proveedor, { op: 'iniciar' })
          if (d.url) location.assign(d.url); else { toast('Conexión verificada'); await cargar(true) }
        })))
    }
    box.append(grid)
  }
  function editarFuente(f = {}) {
    const url = entrada(f.url || '', { required: true, placeholder: 'https://x.com/cuenta o link de publicación', maxlength: 1000 })
    const tipo = selector([['perfil', 'Perfil completo'], ['publicacion', 'Publicación específica'], ['feed', 'Feed de datos'], ['referencia', 'Solo referencia editorial']], f.tipo || 'perfil')
    const idioma = entrada(f.idioma || '?', { maxlength: 12 })
    const nota = el('textarea', { maxlength: 1000, rows: 3 }, f.nota || '')
    const activa = entrada('', { type: 'checkbox', checked: f.activa !== false, style: 'width:auto' })
    const auto = entrada('', { type: 'checkbox', checked: !!f.automatica, style: 'width:auto' })
    const horas = entrada(f.intervalo_horas || 24, { type: 'number', min: 6, max: 168 })
    dialogo(f.id ? 'Editar fuente' : 'Agregar fuente', el('div', { style: 'display:grid;gap:12px' }, campo('Link', url), campo('Tipo de trabajo', tipo), campo('Idioma', idioma), campo('Qué tiene de bueno', nota),
      el('div', { class: 'row' }, campo('Activa', activa), campo('Rastrear automáticamente el perfil o feed', auto)), campo('Revisar cada cuántas horas', horas)),
    () => post({ op: 'fuente_guardar', id: f.id, version: f._version, datos: { url: url.value, tipo: tipo.value, idioma: idioma.value, nota: nota.value, activa: activa.checked, automatica: auto.checked, intervalo_horas: Number(horas.value) } }))
  }
  function fuentes(box) {
    box.append(el('div', { class: 'row' }, boton('Agregar fuente', () => editarFuente(), 'tiny primary'), boton('Importar fuentes del equipo', async () => { const d = await post({ op: 'importar_fuentes' }); toast(d.agregadas + ' fuentes nuevas'); await cargar(true) })))
    box.append(el('p', { class: 'small muted' }, 'Un perfil se revisa periódicamente si activás el rastreo. Un link puntual se adapta una vez. Los enlaces pendientes de verificar se importan pausados.'))
    for (const f of P.datos.fuentes) {
      const trabajos = P.datos.trabajos.filter(t => t.fuente_id === f.id), t = trabajos.at(-1)
      box.append(el('article', { class: 'bloque', style: 'padding:14px 0;border-bottom:1px solid var(--line)' },
        el('a', { href: f.url, target: '_blank', rel: 'noopener noreferrer', style: 'overflow-wrap:anywhere' }, f.url.replace('https://', '')),
        el('p', { class: 'small' }, [f.plataforma, f.tipo, f.idioma, f.activa ? 'Activa' : 'Pausada', f.automatica ? 'Rastreo cada ' + f.intervalo_horas + ' h' : 'Trabajo manual'].join(' · ')),
        el('p', { class: 'small muted' }, f.nota), f.estado_inicial && el('p', { class: 'small muted' }, 'Estado al importar: ' + f.estado_inicial),
        t && el('p', { class: 'small' }, (etiquetas[t.estado] || t.estado) + (t.error ? ': ' + t.error : '')),
        el('div', { class: 'row' }, boton('Editar', () => editarFuente(f)),
          boton('Generar trabajo', async () => { await post({ op: 'generar', id: f.id }); toast('Trabajo en cola para tu compu'); await cargar(true) }),
          boton('Quitar', async () => { await post({ op: 'fuente_quitar', id: f.id, version: f._version }); await cargar(true) }, 'tiny ghost danger'))))
    }
    if (!P.datos.fuentes.length) box.append(el('p', { class: 'small muted' }, 'Todavía no hay fuentes. Agregá una o importá el CSV del equipo.'))
  }
  async function vista(item, box) {
    if (!item.video_path && !item.imagenes?.length) return
    try {
      const { urls } = await post({ op: 'vista_media', video_path: item.video_path, imagenes: item.imagenes || [] })
      if (!box.isConnected) return
      if (item.video_path) box.append(el('video', { src: urls[0], controls: true, preload: 'metadata', style: 'max-width:220px;max-height:340px;border-radius:10px' }))
      else box.append(...urls.map(src => el('img', { src, alt: 'Imagen de la publicación para revisar', loading: 'lazy', style: 'max-width:180px;max-height:250px;object-fit:contain' })))
    } catch (e) { if (box.isConnected) box.append(el('p', { class: 'small' }, e.message)) }
  }
  function editarContenido(item, esCola = false) {
    const titulo = entrada(item.titulo || '', { maxlength: 60, required: true })
    const descripcion = el('textarea', { rows: 5, maxlength: 4000, required: true }, item.descripcion || '')
    const hashtags = entrada((item.hashtags || []).join(' '))
    const media = selector([['reusar', 'Reusar'], ['modificar', 'Modificar'], ['regenerar', 'Regenerar']], item.media || 'reusar')
    const recorte = entrada(item.recorte || '', { maxlength: 300 })
    const instrucciones = el('textarea', { rows: 3, maxlength: 2000 }, item.instrucciones_media || '')
    const destinos = checksRedes(item.plataformas || [item.plataforma])
    const revisado = entrada('', { type: 'checkbox', checked: !!item.media_lista, style: 'width:auto' })
    let video_path = item.video_path || '', imagenes = [...(item.imagenes || [])]
    const propio = selector([['', 'Sin video de la biblioteca'], ...S.clips.filter(c => c.video_path).map(c => [c.video_path, c.titulo || c.gancho || c.id])], video_path)
    const archivos = entrada('', { type: 'file', accept: 'video/mp4,image/png,image/jpeg,image/webp', multiple: true })
    const carga = el('p', { class: 'small muted' }, '')
    propio.addEventListener('change', () => { video_path = propio.value; if (video_path) imagenes = []; revisado.checked = false })
    async function subir() {
      if (!archivos.files.length) return
      const paths = []
      const files = [...archivos.files]
      if (files.length > 10 || files.some(f => f.type === 'video/mp4') && files.length > 1) throw new Error('Elegí un video o hasta 10 imágenes.')
      for (const f of files) {
        const d = await post({ op: 'subir_media', tipo: f.type, peso: f.size })
        const r = await fetch(d.url, { method: 'PUT', headers: { 'Content-Type': f.type }, body: f })
        if (!r.ok) throw new Error('No se pudo subir ' + f.name)
        paths.push(d.path)
      }
      if (files[0].type === 'video/mp4') { video_path = paths[0]; imagenes = [] } else { video_path = ''; imagenes = paths }
      carga.textContent = 'Material subido. Revisá la vista previa antes de aprobar.'
      revisado.checked = false; archivos.value = ''
    }
    const contenido = el('div', { style: 'display:grid;gap:12px' }, campo('Título', titulo), campo('Descripción en español', descripcion), campo('Hashtags', hashtags),
      !esCola && destinos, campo('Material', media), campo('Video de la biblioteca', propio), campo('Subir video o imágenes preparadas', archivos), carga,
      campo('Recorte pedido', recorte), campo('Qué hay que modificar o regenerar', instrucciones), !esCola && campo('Revisé el material y está listo', revisado))
    dialogo(esCola ? 'Editar y aprobar este envío' : 'Preparar publicación', contenido, async () => {
      await subir()
      const datos = { titulo: titulo.value, descripcion: descripcion.value, hashtags: hashtags.value, plataformas: esCola ? [item.plataforma] : destinos.valores(), media: media.value,
        video_path, imagenes, recorte: recorte.value, instrucciones_media: instrucciones.value, media_lista: revisado.checked }
      const cambiaMedia = ['video_path', 'imagenes', 'recorte', 'instrucciones_media', 'media'].some(k => JSON.stringify(datos[k] || '') !== JSON.stringify(item[k] || ''))
      await post({ op: esCola ? (cambiaMedia ? 'cola_preparar' : 'cola_editar') : 'sugerencia_guardar', id: item.id, version: item._version, datos })
      if (esCola && cambiaMedia) { P.tab = 'sugerencias'; toast('El material vuelve a preparación para revisarlo antes de aprobar.') }
    }, esCola ? 'Guardar y aprobar cambios' : 'Guardar para revisar')
  }
  function sugerencias(box) {
    box.append(boton('Traer clips aprobados', async () => { const d = await post({ op: 'sugerir_clips' }); toast(d.agregadas + ' sugerencias nuevas'); await cargar(true) }))
    for (const s of P.datos.sugerencias.filter(s => s.estado !== 'aprobada')) {
      const preview = el('div', { class: 'row', style: 'overflow:auto' })
      box.append(el('article', { style: 'padding:20px 0;border-bottom:1px solid var(--line)' }, el('h3', {}, s.titulo), el('p', { style: 'white-space:pre-wrap' }, s.descripcion),
        el('p', { class: 'small' }, (s.hashtags || []).join(' ')), el('p', { class: 'small muted' }, (s.plataformas || []).map(p => redes[p]).join(' · ')),
        s.fuente_url && el('a', { href: s.fuente_url, target: '_blank', rel: 'noopener noreferrer' }, 'Ver fuente'),
        el('p', { class: 'small muted' }, s.motivo), s.recorte && el('p', { class: 'small' }, 'Recorte: ' + s.recorte), s.instrucciones_media && el('p', { class: 'small' }, s.instrucciones_media), preview,
        el('div', { class: 'row', style: 'margin-top:12px' }, boton('Editar y preparar', () => editarContenido(s)),
          boton('Preparar material con IA', async () => { await post({ op: 'preparar_media', id: s.id, version: s._version }); toast('Preparación en cola'); await cargar(true) }),
          boton('Aprobar y enviar a cola', async () => { await post({ op: 'aprobar', id: s.id, version: s._version }); toast('Aprobada y en cola'); P.tab = 'cola'; await cargar(true) }, 'tiny primary'))))
      vista(s, preview)
    }
    if (!P.datos.sugerencias.some(s => s.estado !== 'aprobada')) box.append(el('p', { class: 'small muted' }, 'Generá trabajo desde una fuente o traé clips aprobados.'))
  }
  function cola(box) {
    box.append(boton('Procesar próximo envío', async () => { const d = await post({ op: 'procesar' }); toast(d.activo === false ? 'Los envíos automáticos todavía están en espera.' : 'Cola revisada'); await cargar(true) }))
    for (const p of [...P.datos.cola].sort((a, b) => b.creado - a.creado)) {
      const acciones = el('div', { class: 'row' })
      acciones.append(boton('Copiar título y descripción', async () => { await navigator.clipboard.writeText([p.titulo, p.descripcion, (p.hashtags || []).join(' ')].filter(Boolean).join('\n\n')); toast('Texto copiado') }))
      if (['pendiente', 'error'].includes(p.estado) && !p.remoto_id) acciones.append(boton('Editar antes de salir', () => editarContenido(p, true)), boton('Cancelar', async () => { await post({ op: 'cola_cancelar', id: p.id, version: p._version }); await cargar(true) }))
      if (p.estado === 'borrador') acciones.append(boton('Confirmar que ya lo publiqué', () => {
        const url = entrada('', { type: 'url', required: true })
        dialogo('Confirmar publicación manual', campo('Link público de la publicación', url), () => post({ op: 'confirmar_manual', id: p.id, version: p._version, url: url.value }), 'Confirmar')
      }))
      box.append(el('article', { style: 'padding:18px 0;border-bottom:1px solid var(--line)' }, el('h3', {}, redes[p.plataforma] + ' · ' + p.titulo), el('p', {}, etiquetas[p.estado] || p.estado),
        el('p', { class: 'small muted' }, 'Aprobó ' + p.aprobado_por + ' · ' + fecha(p.aprobado_el)), p.error && el('p', { class: 'small', style: 'color:var(--bad)' }, p.error),
        p.enlace && el('a', { href: p.enlace, target: '_blank', rel: 'noopener noreferrer' }, p.estado === 'borrador' ? 'Abrir borrador' : 'Ver publicación'), acciones))
    }
    if (!P.datos.cola.length) box.append(el('p', { class: 'small muted' }, 'Las publicaciones aprobadas van a aparecer acá.'))
  }
  function actividad(box) {
    for (const t of P.datos.trabajos.filter(t => t.tipo === 'media')) box.append(el('p', { class: 'small' }, 'Preparación de material · ' + (etiquetas[t.estado] || t.estado) + (t.error ? ': ' + t.error : '')))
    for (const e of P.datos.eventos) {
      const fuente = e.fuente_url || P.datos.fuentes.find(f => f.id === e.fuente_id)?.url
      box.append(el('p', { class: 'small', style: 'border-bottom:1px solid var(--line);padding:8px 0' }, fecha(e.el) + ' · ' + e.por + ' · ' + e.accion.replaceAll('_', ' ') + (e.plataforma ? ' · ' + redes[e.plataforma] : '') + (e.aprobado_por ? ' · aprobó ' + e.aprobado_por : '') + (e.resultado ? ' · ' + e.resultado : ''), fuente && el('a', { href: fuente, target: '_blank', rel: 'noopener noreferrer', style: 'display:block' }, 'Ver fuente')))
    }
    if (!P.datos.eventos.length) box.append(el('p', { class: 'small muted' }, 'Todavía no hay actividad registrada.'))
  }
  function metricas(box) {
    const red = selector(Object.entries(redes), P.red || 'instagram'), ventana = selector([['24h', '24 h'], ['7d', '7 días'], ['28d', '28 días'], ['historico', 'Histórico']], P.ventana || '7d')
    const resultado = el('div')
    async function mostrar(sincronizar = false) {
      P.red = red.value; P.ventana = ventana.value; resultado.replaceChildren(el('p', { class: 'small muted' }, 'Cargando métricas…'))
      try {
        const { datos } = sincronizar ? await api('/api/metricas', { red: red.value, ventana: ventana.value }) : await api('/api/metricas?red=' + red.value + '&ventana=' + ventana.value)
        resultado.replaceChildren()
        if (!datos) { resultado.append(el('p', { class: 'small muted' }, 'Todavía no hay datos. Conectá la cuenta y tocá Sincronizar.')); return }
        resultado.append(el('p', { class: 'small muted' }, 'Sincronizado: ' + fecha(datos.sincronizada_el)), el('p', { class: 'small muted' }, datos.nota), el('p', { class: 'small muted' }, 'Período informado: ' + fecha(datos.rango.desde) + ' a ' + fecha(datos.rango.hasta)))
        const nombres = { seguidores: 'Seguidores actuales', follows: 'Seguidores ganados', vistas: 'Vistas', likes: 'Likes', comentarios: 'Comentarios', compartidos: 'Compartidos', guardados: 'Guardados', alcance: 'Alcance', impresiones: 'Impresiones', tiempo_medio: 'Tiempo medio (s)', retencion: 'Porcentaje medio visto (%)', completado: 'Reproducciones completas (%)', ctr: 'CTR', clics: 'Clics al link', engagement: 'Interacciones / alcance' }
        const tabla = el('table', {}, el('thead', {}, el('tr', {}, ['Métrica', 'Actual', 'Período anterior', 'Cambio'].map(t => el('th', {}, t)))))
        const cuerpo = el('tbody')
        for (const [k, nombre] of Object.entries(nombres)) {
          const a = datos.actual?.[k], b = datos.anterior?.[k], cambio = typeof a === 'number' && typeof b === 'number' && b !== 0 ? ((a - b) / b * 100).toFixed(1) + '%' : '—'
          const valor = n => k === 'engagement' && typeof n === 'number' ? num(n * 100) + '%' : num(n)
          cuerpo.append(el('tr', {}, el('td', {}, nombre), el('td', { class: 'n' }, valor(a)), el('td', { class: 'n' }, valor(b)), el('td', { class: 'n' }, cambio)))
        }
        tabla.append(cuerpo); resultado.append(el('div', { class: 'tbl' }, tabla))
        const registradas = P.datos.cola.filter(p => p.plataforma === red.value && p.estado === 'publicado' && p.publicado_el >= datos.rango.desde && p.publicado_el <= datos.rango.hasta)
        resultado.append(el('p', { class: 'small' }, registradas.length + ' publicaciones registradas en esta app durante el período.'))
        const posts = [...(datos.posts || [])].sort((a, b) => (b.vistas || 0) - (a.vistas || 0))
        if (posts.length) resultado.append(el('h3', {}, 'Publicaciones · primero la de más vistas'))
        for (const p of posts) {
          const enlace = p.enlace || (p.video ? 'https://www.youtube.com/watch?v=' + encodeURIComponent(p.video) : null)
          resultado.append(el('details', {}, el('summary', {}, (p.titulo || p.video || p.id) + ' · ' + num(p.vistas) + ' vistas'),
            enlace && el('a', { href: enlace, target: '_blank', rel: 'noopener noreferrer' }, 'Ver publicación'),
            ...Object.entries(nombres).filter(([k]) => k !== 'seguidores').map(([k, n]) => el('p', { class: 'small' }, n + ': ' + num(p[k])))))
        }
      } catch (e) { resultado.replaceChildren(el('p', { class: 'small' }, e.message)) }
    }
    red.addEventListener('change', () => mostrar()); ventana.addEventListener('change', () => mostrar())
    box.append(el('div', { class: 'row' }, campo('Cuenta', red), campo('Ventana', ventana), boton('Sincronizar', () => mostrar(true))), resultado)
    mostrar()
  }
  window.aprobarClipPublicacion = c => {
    const destinos = checksRedes()
    dialogo('Aprobar clip', el('div', {}, el('p', {}, c.titulo || c.gancho), el('p', { class: 'small' }, 'Elegí dónde publicarlo. Instagram, Facebook y X se envían automáticamente cuando las conexiones están habilitadas. YouTube y TikTok quedan en borrador.'), destinos), async () => {
      await post({ op: 'aprobar_clip', id: c.id, version: c._version, plataformas: destinos.valores() }); toast('Clip aprobado y en cola'); await window.cargar?.()
    }, 'Aprobar y enviar a cola')
  }
  $('pubActualizar').addEventListener('click', () => cargar(true))
  render(); cargar()
  setInterval(() => { if (!document.hidden) cargar() }, 30000)
})()
