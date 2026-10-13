/**
 * Almacenamiento del servicio de analítica: escritura de `metricas_diarias`
 * únicamente con incrementos atómicos ($inc + upsert) y una colección interna
 * `promesas_envios` para conocer el vencimiento de cada envío.
 */

/** Nombre de la colección de métricas diarias. */
export const COLECCION_METRICAS = 'metricas_diarias';

/** Nombre de la colección interna con la promesa vigente de cada envío. */
export const COLECCION_PROMESAS = 'promesas_envios';

/**
 * Crea los índices de `metricas_diarias` (fecha+zonaId+franja único).
 * @param {import('mongodb').Db} db Base de datos de MongoDB.
 * @returns {Promise<void>} Resuelve cuando los índices existen.
 */
export async function asegurarIndicesAnalitica(db) {
  await db
    .collection(COLECCION_METRICAS)
    .createIndex(
      { fecha: 1, zonaId: 1, franja: 1 },
      { unique: true, name: 'fecha_zona_franja_unico' },
    );
  await db
    .collection(COLECCION_PROMESAS)
    .createIndex({ shipmentId: 1 }, { unique: true, name: 'promesa_shipmentId_unico' });
}

/**
 * Repositorio de métricas diarias de RutaSur.
 * @typedef {object} RepositorioMetricas
 * @property {(clave: import('./metricas.js').ClaveMetrica, incrementos: import('./metricas.js').Incrementos) => Promise<void>} aplicarIncrementos
 *   Aplica los incrementos al documento diario (atómico, con upsert).
 * @property {(promesa: import('@rutasur/shared/src/eventos/tipos.js').EventoPromesa) => Promise<void>} guardarPromesa
 *   Registra la promesa vigente de un envío.
 * @property {(shipmentId: string) => Promise<string | null>} buscarVencimiento
 *   Devuelve el vencimiento registrado del envío, o null.
 */

/**
 * Crea el repositorio de métricas sobre una base de datos conectada.
 * @param {import('mongodb').Db} db Base de datos de MongoDB.
 * @returns {RepositorioMetricas} Repositorio listo para usar.
 */
export function crearRepositorioMetricas(db) {
  const metricas = db.collection(COLECCION_METRICAS);
  const promesas = db.collection(COLECCION_PROMESAS);

  return {
    async aplicarIncrementos(clave, incrementos) {
      const claves = Object.keys(incrementos);
      if (claves.length === 0) return;
      await metricas.updateOne(
        clave,
        {
          $inc: incrementos,
          $setOnInsert: { ...clave, creadoEn: new Date() },
          $set: { actualizadoEn: new Date() },
        },
        { upsert: true },
      );
    },

    async guardarPromesa(promesa) {
      await promesas.updateOne(
        { shipmentId: promesa.shipmentId },
        {
          $setOnInsert: {
            shipmentId: promesa.shipmentId,
            venceEn: promesa.venceEn,
            franja: promesa.franja,
            eventId: promesa.eventId,
          },
        },
        { upsert: true },
      );
    },

    async buscarVencimiento(shipmentId) {
      const doc = await promesas.findOne(
        { shipmentId },
        { projection: { _id: 0, venceEn: 1 } },
      );
      return doc ? /** @type {{venceEn: string}} */ (/** @type {unknown} */ (doc)).venceEn : null;
    },
  };
}
