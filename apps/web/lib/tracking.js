/**
 * Tracking público (lógica pura de saneamiento).
 *
 * La vista pública muestra ÚNICAMENTE: estado actual (traducido a lenguaje de
 * destinatario) y fecha estimada de entrega. Nunca expone datos internos:
 * repartidorId, hubId, zonaId, alertas, motivos de fallo, intentos ni historial.
 */

/** @readonly estados que el destinatario puede ver, con su texto público. */
const ESTADOS_PUBLICOS = Object.freeze({
  CREADO: 'Recibimos tu pedido',
  INGRESADO_HUB: 'En el centro de distribución',
  CLASIFICADO: 'En preparación',
  EN_REPARTO: 'En reparto',
  ENTREGADO: 'Entregado',
  ENTREGA_FALLIDA: 'No pudimos entregarlo; te avisaremos',
  RETENIDO: 'En revisión; te avisaremos',
  DEVOLUCION: 'En gestión con el comercio',
});

/** @readonly claves públicas permitidas en la respuesta de tracking. */
export const CAMPOS_PUBLICOS_TRACKING = Object.freeze([
  'shipmentId',
  'estado',
  'estadoTexto',
  'fechaEstimada',
  'franjaEstimada',
]);

/**
 * Lista blanca de tracking: devuelve solo lo que el destinatario puede ver.
 * @param {import('./mongo.js').DocVista | null} envio Documento completo del envío (vista interna).
 * @returns {{shipmentId: string, estado: string, estadoTexto: string, fechaEstimada: string | null, franjaEstimada: string | null} | null}
 *   Objeto público de tracking, o null si el envío no existe.
 * @example
 * const publico = sanearTracking(envioInterno);
 * // { shipmentId, estado: 'EN_REPARTO', estadoTexto: 'En reparto', fechaEstimada: '...', franjaEstimada: 'PM' }
 */
export function sanearTracking(envio) {
  if (!envio) return null;
  const estado = /** @type {string} */ (envio.estado);
  const promesa = /** @type {{venceEn?: string, franja?: string} | null} */ (envio.promesa ?? null);
  const mapaPublico = /** @type {Record<string, string>} */ (ESTADOS_PUBLICOS);
  return {
    shipmentId: /** @type {string} */ (envio.shipmentId),
    estado,
    estadoTexto: mapaPublico[estado] ?? 'En tránsito',
    fechaEstimada: promesa?.venceEn ? String(promesa.venceEn) : null,
    franjaEstimada: promesa?.franja ? String(promesa.franja) : null,
  };
}
