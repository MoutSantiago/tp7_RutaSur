/**
 * Reloj simulado del monitor de SLA.
 *
 * Clave de la especificación: el monitor NO usa el reloj de la máquina. El
 * "ahora" es el tiempo simulado que viaja en `ocurridoEn` de los eventos. El
 * barrido periódico corre cada `60000 / factor` ms reales, es decir, un minuto
 * de tiempo simulado por tick; pero el avance del "ahora" entre ticks solo
 * ocurre cuando llegan eventos (si el simulador se detiene, el tiempo
 * simulado se congela y las alertas no avanzan artificialmente).
 */

/** Intervalo de evaluación por barrido: un minuto simulado. */
export const INTERVALO_BARRIDO_SIMULADO_MS = 60000;

/** Factor de aceleración por defecto (1 h simulada = 30 s reales). */
export const FACTOR_POR_DEFECTO = 120;

/**
 * Reloj del monitor alimentado por los eventos.
 * @typedef {object} RelojEventos
 * @property {() => number} ahora Momento simulado actual (epoch ms); arranca en 0.
 * @property {(ocurridoEn: string | number) => number} registrarEvento Avanza el reloj si el evento es más nuevo.
 * @property {number} factorAceleracion Factor sim/real configurado.
 */

/**
 * Crea un reloj de eventos para el monitor.
 * @param {object} [opciones] Opciones.
 * @param {number} [opciones.factorAceleracion] Factor de aceleración (ms simulados por ms real).
 * @param {number} [opciones.inicialMs] Momento simulado inicial.
 * @returns {RelojEventos} Reloj listo para usar.
 * @throws {Error} Si el factor no es positivo.
 */
export function crearRelojEventos({
  factorAceleracion = FACTOR_POR_DEFECTO,
  inicialMs = 0,
} = {}) {
  if (!Number.isFinite(factorAceleracion) || factorAceleracion <= 0) {
    throw new Error(`El factor de aceleración debe ser positivo; recibido: ${factorAceleracion}`);
  }
  let ahora = inicialMs;
  return {
    factorAceleracion,
    ahora: () => ahora,
    registrarEvento: (ocurridoEn) => {
      const ms = typeof ocurridoEn === 'string' ? Date.parse(ocurridoEn) : ocurridoEn;
      if (ms > ahora) ahora = ms;
      return ahora;
    },
  };
}

/**
 * Intervalo real del barrido en milisegundos para un minuto simulado.
 * @param {number} factorAceleracion Factor sim/real.
 * @returns {number} Intervalo real en milisegundos.
 */
export function intervaloBarridoRealMs(factorAceleracion) {
  return INTERVALO_BARRIDO_SIMULADO_MS / factorAceleracion;
}
