/**
 * Lógica pura del servicio de analítica (CU4).
 *
 * Convierte eventos de estado en incrementos atómicos para la colección
 * `metricas_diarias`. Todo el cálculo que depende del contenido del evento
 * vive acá, sin I/O, para poder testearlo sin Kafka ni Mongo.
 */

/** Hora UTC de corte entre las franjas AM y PM. */
export const HORA_CORTE_FRANJA = 13;

/**
 * Clave del documento diario de métricas.
 * @typedef {object} ClaveMetrica
 * @property {string} fecha Día en formato YYYY-MM-DD (UTC).
 * @property {string} zonaId Zona del envío.
 * @property {string} franja Franja horaria ('AM' | 'PM').
 */

/**
 * Mapa de incrementos a aplicar con $inc: ruta del campo -> delta entero.
 * @typedef {Record<string, number>} Incrementos
 */

/**
 * Devuelve el día (UTC) de un momento ISO 8601 en formato YYYY-MM-DD.
 * @param {string} ocurridoEn Momento del evento (ISO 8601).
 * @returns {string} Día en formato YYYY-MM-DD.
 * @example
 * fechaDelDia('2026-10-12T23:30:00.000Z'); // '2026-10-12'
 */
export function fechaDelDia(ocurridoEn) {
  const fecha = new Date(ocurridoEn);
  if (Number.isNaN(fecha.getTime())) throw new Error(`Fecha inválida: ${ocurridoEn}`);
  return fecha.toISOString().slice(0, 10);
}

/**
 * Devuelve la franja horaria (AM/PM) de un momento ISO 8601 según el corte de las 13:00 UTC.
 * @param {string} ocurridoEn Momento del evento (ISO 8601).
 * @returns {string} 'AM' o 'PM'.
 */
export function franjaDeMomento(ocurridoEn) {
  const fecha = new Date(ocurridoEn);
  if (Number.isNaN(fecha.getTime())) throw new Error(`Fecha inválida: ${ocurridoEn}`);
  return fecha.getUTCHours() < HORA_CORTE_FRANJA ? 'AM' : 'PM';
}

/**
 * Calcula la clave del documento de métricas para un evento de estado.
 * @param {import('@rutasur/shared/src/eventos/tipos.js').EventoEstado} evento Evento de estado.
 * @returns {ClaveMetrica} Clave del documento destino.
 */
export function claveParaEvento(evento) {
  return {
    fecha: fechaDelDia(evento.ocurridoEn),
    zonaId: evento.zonaId,
    franja: franjaDeMomento(evento.ocurridoEn),
  };
}

/**
 * Calcula los incrementos que aporta un evento de estado a su documento diario.
 *
 * Indicadores alimentados:
 * - Tasa de entrega en primer intento: `intentosPrimeros.total` / `.exitosos`.
 * - Distribución de motivos: `motivos.<MOTIVO>` por cada fallo.
 * - Cumplimiento de SLA: `sla.cumplidos` / `sla.incumplidos`, y por hub en
 *   `porHub.<hubId>.sla.*`, evaluado solo si se conoce el vencimiento.
 * @param {import('@rutasur/shared/src/eventos/tipos.js').EventoEstado} evento Evento de estado.
 * @param {string | null} venceEn Vencimiento de la promesa del envío (null si se desconoce).
 * @returns {Incrementos} Incrementos a aplicar con $inc (puede ser objeto vacío).
 * @example
 * calcularIncrementos(eventoEntregadoPrimerIntento, '2026-10-20T...');
 * // { 'intentosPrimeros.total': 1, 'intentosPrimeros.exitosos': 1, 'sla.cumplidos': 1, ... }
 */
export function calcularIncrementos(evento, venceEn) {
  /** @type {Incrementos} */
  const incs = {};
  const esResultado = evento.tipo === 'ENTREGADO' || evento.tipo === 'ENTREGA_FALLIDA';
  if (!esResultado) return incs;

  const intento = evento.intento ?? 1;
  if (intento === 1) {
    incs['intentosPrimeros.total'] = 1;
    if (evento.tipo === 'ENTREGADO') incs['intentosPrimeros.exitosos'] = 1;
  }
  if (evento.tipo === 'ENTREGA_FALLIDA' && evento.motivo) {
    incs[`motivos.${evento.motivo}`] = 1;
  }
  if (evento.tipo === 'ENTREGADO' && venceEn) {
    const cumplio = Date.parse(evento.ocurridoEn) <= Date.parse(venceEn);
    incs[`sla.${cumplio ? 'cumplidos' : 'incumplidos'}`] = 1;
    incs[`porHub.${evento.hubId}.sla.${cumplio ? 'cumplidos' : 'incumplidos'}`] = 1;
  }
  return incs;
}
