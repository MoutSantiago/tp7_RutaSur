/**
 * Reductor puro del proyector (CU1): decide si un evento de estado se aplica a
 * un documento de envío y cómo queda el documento resultante.
 *
 * Reglas de la especificación:
 * - Orden: un evento con secuencia menor o igual a la ya aplicada se descarta.
 * - Duplicados: un eventId ya procesado no se reaplica (controlado además por
 *   la colección eventos_procesados; la regla de secuencia es la segunda red).
 * El historial va embebido en el documento porque está acotado (< 15 eventos).
 */

/**
 * Documento de la colección `envios` (vista derivada).
 * @typedef {object} DocumentoEnvio
 * @property {string} shipmentId Identificador del envío.
 * @property {string} estado Estado actual del envío.
 * @property {string} zonaId Zona de entrega.
 * @property {string} hubId Centro de distribución.
 * @property {string} repartidorId Repartidor asignado.
 * @property {number} intentos Mayor número de intento registrado.
 * @property {Array<{tipo: string, ocurridoEn: string, secuencia: number, motivo?: string, intento?: number, eventId?: string, nuevoIntentoEn?: string, franja?: string}>} historial
 *   Historial embebido de eventos y decisiones aplicados.
 * @property {import('@rutasur/shared/src/eventos/tipos.js').EventoPromesa | null} [promesa] Promesa vigente (se completa en pasos posteriores).
 * @property {number} ultimaSecuencia Última secuencia aplicada.
 * @property {string} ultimaActualizacion ISO del último evento aplicado.
 */

/** @readonly nombres de estado derivados de reprogramaciones en la vista. */
export const ESTADOS_POR_RESULTADO = Object.freeze({
  RETENIDO: 'RETENIDO',
  DEVOLUCION: 'DEVOLUCION',
});

/**
 * Aplica un evento de reprogramación al documento del envío.
 * Las reprogramaciones no mueven `ultimaSecuencia` (la línea de tiempo de los
 * estados la gobierna `envios.estados`); actualizan el historial, los intentos
 * y, según el resultado, el estado derivado (RETENIDO / DEVOLUCION).
 * @param {DocumentoEnvio | null} documento Documento actual del envío.
 * @param {import('@rutasur/shared/src/eventos/tipos.js').EventoReprogramacion} evento Evento de reprogramación.
 * @returns {ResultadoReduccion} Resultado de la reducción.
 * @throws {Error} Si el envío no existe aún en la vista (la reprogramación llegó antes que los estados).
 */
export function aplicarReprogramacion(documento, evento) {
  if (!documento) {
    throw new Error(
      `No existe el envío ${evento.shipmentId} al aplicar la reprogramación`,
    );
  }
  if (documento.historial.some((h) => 'eventId' in h && h.eventId === evento.eventId)) {
    return { resultado: RESULTADOS_REDUCCION.DESCARTADO_POR_ORDEN, documento: null };
  }
  const entradaHistorial = /** @type {DocumentoEnvio['historial'][number]} */ ({
    tipo: `REPROGRAMACION:${evento.resultado}`,
    ocurridoEn: evento.ocurridoEn,
    secuencia: evento.secuencia,
    intento: evento.intento,
    motivo: evento.motivo,
    eventId: evento.eventId,
    ...(evento.nuevoIntentoEn !== undefined ? { nuevoIntentoEn: evento.nuevoIntentoEn } : {}),
    ...(evento.franja !== undefined ? { franja: evento.franja } : {}),
  });
  const mapeo = /** @type {Record<string, string>} */ (ESTADOS_POR_RESULTADO);
  const nuevoEstado = mapeo[evento.resultado] ?? documento.estado;
  return {
    resultado: RESULTADOS_REDUCCION.APLICADO,
    documento: {
      ...documento,
      estado: nuevoEstado,
      intentos: Math.max(documento.intentos, evento.intento),
      historial: [...documento.historial, entradaHistorial],
      ultimaActualizacion: evento.ocurridoEn,
    },
  };
}

/** @readonly resultados posibles de decidir la aplicación de un evento. */
export const RESULTADOS_REDUCCION = Object.freeze({
  APLICADO: 'APLICADO',
  DESCARTADO_POR_ORDEN: 'DESCARTADO_POR_ORDEN',
});

/**
 * Resultado de aplicar un evento al documento.
 * @typedef {object} ResultadoReduccion
 * @property {string} resultado APLICADO o DESCARTADO_POR_ORDEN.
 * @property {DocumentoEnvio | null} documento Documento resultante (null si se descartó).
 */

/**
 * Crea el documento inicial de un envío a partir de su primer evento válido.
 * @param {import('@rutasur/shared/src/eventos/tipos.js').EventoEstado} evento Evento de estado.
 * @returns {DocumentoEnvio} Documento inicial.
 */
function crearDocumentoInicial(evento) {
  return {
    shipmentId: evento.shipmentId,
    estado: evento.tipo,
    zonaId: evento.zonaId,
    hubId: evento.hubId,
    repartidorId: evento.repartidorId,
    intentos: evento.intento ?? 0,
    promesa: null,
    historial: [],
    ultimaSecuencia: 0,
    ultimaActualizacion: evento.ocurridoEn,
  };
}

/**
 * Decide si aplicar el evento y, en caso afirmativo, devuelve el documento
 * actualizado. No muta el documento original.
 * @param {DocumentoEnvio | null} documento Documento actual del envío (null si no existe).
 * @param {import('@rutasur/shared/src/eventos/tipos.js').EventoEstado} evento Evento de estado validado.
 * @returns {ResultadoReduccion} Resultado de la reducción.
 * @throws {Error} Si el documento pertenece a otro shipmentId.
 * @example
 * const r = aplicarEventoAEstado(null, eventoCreado);
 * // r.resultado === 'APLICADO' y r.documento.estado === 'CREADO'
 */
export function aplicarEventoAEstado(documento, evento) {
  const doc = documento ?? crearDocumentoInicial(evento);
  if (doc.shipmentId !== evento.shipmentId) {
    throw new Error(`El documento ${doc.shipmentId} no corresponde al evento de ${evento.shipmentId}`);
  }
  if (evento.secuencia <= doc.ultimaSecuencia) {
    return { resultado: RESULTADOS_REDUCCION.DESCARTADO_POR_ORDEN, documento: null };
  }
  const entradaHistorial = /** @type {DocumentoEnvio['historial'][number]} */ ({
    tipo: evento.tipo,
    ocurridoEn: evento.ocurridoEn,
    secuencia: evento.secuencia,
    ...(evento.motivo !== undefined ? { motivo: evento.motivo } : {}),
    ...(evento.intento !== undefined ? { intento: evento.intento } : {}),
  });
  return {
    resultado: RESULTADOS_REDUCCION.APLICADO,
    documento: {
      ...doc,
      estado: evento.tipo,
      zonaId: evento.zonaId,
      hubId: evento.hubId,
      repartidorId: evento.repartidorId,
      intentos: Math.max(doc.intentos, evento.intento ?? doc.intentos),
      historial: [...doc.historial, entradaHistorial],
      ultimaSecuencia: evento.secuencia,
      ultimaActualizacion: evento.ocurridoEn,
    },
  };
}
