/**
 * Evaluador puro de reglas de SLA (CU3).
 *
 * Cruza el último estado de un envío con el vencimiento de su promesa usando el
 * RELOJ SIMULADO (el tiempo que viaja en `ocurridoEn` de los eventos). Devuelve
 * las alertas que corresponde abrir ahora, sin efectos secundarios.
 */

/** Una hora en milisegundos. */
export const HORA_MS = 3600000;

/** Umbrales de las reglas, en horas simuladas antes del vencimiento. */
export const UMBRALES_HORAS = Object.freeze({
  SIN_INGRESO: 10,
  SIN_SALIDA: 4,
});

/** Estados previos a la salida en reparto. */
const ESTADOS_PREVIOS_A_REPARTO = ['CREADO', 'INGRESADO_HUB', 'CLASIFICADO'];

/** Prioridad definida por regla. */
export const PRIORIDAD_POR_REGLA = Object.freeze({
  SIN_INGRESO: 'MEDIA',
  SIN_SALIDA: 'ALTA',
  FALLO_DIA_LIMITE: 'ALTA',
  VENCIDO: 'CRITICA',
});

/**
 * Estado interno de un envío monitoreado (respaldo en MongoDB).
 * @typedef {object} EnvioMonitoreado
 * @property {string} shipmentId Identificador del envío.
 * @property {string | null} ultimoEstado Último estado conocido (null si solo llegó la promesa).
 * @property {number | null} venceEnMs Vencimiento de la promesa (epoch ms simulado; null si aún no llegó).
 * @property {number} ultimaSecuencia Última secuencia de estado vista.
 * @property {number | null} ultimoFalloEnMs Momento simulado del último ENTREGA_FALLIDA, si hubo.
 * @property {boolean} entregado Verdadero si ya llegó ENTREGADO.
 * @property {string[]} reglasAlertadas Reglas que ya alertaron sobre este envío.
 * @property {string} hubId Centro de distribución.
 * @property {string} zonaId Zona de entrega.
 * @property {string} repartidorId Repartidor asignado.
 */

/**
 * Alerta que corresponde emitir.
 * @typedef {object} AlertaSla
 * @property {string} regla Regla disparada (SIN_INGRESO, SIN_SALIDA, FALLO_DIA_LIMITE, VENCIDO).
 * @property {string} prioridad Prioridad definida para la regla.
 */

/**
 * Verifica si dos fechas caen en el mismo día UTC.
 * @param {number} aMs Primer momento (epoch ms).
 * @param {number} bMs Segundo momento (epoch ms).
 * @returns {boolean} Verdadero si comparten día UTC.
 */
function mismoDiaUtc(aMs, bMs) {
  const a = new Date(aMs);
  const b = new Date(bMs);
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  );
}

/**
 * Evalúa las cuatro reglas de SLA sobre un envío y devuelve las alertas nuevas.
 * Un envío entregado o cerrado nunca alerta. Cada regla puede disparar una sola
 * vez por envío (la lista `reglasAlertadas` lo garantiza).
 * @param {EnvioMonitoreado} envio Estado interno del envío.
 * @param {number} ahoraMs Momento simulado actual (epoch ms).
 * @returns {AlertaSla[]} Alertas a abrir (vacío si ninguna).
 * @example
 * evaluarEnvio({ ultimoEstado: 'CREADO', venceEnMs: ahoraMs + 9 * HORA_MS, ... }, ahoraMs);
 * // [{ regla: 'SIN_INGRESO', prioridad: 'MEDIA' }]
 */
export function evaluarEnvio(envio, ahoraMs) {
  if (envio.entregado || envio.venceEnMs === null) return []

  /** @type {AlertaSla[]} */
  const alertas = [];
  const horasFaltantes = (envio.venceEnMs - ahoraMs) / HORA_MS;
  /**
   * Verifica si una regla ya alertó sobre el envío.
   * @param {string} regla Regla a consultar.
   * @returns {boolean} Verdadero si ya alertó.
   */
  const yaAlertada = (regla) => envio.reglasAlertadas.includes(regla);

  if (horasFaltantes < 0) {
    // Pasó el vencimiento sin ENTREGADO.
    if (!yaAlertada('VENCIDO')) alertas.push({ regla: 'VENCIDO', prioridad: PRIORIDAD_POR_REGLA.VENCIDO });
    return alertas;
  }

  if (envio.ultimoEstado === 'CREADO' && horasFaltantes < UMBRALES_HORAS.SIN_INGRESO) {
    if (!yaAlertada('SIN_INGRESO')) {
      alertas.push({ regla: 'SIN_INGRESO', prioridad: PRIORIDAD_POR_REGLA.SIN_INGRESO });
    }
  }

  if (
    envio.ultimoEstado !== null &&
    ESTADOS_PREVIOS_A_REPARTO.includes(envio.ultimoEstado) &&
    horasFaltantes < UMBRALES_HORAS.SIN_SALIDA
  ) {
    if (!yaAlertada('SIN_SALIDA')) {
      alertas.push({ regla: 'SIN_SALIDA', prioridad: PRIORIDAD_POR_REGLA.SIN_SALIDA });
    }
  }

  if (
    envio.ultimoEstado === 'ENTREGA_FALLIDA' &&
    envio.ultimoFalloEnMs !== null &&
    mismoDiaUtc(envio.ultimoFalloEnMs, envio.venceEnMs)
  ) {
    if (!yaAlertada('FALLO_DIA_LIMITE')) {
      alertas.push({ regla: 'FALLO_DIA_LIMITE', prioridad: PRIORIDAD_POR_REGLA.FALLO_DIA_LIMITE });
    }
  }

  return alertas;
}

/** @readonly estados terminales del ciclo (cierran el envío). */
export const ESTADOS_TERMINALES = Object.freeze(['ENTREGADO', 'DEVOLUCION']);

/**
 * Actualiza el estado interno de un envío con un evento de estado (no muta).
 * @param {EnvioMonitoreado} envio Estado interno actual.
 * @param {import('@rutasur/shared/src/eventos/tipos.js').EventoEstado} evento Evento de estado.
 * @returns {EnvioMonitoreado} Nuevo estado interno.
 */
export function actualizarConEvento(envio, evento) {
  const ahoraMs = Date.parse(evento.ocurridoEn);
  return {
    ...envio,
    ultimoEstado: evento.tipo,
    ultimaSecuencia: Math.max(envio.ultimaSecuencia, evento.secuencia),
    ultimoFalloEnMs: evento.tipo === 'ENTREGA_FALLIDA' ? ahoraMs : envio.ultimoFalloEnMs,
    entregado: evento.tipo === 'ENTREGADO' ? true : envio.entregado,
    hubId: evento.hubId,
    zonaId: evento.zonaId,
    repartidorId: evento.repartidorId,
  };
}
