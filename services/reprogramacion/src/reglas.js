/**
 * Reglas puras de reprogramación (CU2).
 *
 * A partir del motivo e intento de una entrega fallida decide el destino del
 * envío:
 * - AUSENTE: nuevo intento al día hábil siguiente, en la franja opuesta a la del fallo.
 * - DIRECCION_INCORRECTA: retenido hasta una corrección; no se reprograma solo.
 * - RECHAZADO: devolución al comercio.
 * - Tercer fallo (cualquier motivo): devolución al comercio.
 */

import { MAX_INTENTOS } from '../../simulador/src/cicloVida.js';

export { MAX_INTENTOS };

/** Hora simulada de corte entre franja AM y PM (en UTC del ocurridoEn). */
export const HORA_CORTE_FRANJA = 13;

/** @readonly hora simulada de inicio de cada franja en el día del nuevo intento. */
const HORA_FRANJA = Object.freeze({ AM: 9, PM: 15 });

/**
 * Decisión de reprogramación.
 * @typedef {object} DecisionReprogramacion
 * @property {string} resultado REPROGRAMADO, RETENIDO o DEVOLUCION.
 * @property {number} intento Número del intento resultante (intento fallido + 1 si se reprograma).
 * @property {string} [nuevoIntentoEn] Momento del nuevo intento (ISO 8601) si se reprograma.
 * @property {string} [franja] Franja del nuevo intento si se reprograma.
 */

/**
 * Calcula el próximo día hábil (lunes a viernes) después de una fecha.
 * @param {Date} desde Fecha de referencia.
 * @returns {Date} Medianoche UTC del próximo día hábil.
 * @example
 * siguienteDiaHabil(new Date('2026-10-16T18:00:00Z')); // viernes -> lunes 2026-10-19
 */
export function siguienteDiaHabil(desde) {
  const fecha = new Date(
    Date.UTC(desde.getUTCFullYear(), desde.getUTCMonth(), desde.getUTCDate() + 1),
  );
  while (fecha.getUTCDay() === 0 || fecha.getUTCDay() === 6) {
    fecha.setUTCDate(fecha.getUTCDate() + 1);
  }
  return fecha;
}

/**
 * Determina la franja horaria de un momento según la hora de corte (13:00 UTC).
 * @param {Date} momento Momento a clasificar.
 * @returns {string} 'AM' si es antes de las 13:00, 'PM' en caso contrario.
 */
export function franjaDe(momento) {
  return momento.getUTCHours() < HORA_CORTE_FRANJA ? 'AM' : 'PM';
}

/**
 * Devuelve la franja opuesta a la indicada.
 * @param {string} franja Franja actual ('AM' o 'PM').
 * @returns {string} La otra franja.
 */
export function franjaOpuesta(franja) {
  return franja === 'AM' ? 'PM' : 'AM';
}

/**
 * Aplica las reglas de reprogramación a una entrega fallida.
 * @param {object} opciones Opciones.
 * @param {string} opciones.motivo Motivo del fallo (AUSENTE, DIRECCION_INCORRECTA, RECHAZADO, ZONA_INACCESIBLE).
 * @param {number} opciones.intento Número del intento que falló (1 en adelante).
 * @param {string | Date} opciones.ocurridoEn Momento simulado del fallo (viaja en el evento; es el "ahora" del sistema).
 * @returns {DecisionReprogramacion} Decisión tomada.
 * @throws {Error} Si falta el motivo o el intento.
 * @example
 * decidirReprogramacion({ motivo: 'AUSENTE', intento: 1, ocurridoEn: '2026-10-12T18:30:00Z' });
 * // { resultado: 'REPROGRAMADO', intento: 2, nuevoIntentoEn: '2026-10-13T09:00:00.000Z', franja: 'AM' }
 */
export function decidirReprogramacion({ motivo, intento, ocurridoEn }) {
  if (!motivo || !intento) {
    throw new Error('Se requieren motivo e intento para decidir la reprogramación');
  }
  if (intento >= MAX_INTENTOS || motivo === 'RECHAZADO') {
    return { resultado: 'DEVOLUCION', intento };
  }
  if (motivo === 'DIRECCION_INCORRECTA') {
    return { resultado: 'RETENIDO', intento };
  }
  // ZONA_INACCESIBLE: la especificación no detalla su regla; se retiene para
  // revisión operativa (no se reprograma solo), como DIRECCION_INCORRECTA.
  if (motivo === 'ZONA_INACCESIBLE') {
    return { resultado: 'RETENIDO', intento };
  }
  // AUSENTE: nuevo intento al día hábil siguiente en la franja opuesta.
  if (motivo === 'AUSENTE') {
    const franja = franjaOpuesta(franjaDe(new Date(ocurridoEn)));
    const dia = siguienteDiaHabil(new Date(ocurridoEn));
    const horas = /** @type {Record<string, number>} */ (HORA_FRANJA);
    const nuevoIntento = new Date(
      Date.UTC(dia.getUTCFullYear(), dia.getUTCMonth(), dia.getUTCDate(), horas[franja]),
    );
    return {
      resultado: 'REPROGRAMADO',
      intento: intento + 1,
      nuevoIntentoEn: nuevoIntento.toISOString(),
      franja,
    };
  }
  throw new Error(`Motivo de fallo desconocido: ${motivo}`);
}
