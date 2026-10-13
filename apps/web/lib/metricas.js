/**
 * Agregación de los indicadores de CU4 (lógica pura).
 *
 * Recibe los documentos crudos de `metricas_diarias` (uno por día+zona+franja)
 * y devuelve las tres filas de indicadores aplicando los filtros pedidos. La
 * base de datos solo lee; el cálculo es puro y testeable.
 */

/**
 * Filtro de analítica.
 * @typedef {object} FiltroMetricas
 * @property {string} [zonaId] Zona exacta; vacío = todas.
 * @property {string} [hubId] Hub exacto; vacío = todos.
 * @property {string} [fecha] Día YYYY-MM-DD; vacío = todos.
 */

/**
 * Fila de la tasa de entrega en primer intento.
 * @typedef {object} FilaTasa
 * @property {string} fecha Día.
 * @property {string} zonaId Zona.
 * @property {string} franja Franja.
 * @property {number} intentos Total de primeros intentos.
 * @property {number} exitosos Entregados en el primer intento.
 * @property {number} tasa Porcentaje de éxito [0, 100].
 */

/**
 * Fila de motivos de fallo por zona.
 * @typedef {object} FilaMotivo
 * @property {string} zonaId Zona.
 * @property {string} motivo Motivo de fallo.
 * @property {number} cantidad Fallos con ese motivo.
 */

/**
 * Fila de cumplimiento de SLA por hub.
 * @typedef {object} FilaSla
 * @property {string} hubId Hub.
 * @property {string} fecha Día.
 * @property {number} cumplidos Entregas dentro del vencimiento.
 * @property {number} incumplidos Entregas vencidas.
 * @property {number} cumplimiento Porcentaje de cumplimiento [0, 100].
 */

/**
 * Resultado agregado de los tres indicadores.
 * @typedef {object} ResumenMetricas
 * @property {FilaTasa[]} tasaPrimerIntento Tasa por día/zona/franja.
 * @property {FilaMotivo[]} motivos Distribución de motivos por zona.
 * @property {FilaSla[]} slaHub Cumplimiento de SLA por hub y día.
 */

/**
 * Aplica los filtros día/zona a los documentos crudos (el filtro de hub se
 * aplica dentro del agregado de SLA, porque el hub es una dimensión interna).
 * @param {import('./mongo.js').DocVista[]} docs Documentos de metricas_diarias.
 * @param {FiltroMetricas} filtro Filtros.
 * @returns {import('./mongo.js').DocVista[]} Documentos que pasan el filtro.
 */
function filtrarDocs(docs, filtro) {
  return docs.filter(
    (d) =>
      (!filtro.zonaId || d.zonaId === filtro.zonaId) && (!filtro.fecha || d.fecha === filtro.fecha),
  );
}

/**
 * Agrega la tasa de entrega en primer intento por día, zona y franja.
 * @param {import('./mongo.js').DocVista[]} docs Documentos ya filtrados por zona/fecha.
 * @returns {FilaTasa[]} Filas ordenadas por fecha desc, zona, franja.
 */
function agregarTasa(docs) {
  return docs
    .filter((d) => d.intentosPrimeros?.total > 0)
    .map((d) => ({
      fecha: String(d.fecha),
      zonaId: String(d.zonaId),
      franja: String(d.franja),
      intentos: Number(d.intentosPrimeros.total),
      exitosos: Number(d.intentosPrimeros.exitosos ?? 0),
      tasa: Math.round(
        (Number(d.intentosPrimeros.exitosos ?? 0) / Number(d.intentosPrimeros.total)) * 1000,
      ) / 10,
    }))
    .sort(
      (a, b) => b.fecha.localeCompare(a.fecha) || a.zonaId.localeCompare(b.zonaId) || a.franja.localeCompare(b.franja),
    );
}

/**
 * Agrega la distribución de motivos de fallo por zona.
 * @param {import('./mongo.js').DocVista[]} docs Documentos ya filtrados por zona/fecha.
 * @returns {FilaMotivo[]} Filas ordenadas por zona y cantidad desc.
 */
function agregarMotivos(docs) {
  /** @type {Map<string, FilaMotivo>} */
  const porClave = new Map();
  for (const d of docs) {
    const motivos = /** @type {Record<string, number> | undefined} */ (d.motivos);
    if (!motivos) continue;
    for (const [motivo, cantidad] of Object.entries(motivos)) {
      const clave = `${d.zonaId}|${motivo}`;
      const fila = porClave.get(clave) ?? { zonaId: String(d.zonaId), motivo, cantidad: 0 };
      fila.cantidad += Number(cantidad);
      porClave.set(clave, fila);
    }
  }
  return [...porClave.values()].sort(
    (a, b) => a.zonaId.localeCompare(b.zonaId) || b.cantidad - a.cantidad,
  );
}

/**
 * Agrega el cumplimiento de SLA por hub y día (aplica el filtro de hub).
 * @param {import('./mongo.js').DocVista[]} docs Documentos ya filtrados por zona/fecha.
 * @param {FiltroMetricas} filtro Filtros (usa filtro.hubId).
 * @returns {FilaSla[]} Filas ordenadas por hub y fecha.
 */
function agregarSla(docs, filtro) {
  /** @type {Map<string, FilaSla>} */
  const porClave = new Map();
  for (const d of docs) {
    const porHub = /** @type {Record<string, {sla?: {cumplidos?: number, incumplidos?: number}}> | undefined} */ (d.porHub);
    if (!porHub) continue;
    for (const [hubId, datos] of Object.entries(porHub)) {
      if (filtro.hubId && hubId !== filtro.hubId) continue;
      const cumplidos = Number(datos.sla?.cumplidos ?? 0);
      const incumplidos = Number(datos.sla?.incumplidos ?? 0);
      if (cumplidos + incumplidos === 0) continue;
      const clave = `${hubId}|${d.fecha}`;
      const fila =
        porClave.get(clave) ??
        ({ hubId, fecha: String(d.fecha), cumplidos: 0, incumplidos: 0, cumplimiento: 0 });
      fila.cumplidos += cumplidos;
      fila.incumplidos += incumplidos;
      porClave.set(clave, fila);
    }
  }
  return [...porClave.values()]
    .map((f) => ({
      ...f,
      cumplimiento: Math.round((f.cumplidos / (f.cumplidos + f.incumplidos)) * 1000) / 10,
    }))
    .sort((a, b) => a.hubId.localeCompare(b.hubId) || a.fecha.localeCompare(b.fecha));
}

/**
 * Resume los tres indicadores de CU4 con filtros por zona, hub y día.
 * @param {import('./mongo.js').DocVista[]} docs Documentos crudos de metricas_diarias.
 * @param {FiltroMetricas} filtro Filtros aplicados.
 * @returns {ResumenMetricas} Indicadores calculados.
 * @example
 * const resumen = resumirMetricas(docsDeMongo, { zonaId: 'ZONA-SUR', fecha: '2026-10-13' });
 * // resumen.tasaPrimerIntento, resumen.motivos, resumen.slaHub
 */
export function resumirMetricas(docs, filtro = {}) {
  const filtrados = filtrarDocs(docs, filtro);
  return {
    tasaPrimerIntento: agregarTasa(filtrados),
    motivos: agregarMotivos(filtrados),
    slaHub: agregarSla(filtrados, filtro),
  };
}
