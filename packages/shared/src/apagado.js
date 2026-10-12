/**
 * Utilidad de apagado ordenado: al recibir SIGTERM o SIGINT ejecuta los pasos
 * de limpieza registrados (cerrar consumidores, productores y conexiones) y
 * luego sale del proceso.
 *
 * @example
 * registrarApagadoOrdenado({
 *   logger,
 *   pasos: [
 *     { nombre: 'consumidor', ejecutar: () => consumidor.disconnect() },
 *     { nombre: 'mongodb', ejecutar: () => client.close() },
 *   ],
 * });
 */

/** Timeout máximo por paso de apagado (ms). */
const TIMEOUT_PASO_MS = 10000;

/**
 * Paso de apagado registrado.
 * @typedef {object} PasoApagado
 * @property {string} nombre Nombre legible del paso (para logs).
 * @property {() => Promise<unknown> | unknown} ejecutar Función de limpieza.
 */

/**
 * Registra manejadores de SIGTERM/SIGINT que ejecutan los pasos de apagado en
 * orden y finalizan el proceso. Es idempotente por señal: una segunda señal
 * fuerza la salida inmediata.
 * @param {object} opciones Opciones.
 * @param {import('./logger.js').Logger} opciones.logger Logger para registrar el apagado.
 * @param {PasoApagado[]} opciones.pasos Pasos de limpieza, en orden de ejecución.
 * @returns {() => void} Función para desregistrar los manejadores (útil en tests).
 */
export function registrarApagadoOrdenado({ logger, pasos }) {
  let enApagado = false;

  /**
   * Ejecuta los pasos de apagado y finaliza el proceso.
   * @param {string} senial Señal recibida (SIGTERM o SIGINT).
   * @returns {Promise<void>} No retorna: sale del proceso.
   */
  async function apagar(senial) {
    if (enApagado) {
      logger.warn('Señal repetida durante el apagado; saliendo de inmediato', { senial });
      process.exit(1);
    }
    enApagado = true;
    logger.info('Apagado ordenado iniciado', { senial, pasos: pasos.length });

    for (const paso of pasos) {
      try {
        await Promise.race([
          paso.ejecutar(),
          new Promise((_, rechazar) =>
            setTimeout(() => rechazar(new Error('timeout de apagado')), TIMEOUT_PASO_MS),
          ),
        ]);
        logger.info('Paso de apagado completado', { paso: paso.nombre });
      } catch (error) {
        logger.error('Falló un paso de apagado', { paso: paso.nombre, error });
      }
    }

    logger.info('Apagado ordenado completado', { senial });
    process.exit(0);
  }

  const alRecibirTerm = () => void apagar('SIGTERM');
  const alRecibirInt = () => void apagar('SIGINT');
  process.on('SIGTERM', alRecibirTerm);
  process.on('SIGINT', alRecibirInt);

  return () => {
    process.off('SIGTERM', alRecibirTerm);
    process.off('SIGINT', alRecibirInt);
  };
}
