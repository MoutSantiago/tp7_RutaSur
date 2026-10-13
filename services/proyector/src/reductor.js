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
 * @property {Array<{tipo: string, ocurridoEn: string, secuencia: number, motivo?: string, intento?: number}>} historial
 *   Historial embebido de eventos aplicados.
 * @property {import('@rutasur/shared/src/eventos/tipos.js').EventoPromesa | null} [promesa] Promesa vigente (se completa en pasos posteriores).
 * @property {number} ultimaSecuencia Última secuencia aplicada.
 * @property {string} ultimaActualizacion ISO del último evento aplicado.
 */

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
