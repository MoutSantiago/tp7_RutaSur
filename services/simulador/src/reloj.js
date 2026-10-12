/**
 * Reloj simulado de RutaSur. El tiempo simulado avanza `factor` veces más
 * rápido que el tiempo real (por defecto 1 hora simulada = 30 segundos reales,
 * factor 120). Todo el sistema debe usar el tiempo simulado que viaja en
 * `ocurridoEn`, nunca el reloj de la máquina para la lógica de negocio.
 */

/** @readonly factor de aceleración por defecto (1 h simulada = 30 s reales). */
export const FACTOR_ACELERACION_POR_DEFECTO = 3600 / 30;

/**
 * Reloj simulado anclado al tiempo real.
 * @typedef {object} RelojSimulado
 * @property {() => number} ahoraSimulado Momento simulado actual (epoch ms).
 * @property {(msSimulados: number) => number} aReales Convierte ms simulados a ms reales.
 * @property {(msSimulados: number) => Date} enFuturoSimulado Devuelve la fecha simulada dentro de msSimulados.
 * @property {number} factor Factor de aceleración (ms simulados por ms real).
 */

/**
 * Crea un reloj simulado anclado al momento de su creación.
 * @param {object} opciones Opciones del reloj.
 * @param {number} [opciones.factor] Factor de aceleración (ms simulados por ms real).
 * @param {number} [opciones.inicioSimulado] Momento simulado inicial (epoch ms); por defecto es el real.
 * @param {() => number} [opciones.relojReal] Fuente de tiempo real (para tests).
 * @returns {RelojSimulado} Reloj simulado.
 * @throws {Error} Si el factor no es un número positivo.
 * @example
 * const reloj = crearRelojSimulado({ factor: 120 });
 * reloj.ahoraSimulado(); // avanza 120 ms por cada milisegundo real
 */
export function crearRelojSimulado({
  factor = FACTOR_ACELERACION_POR_DEFECTO,
  inicioSimulado = Date.now(),
  relojReal = Date.now,
}) {
  if (!Number.isFinite(factor) || factor <= 0) {
    throw new Error(`El factor de aceleración debe ser positivo; recibido: ${factor}`);
  }
  const inicioReal = relojReal();
  return {
    factor,
    ahoraSimulado: () => inicioSimulado + (relojReal() - inicioReal) * factor,
    aReales: (msSimulados) => msSimulados / factor,
    enFuturoSimulado: (msSimulados) => new Date(inicioSimulado + msSimulados), // relativo al origen simulado
  };
}

/**
 * Devuelve una promesa que resuelve tras una duración expresada en tiempo
 * simulado, convertida a tiempo real según el factor del reloj.
 * @param {RelojSimulado} reloj Reloj simulado del servicio.
 * @param {number} msSimulados Duración en milisegundos simulados.
 * @returns {Promise<void>} Resuelve cuando pasó el tiempo real equivalente.
 */
export function dormirSimulados(reloj, msSimulados) {
  return new Promise((resolver) => setTimeout(resolver, reloj.aReales(msSimulados)));
}
