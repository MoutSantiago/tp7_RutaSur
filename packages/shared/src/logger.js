/**
 * Logger JSON estructurado para los servicios de RutaSur.
 * Emite una línea JSON por mensaje a stdout/stderr, con nivel, servicio y
 * contexto (eventId, partición, offset, etc.).
 *
 * @example
 * const logger = crearLogger({ servicio: 'proyector' });
 * logger.info('Evento procesado', { eventId, particion, offset });
 */

/** @readonly niveles soportados, de menor a mayor severidad. */
const NIVELES = Object.freeze(['debug', 'info', 'warn', 'error']);

/**
 * Logger estructurado.
 * @typedef {object} Logger
 * @property {(mensaje: string, contexto?: Record<string, unknown>) => void} debug
 * @property {(mensaje: string, contexto?: Record<string, unknown>) => void} info
 * @property {(mensaje: string, contexto?: Record<string, unknown>) => void} warn
 * @property {(mensaje: string, contexto?: Record<string, unknown>) => void} error
 * @property {(contexto: Record<string, unknown>) => Logger} hijo Crea un logger con contexto fijo.
 */

/**
 * Seríaiza un Error para el log estructurado.
 * @param {unknown} error Posible instancia de Error.
 * @returns {Record<string, unknown> | undefined} Representación del error, si corresponde.
 */
function serializarError(error) {
  if (!(error instanceof Error)) return undefined;
  return { nombre: error.name, mensaje: error.message, pila: error.stack };
}

/**
 * Crea un logger JSON estructurado para un servicio.
 * @param {object} opciones Opciones del logger.
 * @param {string} opciones.servicio Nombre del servicio (aparece en cada línea).
 * @param {string} [opciones.nivel] Nivel mínimo a emitir (debug, info, warn, error).
 * @returns {Logger} Logger con métodos por nivel y creación de loggers hijos.
 * @throws {Error} Si el nivel no es válido.
 * @example
 * const log = crearLogger({ servicio: 'monitor-sla', nivel: 'info' });
 * log.error('Falló la evaluación', { error, envio: shipmentId });
 */
export function crearLogger({ servicio, nivel = 'info' }) {
  const minimo = NIVELES.indexOf(nivel);
  if (minimo === -1) {
    throw new Error(`Nivel de log inválido: "${nivel}". Válidos: ${NIVELES.join(', ')}`);
  }
  return construirLogger({ servicio, minimo });
}

/**
 * Implementa el logger con un contexto base.
 * @param {object} opciones Opciones internas.
 * @param {string} opciones.servicio Nombre del servicio.
 * @param {number} opciones.minimo Índice del nivel mínimo.
 * @param {Record<string, unknown>} [opciones.contextoBase] Contexto fijo de loggers hijos.
 * @returns {Logger} Logger configurado.
 */
function construirLogger({ servicio, minimo, contextoBase = {} }) {
  /**
   * Emite una línea de log si el nivel lo permite.
   * @param {string} nivel Nivel del mensaje.
   * @param {string} mensaje Mensaje legible.
   * @param {Record<string, unknown>} [contexto] Contexto adicional.
   * @returns {void}
   */
  function emitir(nivel, mensaje, contexto = {}) {
    if (NIVELES.indexOf(nivel) < minimo) return;
    const linea = /** @type {Record<string, unknown>} */ ({
      ts: new Date().toISOString(),
      nivel,
      servicio,
      msg: mensaje,
      ...contextoBase,
      ...contexto,
    });
    const error = serializarError(linea.error);
    if (error) linea.error = error;
    const salida = JSON.stringify(linea);
    if (nivel === 'error' || nivel === 'warn') process.stderr.write(salida + '\n');
    else process.stdout.write(salida + '\n');
  }

  return {
    debug: (mensaje, contexto) => emitir('debug', mensaje, contexto),
    info: (mensaje, contexto) => emitir('info', mensaje, contexto),
    warn: (mensaje, contexto) => emitir('warn', mensaje, contexto),
    error: (mensaje, contexto) => emitir('error', mensaje, contexto),
    hijo: (contexto) =>
      construirLogger({ servicio, minimo, contextoBase: { ...contextoBase, ...contexto } }),
  };
}
