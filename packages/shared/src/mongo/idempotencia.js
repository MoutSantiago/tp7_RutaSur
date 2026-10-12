/**
 * Helper de idempotencia sobre la colección `eventos_procesados`.
 * Cada consumidor registra los eventId ya aplicados; un índice único sobre
 * (consumidor, eventId) garantiza el descarte de duplicados y un índice TTL
 * de 7 días limita el tamaño de la colección.
 *
 * @example
 * await asegurarIndicesIdempotencia(db);
 * const marcar = crearMarcadorIdempotencia({ db, consumidor: GRUPOS.PROYECTOR });
 * if (await marcar.marcarSiNuevo(evento.eventId)) { aplicar efecto... }
 */

/** Nombre de la colección de control de idempotencia. */
export const COLECCION_EVENTOS_PROCESADOS = 'eventos_procesados';

/** TTL de los registros de idempotencia: 7 días en segundos. */
export const TTL_EVENTOS_PROCESADOS_SEG = 7 * 24 * 60 * 60;

/** Código de error de MongoDB por violación de índice único. */
const ERROR_DUPLICADO_MONGO = 11000;

/**
 * Marcador de idempotencia de un consumidor.
 * @typedef {object} MarcadorIdempotencia
 * @property {(eventId: string) => Promise<boolean>} marcarSiNuevo
 *   Registra el eventId; devuelve verdadero si es la primera vez que se procesa.
 */

/**
 * Crea los índices de la colección `eventos_procesados` si no existen.
 * @param {import('mongodb').Db} db Base de datos de MongoDB.
 * @returns {Promise<void>} Resuelve cuando los índices existen.
 */
export async function asegurarIndicesIdempotencia(db) {
  const coleccion = db.collection(COLECCION_EVENTOS_PROCESADOS);
  await coleccion.createIndex(
    { consumidor: 1, eventId: 1 },
    { unique: true, name: 'consumidor_eventId_unico' },
  );
  await coleccion.createIndex(
    { procesadoEn: 1 },
    { expireAfterSeconds: TTL_EVENTOS_PROCESADOS_SEG, name: 'ttl_procesadoEn' },
  );
}

/**
 * Crea un marcador de idempotencia ligado a un grupo de consumidores.
 * @param {object} opciones Opciones del marcador.
 * @param {import('mongodb').Db} opciones.db Base de datos de MongoDB.
 * @param {string} opciones.consumidor Nombre del grupo de consumidores.
 * @returns {MarcadorIdempotencia} Marcador listo para usar.
 */
export function crearMarcadorIdempotencia({ db, consumidor }) {
  const coleccion = db.collection(COLECCION_EVENTOS_PROCESADOS);
  return {
    async marcarSiNuevo(eventId) {
      try {
        await coleccion.insertOne({ consumidor, eventId, procesadoEn: new Date() });
        return true;
      } catch (error) {
        if (
          error instanceof Error &&
          'code' in error &&
          error.code === ERROR_DUPLICADO_MONGO
        ) {
          return false;
        }
        throw error;
      }
    },
  };
}
