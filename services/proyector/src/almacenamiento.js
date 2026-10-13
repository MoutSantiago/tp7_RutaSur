/**
 * Almacenamiento del proyector en MongoDB: índices y escritura atómica de la
 * colección `envios`. La fuente de verdad es Kafka; estas colecciones son
 * vistas derivadas reconstruibles.
 */

import { aplicarEventoAEstado, RESULTADOS_REDUCCION } from './reductor.js';

/** Nombre de la colección de envíos. */
export const COLECCION_ENVIOS = 'envios';

/**
 * Proyector de envíos sobre una base MongoDB.
 * @typedef {object} RepositorioEnvios
 * @property {(evento: import('@rutasur/shared/src/eventos/tipos.js').EventoEstado) => Promise<{resultado: string}>} aplicarEstado
 *   Aplica un evento de estado al documento del envío de forma idempotente.
 * @property {(shipmentId: string) => Promise<import('./reductor.js').DocumentoEnvio | null>} buscarPorId
 *   Devuelve el documento del envío o null si no existe.
 */

/**
 * Crea los índices de la colección `envios` si no existen:
 * shipmentId único, estado+zonaId y promesa.venceEn.
 * @param {import('mongodb').Db} db Base de datos de MongoDB.
 * @returns {Promise<void>} Resuelve cuando los índices existen.
 */
export async function asegurarIndicesEnvios(db) {
  const coleccion = db.collection(COLECCION_ENVIOS);
  await coleccion.createIndex({ shipmentId: 1 }, { unique: true, name: 'shipmentId_unico' });
  await coleccion.createIndex({ estado: 1, zonaId: 1 }, { name: 'estado_zonaId' });
  await coleccion.createIndex({ 'promesa.venceEn': 1 }, { name: 'promesa_venceEn' });
}

/**
 * Crea el repositorio de envíos sobre una base de datos conectada.
 * @param {import('mongodb').Db} db Base de datos de MongoDB.
 * @returns {RepositorioEnvios} Repositorio listo para usar.
 */
export function crearRepositorioEnvios(db) {
  const coleccion = db.collection(COLECCION_ENVIOS);

  return {
    async aplicarEstado(evento) {
      const actual = await coleccion.findOne(
        { shipmentId: evento.shipmentId },
        { projection: { _id: 0 } },
      );
      const { resultado, documento } = aplicarEventoAEstado(
        /** @type {import('./reductor.js').DocumentoEnvio | null} */ (actual),
        evento,
      );
      if (resultado === RESULTADOS_REDUCCION.DESCARTADO_POR_ORDEN || !documento) {
        return { resultado };
      }
      await coleccion.updateOne(
        { shipmentId: evento.shipmentId },
        { $set: documento },
        { upsert: true },
      );
      return { resultado };
    },

    async buscarPorId(shipmentId) {
      return /** @type {import('./reductor.js').DocumentoEnvio | null} */ (
        await coleccion.findOne({ shipmentId })
      );
    },
  };
}
