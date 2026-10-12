/**
 * Configuración por variables de entorno, validada al arrancar.
 * Un servicio debe llamar a `cargarConfiguracion` al inicio y fallar rápido
 * si el entorno no cumple lo mínimo necesario.
 *
 * @example
 * const config = cargarConfiguracion({ servicio: 'proyector' });
 * // config.kafkaBrokers, config.mongoUri, config.mongoDb, config.logNivel
 */

/** @readonly URI por defecto de Mongo para el entorno local (replica set de un nodo). */
const MONGO_URI_POR_DEFECTO =
  'mongodb://localhost:27017/?replicaSet=rs0&directConnection=true';

/**
 * Error de configuración: enumera todas las variables inválidas o faltantes.
 */
export class ErrorConfiguracion extends Error {
  /**
   * Crea el error con la lista de problemas detectados.
   * @param {string[]} problemas Descripciones de cada problema de configuración.
   */
  constructor(problemas) {
    super(`Configuración inválida:\n- ${problemas.join('\n- ')}`);
    this.name = 'ErrorConfiguracion';
    /** @readonly problemas detectados. */
    this.problemas = problemas;
  }
}

/**
 * Configuración validada de un servicio.
 * @typedef {object} Configuracion
 * @property {string} servicio Nombre del servicio que carga la configuración.
 * @property {string[]} kafkaBrokers Lista de brokers de Kafka (KAFKA_BROKERS separado por comas).
 * @property {string} mongoUri URI de conexión a MongoDB (MONGO_URI).
 * @property {string} mongoDb Nombre de la base de datos (MONGO_DB).
 * @property {string} logNivel Nivel mínimo de log (LOG_NIVEL).
 */

/**
 * Carga y valida la configuración común de un servicio a partir de las
 * variables de entorno. Aplica valores por defecto para el entorno local.
 * @param {object} opciones Opciones de carga.
 * @param {string} opciones.servicio Nombre del servicio (para logs y clientId de Kafka).
 * @param {NodeJS.ProcessEnv} [opciones.env] Variables de entorno (por defecto process.env).
 * @returns {Configuracion} Configuración validada.
 * @throws {ErrorConfiguracion} Si alguna variable está ausente o es inválida.
 * @example
 * const config = cargarConfiguracion({ servicio: 'notificaciones' });
 */
export function cargarConfiguracion({ servicio, env = process.env }) {
  const problemas = [];

  if (!servicio) problemas.push('Se requiere el nombre del servicio');

  const kafkaBrokers = (env.KAFKA_BROKERS ?? 'localhost:9092')
    .split(',')
    .map((b) => b.trim())
    .filter((b) => b.length > 0);
  if (kafkaBrokers.length === 0) problemas.push('KAFKA_BROKERS debe listar al menos un broker');

  const mongoUri = env.MONGO_URI ?? MONGO_URI_POR_DEFECTO;
  if (!/^mongodb(\+srv)?:\/\//.test(mongoUri)) {
    problemas.push('MONGO_URI debe comenzar con mongodb:// o mongodb+srv://');
  }

  const mongoDb = env.MONGO_DB ?? 'rutasur';
  if (!/^[a-zA-Z_][a-zA-Z0-9_]{0,31}$/.test(mongoDb)) {
    problemas.push('MONGO_DB debe ser un nombre de base válido');
  }

  const logNivel = env.LOG_NIVEL ?? 'info';
  if (!['debug', 'info', 'warn', 'error'].includes(logNivel)) {
    problemas.push('LOG_NIVEL debe ser debug, info, warn o error');
  }

  if (problemas.length > 0) throw new ErrorConfiguracion(problemas);
  return { servicio, kafkaBrokers, mongoUri, mongoDb, logNivel };
}
