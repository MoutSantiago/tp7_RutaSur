/**
 * Lógica pura de avisos al destinatario (CU2).
 * Ante una ENTREGA_FALLIDA decide si corresponde notificar y con qué contenido.
 * El envío real está fuera de alcance: la notificación solo se registra.
 */

/** @readonly canal por defecto de las notificaciones simuladas. */
export const CANAL_POR_DEFECTO = 'EMAIL';

/** @readonly textos por motivo de fallo. */
const TEXTOS_POR_MOTIVO = Object.freeze({
  AUSENTE: 'No encontramos a nadie en la dirección de entrega',
  DIRECCION_INCORRECTA: 'La dirección de entrega parece incorrecta',
  RECHAZADO: 'El paquete fue rechazado en destino',
  ZONA_INACCESIBLE: 'No pudimos acceder a la zona de entrega',
});

/**
 * Aviso decidido para el destinatario.
 * @typedef {object} Aviso
 * @property {string} canal Canal del aviso (EMAIL).
 * @property {string} asunto Asunto breve.
 * @property {string} cuerpo Cuerpo del aviso con opciones para reprogramar.
 */

/**
 * Decide el aviso a registrar para un evento de estado.
 * @param {import('@rutasur/shared/src/eventos/tipos.js').EventoEstado} evento Evento de estado validado.
 * @returns {Aviso | null} Aviso a publicar, o null si el evento no amerita notificación.
 * @example
 * const aviso = decidirAviso(eventoFallidoConAusente);
 * // { canal: 'EMAIL', asunto: 'No pudimos entregar tu pedido (intento 1)', ... }
 */
export function decidirAviso(evento) {
  if (evento.tipo !== 'ENTREGA_FALLIDA') return null;
  const motivo = evento.motivo ?? 'AUSENTE';
  const textos = /** @type {Record<string, string>} */ (TEXTOS_POR_MOTIVO);
  const detalle = textos[motivo] ?? 'No pudimos completar la entrega';
  const intento = evento.intento ?? 1;
  return {
    canal: CANAL_POR_DEFECTO,
    asunto: `No pudimos entregar tu pedido (intento ${intento})`,
    cuerpo:
      `${detalle}. Tu envío ${evento.shipmentId} sigue en circulación. ` +
      'Podés reprogramar la entrega o retirar en punto de retiro desde el link de seguimiento.',
  };
}
