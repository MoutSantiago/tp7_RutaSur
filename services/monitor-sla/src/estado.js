/**
 * Estado interno del monitor de SLA: tabla en memoria por envío con respaldo
 * en MongoDB para tolerar reinicios sin perder ni repetir alertas.
 */

/** Nombre de la colección de respaldo del estado del monitor. */
export const COLECCION_MONITOR_ESTADO = 'monitor_sla_estado';

/**
 * Almacén de estado del monitor.
 * @typedef {object} AlmacenMonitor
 * @property {Map<string, import('./reglas.js').EnvioMonitoreado>} enMemoria Tabla en memoria de envíos abiertos.
 * @property {(envio: import('./reglas.js').EnvioMonitoreado) => Promise<void>} guardar Persiste el estado de un envío abierto.
 * @property {(shipmentId: string) => Promise<void>} eliminar Elimina el respaldo de un envío cerrado.
 * @property {() => Promise<number>} restaurar Carga los envíos abiertos al arrancar.
 */

/**
 * Crea el almacén del monitor sobre una base de datos conectada.
 * @param {import('mongodb').Db} db Base de datos de MongoDB.
 * @param {Map<string, import('./reglas.js').EnvioMonitoreado>} [memoria] Mapa en memoria (para tests).
 * @returns {AlmacenMonitor} Almacén listo para usar.
 */
export function crearAlmacenMonitor(db, memoria = new Map()) {
  const coleccion = db.collection(COLECCION_MONITOR_ESTADO);
  return {
    enMemoria: memoria,

    async guardar(envio) {
      await coleccion.updateOne(
        { shipmentId: envio.shipmentId },
        { $set: { ...envio } },
        { upsert: true },
      );
    },

    async eliminar(shipmentId) {
      await coleccion.deleteOne({ shipmentId });
    },

    async restaurar() {
      const abiertos = await coleccion.find({}, { projection: { _id: 0 } }).toArray();
      for (const doc of abiertos) {
        memoria.set(
          /** @type {{shipmentId: string}} */ (/** @type {unknown} */ (doc)).shipmentId,
          /** @type {import('./reglas.js').EnvioMonitoreado} */ (/** @type {unknown} */ (doc)),
        );
      }
      return abiertos.length;
    },
  };
}

/**
 * Crea el índice único por shipmentId del respaldo del monitor.
 * @param {import('mongodb').Db} db Base de datos de MongoDB.
 * @returns {Promise<void>} Resuelve cuando el índice existe.
 */
export async function asegurarIndicesMonitor(db) {
  await db
    .collection(COLECCION_MONITOR_ESTADO)
    .createIndex({ shipmentId: 1 }, { unique: true, name: 'monitor_shipmentId_unico' });
}
