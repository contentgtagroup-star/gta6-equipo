/* Usa la conexión, componentes y paleta del panel existente. */
(() => {
  const P = { tab: 'conexiones', datos: null, cargando: false, modal: false, firma: '', error: '', etag: '' }
  const redes = { instagram: 'Instagram', facebook: 'Facebook', x: 'X', youtube: 'YouTube', tiktok: 'TikTok' }
  const etiquetas = { sin_conectar: 'Sin conectar', sin_verificar: 'Por verificar', conectada: 'Conectada', token_vencido: 'Token vencido', pendiente: 'En cola', procesando: 'Procesando', enviando: 'Enviando', revisar: 'Revisar en la red', error: 'Error', borrador: 'Borrador · falta publicar', manual: 'Para subir a mano a X', publicado: 'Publicado', cancelado: 'Cancelado', ejecutando: 'Trabajando', terminado: 'Terminado' }
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
  async function traer() {
    // GET condicional: si el ETag no cambió, el server responde 304 sin cuerpo y no baja todo de nuevo.
    const headers = { 'x-clave': S.clave }
    if (P.etag) headers['If-None-Match'] = P.etag
    const r = await fetch('/api/publicacion', { headers })
    if (r.status === 304) return null
    if (r.status === 401) { window.salir?.('La clave no es correcta.'); throw new Error('clave') }
    const d = await r.json().catch(() => ({}))
    if (!r.ok) { const e = new Error(d.error || ('Error ' + r.status)); e.status = r.status; throw e }
    P.etag = r.headers.get('ETag') || P.etag
    return d
  }
  async function cargar(forzar = false) {
    if (!S.clave || P.cargando || P.modal && !forzar) return
    P.cargando = true
    P.ultimaConsulta = Date.now()
    P.error = ''
    if (!P.datos) render()
    try {
      const datos = await traer()
      if (datos) {
        const firma = JSON.stringify(datos), sinDatos = !P.datos
        P.datos = datos
        $('pubEstado').textContent = datos.automatico_activo ? 'Solo se envía material aprobado. YouTube y TikTok quedan en borrador.' : 'Podés preparar y revisar publicaciones. Los envíos automáticos todavía están en espera.'
        if (firma !== P.firma || forzar || sinDatos) { P.firma = firma; render() }
      } else if (forzar && P.datos) render()
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
        el('p', {}, etiquetas[c.estado] || c.estado), el('p', { class: 'small muted' }, c.modo === 'automatico' ? 'Publica después de aprobar.' : c.modo === 'manual' ? 'Se sube a mano: copiás el texto y el video, y lo publicás en X.' : c.id === 'tiktok' ? 'Llega al Inbox: terminás de publicar en TikTok.' : 'Se sube como privado: revisás el Short en YouTube Studio.'),
        c.entorno === 'sandbox' && el('p', { class: 'small muted' }, 'TikTok sandbox: conexión de prueba, con las cuentas autorizadas en esa app.'),
        c.metodo === 'system_user' && el('p', { class: 'small muted' }, 'Conexión con el usuario del sistema de Meta. Si se renueva el token en Vercel, tocá Reconectar.'),
        c.metodo === 'refresh_token' && el('p', { class: 'small muted' }, 'YouTube usa el token renovable configurado en Vercel. Si se renueva, tocá Reconectar.'),
        c.faltan_permisos?.length > 0 && el('p', { class: 'small' }, 'Faltan permisos para métricas: ' + c.faltan_permisos.join(', ') + '. La publicación sigue funcionando.'),
        c.falta_config && el('p', { class: 'small' }, 'Falta configurar en Vercel: ' + c.falta_config + '.'),
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
  function generarDesdeLink(box) {
    const link = entrada('', { placeholder: 'Pegá el link de un post (X, etc.) y generá la publicación', maxlength: 1000, style: 'flex:1;min-width:220px' })
    const enfoque = entrada('', { placeholder: 'Enfoque distinto (opcional)', maxlength: 400 })
    const generar = boton('Generar desde link', async () => {
      const url = link.value.trim()
      if (!url) return toast('Pegá un link primero.')
      await post({ op: 'generar_link', url, enfoque: enfoque.value }); link.value = ''; enfoque.value = ''
      toast('Generando. La vas a ver en Sugerencias.'); P.tab = 'sugerencias'; await cargar(true)
    }, 'tiny primary')
    link.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); generar.click() } })
    box.append(el('article', { class: 'bloque', style: 'padding-bottom:14px;border-bottom:1px solid var(--line);margin-bottom:10px' },
      el('h3', { class: 'small', style: 'margin:0 0 8px' }, 'Generar desde link'),
      el('div', { class: 'row', style: 'flex-wrap:wrap' }, link, enfoque, generar),
      el('p', { class: 'small muted', style: 'margin:8px 0 0' }, 'Capta el texto y las imágenes del post, lo adapta al español y deja la publicación en Sugerencias para revisar y aprobar.')))
  }
  function fuentes(box) {
    generarDesdeLink(box)
    box.append(el('div', { class: 'row' }, boton('Agregar fuente', () => editarFuente(), 'tiny primary'), boton('Importar fuentes del equipo', async () => { const d = await post({ op: 'importar_fuentes' }); toast(d.agregadas + ' fuentes nuevas'); await cargar(true) })))
    box.append(el('p', { class: 'small muted' }, 'Un perfil se revisa periódicamente si activás el rastreo. Un enlace puntual admite una sugerencia activa a la vez. Los enlaces pendientes de verificar se importan pausados.'))
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
  async function vista(item, box, fallo = () => {}) {
    if (!item.video_path && !item.imagenes?.length) return
    try {
      const { urls } = await post({ op: 'vista_media', video_path: item.video_path, imagenes: item.imagenes || [] })
      if (!box.isConnected) return false
      if (item.video_path) box.append(el('video', { src: urls[0], onerror: fallo, controls: true, preload: 'none', style: 'max-width:220px;max-height:340px;border-radius:10px' }))
      else box.append(...urls.map((src, i) => el('a', { href: src, target: '_blank', rel: 'noopener noreferrer', 'aria-label': 'Ampliar imagen ' + (i + 1) },
        el('img', { src, onerror: fallo, alt: 'Imagen ' + (i + 1) + ' de ' + urls.length, loading: 'lazy', style: 'max-width:180px;max-height:250px;object-fit:contain' }))))
      return true
    } catch (e) { if (box.isConnected) box.append(el('p', { class: 'small' }, e.message)); return false }
  }
  function editarContenido(item, esCola = false) {
    const titulo = entrada(item.titulo || '', { maxlength: 60, required: true })
    const descripcion = el('textarea', { rows: 5, maxlength: 4000, required: true }, item.descripcion || '')
    const hashtags = entrada((item.hashtags || []).join(' '))
    const media = selector([['reusar', 'Reusar'], ['modificar', 'Modificar'], ['regenerar', 'Regenerar']], item.media || 'reusar')
    const recorte = entrada(item.recorte || '', { maxlength: 300 })
    const instrucciones = el('textarea', { rows: 3, maxlength: 2000 }, item.instrucciones_media || '')
    let video_path = item.video_path || '', imagenes = [...(item.imagenes || [])]
    const propio = selector([['', 'Sin video de la biblioteca'], ...S.clips.filter(c => c.video_path).map(c => [c.video_path, c.titulo || c.gancho || c.id])], video_path)
    const archivos = entrada('', { type: 'file', accept: 'video/mp4,image/png,image/jpeg,image/webp', multiple: true })
    const carga = el('p', { class: 'small muted' }, '')
    const previewLocal = el('div', { class: 'row', style: 'flex-wrap:wrap' })
    let urlsLocales = []
    function limpiarPreviewLocal() {
      for (const url of urlsLocales) URL.revokeObjectURL(url)
      urlsLocales = []
      previewLocal.replaceChildren()
    }
    archivos.addEventListener('change', () => {
      limpiarPreviewLocal()
      for (const f of [...archivos.files].slice(0, 10)) {
        const src = URL.createObjectURL(f)
        urlsLocales.push(src)
        previewLocal.append(f.type === 'video/mp4'
          ? el('video', { src, controls: true, preload: 'none', style: 'max-width:220px' })
          : el('img', { src, alt: f.name, style: 'max-width:180px;max-height:220px;object-fit:contain' }))
      }
    })
    propio.addEventListener('change', () => { video_path = propio.value; if (video_path) imagenes = [] })
    let archivosSubidos = null
    archivos.addEventListener('change', () => { archivosSubidos = null })
    async function subir() {
      if (!archivos.files.length || archivos.files === archivosSubidos) return
      const paths = []
      const files = [...archivos.files]
      if (files.length > 10 || files.some(f => f.type === 'video/mp4') && files.length > 1) throw new Error('Elegí un video o hasta 10 imágenes.')
      for (const f of files) {
        const d = await post({ op: 'subir_media', tipo: f.type, peso: f.size })
        const r = await fetch(d.url, { method: 'PUT', headers: { 'Content-Type': f.type, 'x-upsert': 'false', 'Cache-Control': 'max-age=3600' }, body: f })
        if (!r.ok) throw new Error('No se pudo subir ' + f.name)
        paths.push(d.path)
      }
      if (files[0].type === 'video/mp4') { video_path = paths[0]; imagenes = [] } else { video_path = ''; imagenes = paths }
      carga.textContent = 'Material subido. Revisá la vista previa antes de aprobar.'
      archivosSubidos = archivos.files
    }
    const contenido = el('div', { style: 'display:grid;gap:12px' }, campo('Título', titulo), campo('Descripción en español', descripcion), campo('Hashtags', hashtags),
      campo('Material', media), campo('Video de la biblioteca', propio), campo('Subir video o imágenes preparadas', archivos), previewLocal, carga,
      campo('Recorte pedido', recorte), campo('Qué hay que modificar o regenerar', instrucciones))
    const modal = dialogo(esCola ? 'Editar y aprobar este envío' : 'Preparar publicación', contenido, async () => {
      await subir()
      const datos = { titulo: titulo.value, descripcion: descripcion.value, hashtags: hashtags.value, plataformas: esCola ? [item.plataforma] : item.plataformas, media: media.value,
        video_path, imagenes, recorte: recorte.value, instrucciones_media: instrucciones.value, media_lista: false }
      const cambiaMedia = ['video_path', 'imagenes', 'recorte', 'instrucciones_media', 'media'].some(k => JSON.stringify(datos[k] || '') !== JSON.stringify(item[k] || ''))
      await post({ op: esCola ? (cambiaMedia ? 'cola_preparar' : 'cola_editar') : 'sugerencia_guardar', id: item.id, version: item._version, datos })
      if (esCola && cambiaMedia) { P.tab = 'sugerencias'; toast('El material vuelve a preparación para revisarlo antes de aprobar.') }
    }, esCola ? 'Guardar y aprobar cambios' : 'Guardar para revisar')
    modal.addEventListener('close', limpiarPreviewLocal, { once: true })
  }
  function publicarSugerencia(item, clip = false) {
    const fotos = !item.video_path && !!item.imagenes?.length
    const tieneMedia = !!item.video_path || fotos
    const cuentas = P.datos.conexiones.filter(c => (fotos && ['youtube', 'tiktok'].includes(c.id)) ||
      ((c.estado === 'conectada' || c.modo === 'manual') && (tieneMedia || c.id === 'x')))
    const preview = el('div', { class: 'row', style: 'overflow:auto;flex-wrap:wrap' })
    const opciones = cuentas.map(c => {
      let motivo = ''
      if (fotos && c.id === 'tiktok') {
        if (c.estado !== 'conectada' || !c.permisos?.includes('video.upload')) motivo = 'Falta conectar TikTok con permiso de subida.'
        else if (!P.datos.tiktok_fotos_configurado) motivo = 'Falta verificar el prefijo de imágenes en TikTok.'
        else if (item.imagenes.some(p => !/\.(jpe?g|webp)$/i.test(p))) motivo = 'TikTok requiere placas JPEG o WebP.'
      }
      const input = entrada('', { type: 'checkbox' })
      input.disabled = !!motivo
      const modo = fotos && c.id === 'youtube' ? 'Publicación manual' : fotos && c.id === 'tiktok' ? 'Enviar a bandeja' :
        c.modo === 'borrador' ? 'Borrador' : c.modo === 'manual' ? 'Manual' : 'Automático'
      const cuenta = c.cuenta_conectada || c.cuenta
      const label = el('label', { class: 'pub-check' }, input,
        el('span', {}, el('strong', {}, c.nombre), el('small', {}, [cuenta, modo, motivo].filter(Boolean).join(' · '))))
      return { id: c.id, input, label }
    })
    const textoPublico = String(item.descripcion || '').replace(/^[ \t]*(?:original(?:es)?|fuentes?)[ \t]*:[ \t]*(?:https?:[^\s]+[ \t]*)?(?:\r?\n[ \t]*https?:[^\s]+[ \t]*)*[ \t]*(?:\r?\n|$)/gim, '').replace(/(?:\r?\n){3,}/g, '\n\n').trim()
    const lineaHashtags = textoPublico.match(/(?:^|\n)((?:#[\p{L}\p{N}_]+[ \t]*)+)$/u)
    const tagsOriginales = Array.isArray(item.hashtags) ? item.hashtags : []
    const hashtags = entrada([...new Set([...tagsOriginales, ...(lineaHashtags ? lineaHashtags[1].trim().split(/\s+/) : [])])].join(' '))
    const titulo = entrada(String(item.titulo || item.gancho || 'Clip GTA 6').slice(0, 60), { maxlength: 60 })
    const descripcion = el('textarea', { rows: 4, maxlength: 4000, value: lineaHashtags ? textoPublico.slice(0, lineaHashtags.index).trim() : textoPublico })
    const revisado = entrada('', { type: 'checkbox' })
    const tituloVista = el('h3')
    const descripcionVista = el('p', { style: 'white-space:pre-wrap' })
    const hashtagsVista = el('p', { class: 'small muted' })
    const editor = el('div', { class: 'pub-review-editor', hidden: true },
      campo('Título', titulo), campo('Descripción', descripcion), campo('Hashtags', hashtags))
    const textoVista = el('div', { class: 'pub-review-copy' }, tituloVista, descripcionVista, hashtagsVista)
    const editar = boton('✎ Editar texto', () => {
      const abierto = editor.hidden
      editor.hidden = !abierto
      textoVista.hidden = abierto
      editar.textContent = abierto ? 'Ver vista previa' : '✎ Editar texto'
      editar.setAttribute('aria-expanded', String(abierto))
      if (abierto) titulo.focus()
    })
    editar.setAttribute('aria-expanded', 'false')
    function actualizarTexto() {
      tituloVista.textContent = titulo.value
      descripcionVista.textContent = descripcion.value
      hashtagsVista.textContent = hashtags.value
      revisado.checked = false
    }
    for (const campoTexto of [titulo, descripcion, hashtags]) campoTexto.addEventListener('input', actualizarTexto)
    actualizarTexto()
    let vistaLista = !tieneMedia
    dialogo('Revisar y publicar', el('div', { style: 'display:grid;gap:14px' },
      el('div', { class: 'pub-review-copy-head' }, el('div', { style: 'flex:1;min-width:0' }, textoVista, editor), editar), preview,
      el('fieldset', { class: 'pub-destinos' }, el('legend', {}, 'Destinos de publicación'), opciones.map(c => c.label),
        !opciones.length && el('p', {}, 'No hay cuentas disponibles para este formato.')),
      el('label', { class: 'pub-check pub-check-confirm' }, revisado, 'Revisé la publicación y el material')), async () => {
      if (!vistaLista || !revisado.checked) throw new Error('Revisá la vista previa y confirmá que está lista.')
      const plataformas = opciones.filter(c => !c.input.disabled && c.input.checked).map(c => c.id)
      if (!plataformas.length) throw new Error('Elegí al menos una cuenta.')
      if (!titulo.value.trim() || !descripcion.value.trim()) throw new Error('Completá el título y la descripción.')
      await post({ op: clip ? 'aprobar_clip' : 'aprobar', id: item.id, version: item._version, revisado: true, plataformas,
        titulo: titulo.value, descripcion: descripcion.value, hashtags: hashtags.value })
      if (clip) await window.cargar?.()
      P.tab = 'cola'; toast('En cola para las cuentas seleccionadas')
    }, 'Confirmar publicación')
    if (tieneMedia) vista(item, preview, () => { vistaLista = false }).then(lista => { vistaLista = lista })
  }
  const trabajoActivo = t => ['pendiente', 'ejecutando'].includes(t.estado)
  function progresoTrabajo(t, titulo) {
    const etapas = { iniciando: 'Motor tomó el trabajo', capturando: 'Capturando la fuente', preparando: 'Fuente capturada',
      redactando: 'Redactando la sugerencia', modelando: 'Modelando imágenes', subiendo: 'Subiendo material privado',
      guardando: 'Guardando el resultado', lista: 'Lista para revisar' }
    const terminado = t.estado === 'terminado'
    const porcentaje = terminado ? 100 : t.estado === 'pendiente' ? 0
      : Math.max(0, Math.min(99, t.porcentaje ?? (t.estado === 'ejecutando' ? 10 : 0)))
    const etapa = t.estado === 'pendiente' ? 'Esperando al motor' : terminado ? etapas.lista
      : t.estado === 'error' ? 'Error en el trabajo' : etapas[t.etapa] || 'Motor en ejecución'
    const persona = t.pedido_por ? ' · ' + t.pedido_por : ''
    return el('div', { class: 'pub-progreso' },
      el('div', { class: 'pub-progreso-titulo' }, el('strong', {}, titulo), el('span', {}, porcentaje + '%')),
      el('progress', { max: 100, value: porcentaje, 'aria-label': titulo + ' · ' + etapa }),
      el('p', { class: 'small muted' }, etapa + persona +
        (t.estado === 'ejecutando' && t.ultimo_latido ? ' · Última señal ' + fecha(t.ultimo_latido) : '')))
  }
  function sugerencias(box) {
    box.append(boton('Traer clips aprobados', async () => { const d = await post({ op: 'sugerir_clips' }); toast(d.agregadas + ' sugerencias nuevas'); await cargar(true) }))
    for (const s of P.datos.sugerencias.filter(s => s.estado === 'pendiente')) {
      const listo = Boolean(s.video_path || s.imagenes?.length)
      const trabajo = P.datos.trabajos.find(t => t.sugerencia_id === s.id && t.tipo === 'media')
      const ocupado = trabajo && trabajoActivo(trabajo)
      const material = el('div', { class: 'card', style: 'padding:12px;margin:10px 0' }, el('h4', {}, 'Material generado'),
        el('p', { class: 'small muted' }, listo ? (s.video_path ? '1 video' : s.imagenes.length + ' imágenes') + ' · versión privada para revisar'
          : trabajo ? '' : 'Todavía no hay material preparado.'))
      if (trabajo && trabajo.estado !== 'cancelado') material.append(progresoTrabajo(trabajo, 'Preparación de material'))
      if (trabajo?.estado === 'error' && trabajo.error) material.append(el('details', {}, el('summary', {}, 'Ver detalle'), el('p', { class: 'small' }, trabajo.error)))
      if (listo) {
        const galeria = el('div', { class: 'row', style: 'flex-wrap:wrap' })
        const detalle = el('details', {}, el('summary', {}, 'Ver material'), galeria)
        let cargada = false
        detalle.addEventListener('toggle', async () => {
          if (!detalle.open || cargada) return
          cargada = true
          galeria.replaceChildren()
          if (!await vista(s, galeria)) cargada = false
        })
        material.append(detalle)
      }
      box.append(el('article', { style: 'padding:20px 0;border-bottom:1px solid var(--line)' }, el('h3', {}, s.titulo), el('p', { style: 'white-space:pre-wrap' }, s.descripcion),
        el('p', { class: 'small' }, (s.hashtags || []).join(' ')), el('p', { class: 'small muted' }, (s.plataformas || []).map(p => redes[p]).join(' · ')),
        s.fuente_url && el('a', { href: s.fuente_url, target: '_blank', rel: 'noopener noreferrer' }, 'Ver fuente'),
        el('p', { class: 'small muted' }, s.motivo), s.recorte && el('p', { class: 'small' }, 'Recorte: ' + s.recorte), s.instrucciones_media && el('p', { class: 'small' }, s.instrucciones_media), material,
        el('div', { class: 'row', style: 'margin-top:12px' }, boton('Editar y preparar', () => editarContenido(s)),
          !ocupado && boton(trabajo?.estado === 'error' ? 'Reintentar preparación' : 'Preparar material con IA', async () => { await post({ op: 'preparar_media', id: s.id, version: s._version }); toast('Preparación en cola'); await cargar(true) }),
          boton('Descartar sugerencia', () => dialogo('Descartar sugerencia', el('p', {}, s.fuente_id
            ? 'Se quita de Sugerencias y podés volver a generar desde el mismo enlace.'
            : 'Se quita de Sugerencias.'), async () => {
            await post({ op: 'sugerencia_descartar', id: s.id, version: s._version })
            toast('Sugerencia descartada')
          }, 'Descartar'), 'tiny ghost danger'),
          !ocupado && (listo || !s.fuente_url) && boton('Publicar', () => publicarSugerencia(s), 'tiny primary'))))
    }
    if (!P.datos.sugerencias.some(s => s.estado === 'pendiente')) box.append(el('p', { class: 'small muted' }, 'Generá trabajo desde una fuente o traé clips aprobados.'))
  }
  function cola(box) {
    const items = P.datos.cola
    const cuenta = items.reduce((a, p) => { a[p.estado] = (a[p.estado] || 0) + 1; return a }, {})
    const trabado = p => ['error', 'revisar'].includes(p.estado) || (p.estado === 'enviando' && (p.vence || 0) < Date.now())
    const nTrabados = items.filter(trabado).length
    const fEstado = selector([['', 'Todos los estados'], ...[...new Set(items.map(p => p.estado))].map(e => [e, etiquetas[e] || e])], P.colaEstado || '')
    const fRed = selector([['', 'Todas las redes'], ...Object.entries(redes)], P.colaRed || '')
    fEstado.onchange = () => { P.colaEstado = fEstado.value; render() }
    fRed.onchange = () => { P.colaRed = fRed.value; render() }
    box.append(el('div', { class: 'row' }, campo('Estado', fEstado), campo('Red', fRed)))
    box.append(el('p', { class: 'small muted' }, items.length + ' en cola · ' + (cuenta.pendiente || 0) + ' pendientes · ' + (cuenta.error || 0) + ' con error · ' + nTrabados + ' trabados'))
    const barra = el('div', { class: 'row' })
    barra.append(boton('Procesar próximo envío', async () => { const d = await post({ op: 'procesar' }); toast(d.activo === false ? 'Los envíos automáticos todavía están en espera.' : 'Cola revisada'); await cargar(true) }))
    if (cuenta.error) barra.append(boton('Reintentar fallados (' + cuenta.error + ')', async () => { const d = await post({ op: 'cola_reintentar_masa' }); toast(d.reintentados + ' reencolados'); await cargar(true) }, 'tiny primary'))
    box.append(barra)
    const lista = items
      .filter(p => !P.colaEstado || p.estado === P.colaEstado)
      .filter(p => !P.colaRed || p.plataforma === P.colaRed)
      .sort((a, b) => (a.proximo_el || a.creado || Infinity) - (b.proximo_el || b.creado || Infinity))
    for (const p of lista) {
      const acciones = el('div', { class: 'row' })
      const youtubeFotos = p.estado === 'manual' && p.plataforma === 'youtube' && !p.video_path && p.imagenes?.length
      const tiktokFotos = p.estado === 'borrador' && p.plataforma === 'tiktok' && !p.video_path && p.imagenes?.length
      const confirmar = () => {
        const url = entrada('', { type: 'url', required: true })
        dialogo('Confirmar publicación manual', campo('Link público de la publicación', url), () => post({ op: 'confirmar_manual', id: p.id, version: p._version, url: url.value }), 'Confirmar')
      }
      acciones.append(boton('Copiar título y descripción', async () => { await navigator.clipboard.writeText([p.titulo, p.descripcion, (p.hashtags || []).join(' ')].filter(Boolean).join('\n\n')); toast('Texto copiado') }))
      if (['pendiente', 'procesando'].includes(p.estado) && !p.remoto_id) acciones.append(
        boton('Priorizar', async () => { await post({ op: 'cola_prioridad', id: p.id, version: p._version, cuando: 'ya' }); toast('Movido al frente'); await cargar(true) }),
        boton('Posponer', async () => { await post({ op: 'cola_prioridad', id: p.id, version: p._version, cuando: 'posponer' }); toast('Pospuesto'); await cargar(true) }))
      if (p.estado === 'error') acciones.append(boton('Reintentar', async () => { await post({ op: 'cola_reintentar', id: p.id, version: p._version }); await cargar(true) }, 'tiny primary'))
      if (['pendiente', 'error', 'manual'].includes(p.estado) && !p.remoto_id) acciones.append(boton('Editar antes de salir', () => editarContenido(p, true)), boton('Cancelar', async () => { await post({ op: 'cola_cancelar', id: p.id, version: p._version }); await cargar(true) }))
      if (p.remoto_id && ['procesando', 'enviando'].includes(p.estado)) acciones.append(boton('Detener reintentos', async () => { await post({ op: 'cola_detener', id: p.id, version: p._version }); await cargar(true) }))
      if (youtubeFotos) {
        p.imagenes.forEach((ruta, i) => acciones.append(boton('Bajar placa ' + (i + 1), async () => {
          const { urls } = await post({ op: 'vista_media', imagenes: [ruta] })
          const descarga = new URL(urls[0])
          descarga.searchParams.set('download', 'placa-' + String(i + 1).padStart(2, '0') + '.' + ruta.split('.').pop())
          const enlace = el('a', { href: descarga.href, download: '' })
          enlace.click()
        })))
        acciones.append(boton('Ya lo publiqué', confirmar))
      } else if (p.estado === 'manual') acciones.append(boton('Bajar video', async () => {
        if (!p.video_path && !p.imagenes?.length) return toast('Esta publicación no tiene video ni imágenes.')
        const { urls } = await post({ op: 'vista_media', video_path: p.video_path, imagenes: p.imagenes || [] })
        urls.forEach(u => window.open(u, '_blank', 'noopener'))
      }), boton('Ya lo publiqué', confirmar))
      if (p.estado === 'borrador') acciones.append(boton('Confirmar que ya lo publiqué', confirmar))
      const preview = el('div', { class: 'row', style: 'overflow:auto;margin:8px 0' })
      box.append(el('article', { style: 'padding:18px 0;border-bottom:1px solid var(--line)' }, el('h3', {}, redes[p.plataforma] + ' · ' + p.titulo),
        el('p', {}, (youtubeFotos ? 'Pendiente manual' : tiktokFotos ? 'En bandeja de TikTok' : etiquetas[p.estado] || p.estado) + (trabado(p) ? ' · ⚠ trabado' : '')),
        p.estado === 'manual' && el('p', { class: 'small muted' }, youtubeFotos ? 'Bajá las placas en orden, copiá el texto y subilo desde + → Publicación en YouTube. Después pegá el enlace.' : 'Copiá el texto, bajá el video y subilo a mano en X. Después tocá "Ya lo publiqué".'),
        el('p', { class: 'small muted' }, 'Aprobó ' + p.aprobado_por + ' · ' + fecha(p.aprobado_el)), p.error && el('details', {}, el('summary', { class: 'small', style: 'color:var(--bad)' }, p.estado === 'revisar' ? 'Ver motivo y qué revisar' : 'Ver motivo del error'), el('p', { class: 'small' }, p.error)),
        p.enlace && el('a', { href: p.enlace, target: '_blank', rel: 'noopener noreferrer' }, p.estado === 'borrador' ? 'Abrir borrador' : 'Ver publicación'), preview, acciones))
      if (p.estado === 'manual') vista(p, preview)
    }
    if (!lista.length) box.append(el('p', { class: 'small muted' }, items.length ? 'No hay envíos con ese filtro.' : 'Las publicaciones aprobadas van a aparecer acá.'))
  }
  function actividad(box) {
    const activas = P.datos.trabajos.filter(trabajoActivo)
    for (const t of activas) {
      const sugerencia = P.datos.sugerencias.find(s => s.id === t.sugerencia_id)
      const titulo = t.tipo === 'media' ? 'Preparación de material' : 'Generación de sugerencia'
      box.append(progresoTrabajo(t, sugerencia?.titulo ? titulo + ' · ' + sugerencia.titulo : titulo))
    }
    const { ancla, siguiente } = P.datos.actividad || {}
    if (P.historial?.clave !== S.clave) P.historial = { clave: S.clave, eventos: [] }
    function fila(e) {
      const fuente = e.fuente_url || P.datos.fuentes.find(f => f.id === e.fuente_id)?.url
      const resultado = e.resultado === 'lista_para_revisar' ? 'Lista para revisar' : e.resultado
      const cabecera = el('p', { class: 'small' }, e.accion.replaceAll('_', ' ') +
        (e.plataforma ? ' · ' + redes[e.plataforma] : '') + (e.aprobado_por ? ' · aprobó ' + e.aprobado_por : ''))
      return el('article', { style: 'border-bottom:1px solid var(--line);padding:6px 0' },
        cabecera, el('p', { class: 'small muted' }, fecha(e.el) + ' · ' + e.por),
        resultado && (String(resultado).length > 140
          ? el('details', {}, el('summary', {}, 'Ver detalle'), el('p', { class: 'small' }, resultado))
          : el('p', { class: 'small' }, resultado)),
        fuente && el('a', { href: fuente, target: '_blank', rel: 'noopener noreferrer' }, 'Ver fuente'))
    }
    function seccion(titulo, estado, historial) {
      const lista = el('div', {}, estado.eventos.map(fila))
      const controles = el('div', { class: 'row' })
      function dibujarControl() {
        controles.replaceChildren()
        if (!estado.cargado || estado.siguiente) controles.append(boton(estado.cargado ? 'Cargar 40 más' : 'Ver actividad anterior', async () => {
          const d = await post({ op: 'actividad_pagina', ancla: estado.ancla, cursor: estado.siguiente, historial })
          estado.eventos.push(...d.eventos)
          estado.cargado = true
          estado.siguiente = d.siguiente
          lista.append(...d.eventos.map(fila))
          if (!estado.eventos.length) lista.append(el('p', { class: 'small muted' }, 'No hay eventos anteriores.'))
          dibujarControl()
        }))
      }
      dibujarControl()
      box.append(el('h3', {}, titulo), lista, controles)
    }
    const eventos = P.datos.eventos || []
    if (!eventos.length) box.append(el('p', { class: 'small muted' }, 'Sin eventos en las últimas 48 horas.'))
    const firma = JSON.stringify(eventos.map(e => [e.id, e._version]))
    if (P.actividadReciente?.firma !== firma || P.actividadReciente?.clave !== S.clave) {
      P.actividadReciente = { firma, clave: S.clave, eventos: [...eventos], ancla, siguiente, cargado: true }
    }
    seccion('Últimas 48 horas', P.actividadReciente, false)
    if (ancla) {
      P.historial.ancla ??= ancla
      seccion('Historial', P.historial, true)
    }
  }
  function metricas(box) {
    const red = selector(Object.entries(redes), P.red || 'instagram'), ventana = selector([['24h', '24 h'], ['7d', '7 días'], ['28d', '28 días'], ['historico', 'Histórico']], P.ventana || '7d')
    const resultado = el('div')
    const acceso = el('p', { class: 'small muted', 'aria-live': 'polite' })
    let pedido = 0
    const ayudaAcceso = {
      instagram: 'Insights de Instagram requiere instagram_manage_insights y acceso al perfil profesional.',
      facebook: 'Insights de la página requiere read_insights, pages_read_engagement y acceso de análisis.',
      x: 'Los datos de X se consultan mediante Buffer. La clave personal necesita acceso de Analytics a la organización y al canal.',
      youtube: 'YouTube Analytics requiere la API habilitada y el permiso yt-analytics.readonly en el token del canal.',
      tiktok: 'Display API requiere user.info.stats para la cuenta y video.list para los videos.'
    }
    async function mostrar(sincronizar = false) {
      const actual = ++pedido, cuenta = red.value, periodo = ventana.value
      P.red = cuenta; P.ventana = periodo
      const conexion = P.datos.conexiones.find(c => c.id === cuenta)
      const nombre = conexion?.cuenta_conectada || conexion?.cuenta || redes[cuenta]
      acceso.textContent = nombre + ' · ' + (etiquetas[conexion?.estado] || 'Estado desconocido') +
        (conexion?.entorno === 'sandbox' ? ' · Sandbox' : '') +
        (conexion?.faltan_permisos?.length ? ' · Faltan permisos: ' + conexion.faltan_permisos.join(', ') : '')
      resultado.replaceChildren(el('p', { class: 'small muted' }, 'Cargando métricas…'))
      try {
        const { datos } = sincronizar ? await api('/api/metricas', { red: cuenta, ventana: periodo }) : await api('/api/metricas?red=' + cuenta + '&ventana=' + periodo)
        if (actual !== pedido || !resultado.isConnected) return
        resultado.replaceChildren()
        if (!datos) { resultado.append(el('p', { class: 'small muted' }, conexion?.estado === 'conectada' ? 'Todavía no hay un informe para esta ventana. Tocá Sincronizar.' : 'Revisá la conexión de esta cuenta y después sincronizá.')); return }
        resultado.append(el('p', { class: 'small muted' }, 'Sincronizado: ' + fecha(datos.sincronizada_el)), el('p', { class: 'small muted' }, datos.nota), el('p', { class: 'small muted' }, 'Período informado: ' + fecha(datos.rango.desde) + ' a ' + fecha(datos.rango.hasta)))
        const nombres = { publicaciones_buffer: 'Posts incluidos por Buffer', interacciones: 'Interacciones', reacciones: 'Reacciones', seguidores: 'Seguidores actuales', follows: 'Seguidores ganados', vistas: 'Vistas', likes: 'Likes', comentarios: 'Comentarios', compartidos: 'Compartidos', guardados: 'Guardados', alcance: 'Alcance', impresiones: 'Impresiones', tiempo_medio: 'Tiempo medio (s)', retencion: 'Porcentaje medio visto (%)', completado: 'Reproducciones completas (%)', ctr: 'CTR', clics: 'Clics al link', engagement: 'Interacciones / alcance' }
        const tabla = el('table', {}, el('thead', {}, el('tr', {}, ['Métrica', 'Actual', 'Período anterior', 'Cambio'].map(t => el('th', {}, t)))))
        const cuerpo = el('tbody')
        const hay = Number.isFinite
        for (const [k, nombre] of Object.entries(nombres).filter(([k]) => hay(datos.actual?.[k]) || hay(datos.anterior?.[k]))) {
          const a = datos.actual?.[k], b = datos.anterior?.[k], cambio = typeof a === 'number' && typeof b === 'number' && b !== 0 ? ((a - b) / b * 100).toFixed(1) + '%' : '—'
          const valor = n => k === 'engagement' && typeof n === 'number' ? num(n * 100) + '%' : num(n)
          cuerpo.append(el('tr', {}, el('td', {}, nombre), el('td', { class: 'n' }, valor(a)), el('td', { class: 'n' }, valor(b)), el('td', { class: 'n' }, cambio)))
        }
        tabla.append(cuerpo)
        if (cuerpo.children.length) resultado.append(el('div', { class: 'tbl' }, tabla))
        else resultado.append(el('p', { class: 'small muted' }, 'La plataforma no devolvió totales para esta ventana.'))
        if (datos.no_disponibles?.length) resultado.append(el('p', { class: 'small muted' },
          'Datos no disponibles: ' + datos.no_disponibles.map(k => nombres[k] || k).join(', ')))
        const registradas = P.datos.cola.filter(p => p.plataforma === cuenta && p.estado === 'publicado' && p.publicado_el >= datos.rango.desde && p.publicado_el <= datos.rango.hasta)
        resultado.append(el('p', { class: 'small' }, registradas.length + ' publicaciones registradas en esta app durante el período.'))
        const posts = [...(datos.posts || [])].sort((a, b) => (b.vistas || 0) - (a.vistas || 0))
        if (posts.length) resultado.append(el('h3', {}, 'Publicaciones · primero la de más vistas'))
        for (const p of posts) {
          const enlace = p.enlace || (p.video ? 'https://www.youtube.com/watch?v=' + encodeURIComponent(p.video) : null)
          resultado.append(el('details', {}, el('summary', {}, (p.titulo || p.video || p.id) + ' · ' + num(p.vistas) + ' vistas'),
            enlace && el('a', { href: enlace, target: '_blank', rel: 'noopener noreferrer' }, 'Ver publicación'),
            ...Object.entries(nombres).filter(([k]) => k !== 'seguidores' && hay(p[k])).map(([k, n]) => el('p', { class: 'small' }, n + ': ' + num(p[k])))))
        }
      } catch (e) {
        if (actual === pedido && resultado.isConnected) resultado.replaceChildren(el('p', { class: 'small', role: 'alert' }, e.message),
          el('p', { class: 'small muted' }, ayudaAcceso[cuenta]))
      }
    }
    red.addEventListener('change', () => mostrar()); ventana.addEventListener('change', () => mostrar())
    box.append(el('div', { class: 'row' }, campo('Cuenta', red), campo('Ventana', ventana), boton('Sincronizar', () => mostrar(true))), acceso, resultado)
    mostrar()
  }
  window.aprobarClipPublicacion = async c => {
    if (P.modal) return
    if (!P.datos) await cargar(true)
    if (P.modal) return
    if (!P.datos) return toast(P.error || 'Las cuentas todavía están cargando. Volvé a tocar Aprobar.')
    publicarSugerencia(c, true)
  }
  $('pubActualizar').addEventListener('click', () => cargar(true))
  // Publicaciones se consulta solo cuando el panel abre esa sección: crear clips no debe esperar a la base.
  const enSeccion = () => !window.estoyEn || window.estoyEn('publicaciones')
  window.publicacionesAlEntrar = () => cargar()
  render(); if (enSeccion()) cargar()
  setInterval(() => {
    if (document.hidden || !enSeccion()) return
    const siguiendo = ['actividad', 'sugerencias'].includes(P.tab) && P.datos?.trabajos?.some(trabajoActivo)
    if (Date.now() - (P.ultimaConsulta || 0) >= (siguiendo ? 5000 : 30000)) cargar()
  }, 5000)
})()
