/**
 * Documento de vista de MongoDB tal como viaja al cliente.
 * @typedef {Record<string, any>} DocVista
 */

/**
 * Capa de acceso a datos de la interfaz de RutaSur.
 *
 * Único origen de lectura: MongoDB (vistas derivadas que el proyector y la
 * analítica mantienen). Nunca toca Kafka. Las pantallas de datos se renderizan
 * en el servidor con estas consultas; los cambios en vivo llegan por el SSE
 * de `app/api/stream/route.js`, que escucha los change streams.
 */

/** @readonly URI por defecto del entorno local (replica set de un nodo). */
const MONGO_URI_POR_DEFECTO =
  'mongodb://localhost:27017/?replicaSet=rs0&directConnection=true';

/** @readonly nombre de la base de datos. */
const MONGO_DB_POR_DEFECTO = 'rutasur';

/** Orden de prioridad de las alertas (menor = más arriba en la cola). */
const ORDEN_PRIORIDAD = Object.freeze(
  /** @type {Record<string, number>} */ ({ CRITICA: 0, ALTA: 1, MEDIA: 2 }),
);

/**
 * Devuelve el cliente MongoDB compartido (cacheado en globalThis para
 * sobrevivir al hot-reload de desarrollo).
 * @returns {Promise<import('mongodb').Db>} Base de datos de RutaSur.
 * @throws {import('mongodb').MongoServerError} Si no se puede conectar.
 * @example
 * const db = await obtenerDb();
 * const envios = await db.collection('envios').find({}).toArray();
 */
export async function obtenerDb() {
  const global = /** @type {{_rutasurDb?: Promise<import('mongodb').Db>}} */ (globalThis);
  if (!global._rutasurDb) {
    const { MongoClient } = await import('mongodb');
    const client = new MongoClient(process.env.MONGO_URI ?? MONGO_URI_POR_DEFECTO, {
      appName: 'rutasur-web',
    });
    global._rutasurDb = client
      .connect()
      .then((c) => c.db(process.env.MONGO_DB ?? MONGO_DB_POR_DEFECTO));
  }
  return global._rutasurDb;
}

/**
 * Quita las claves internas de MongoDB de un documento para el cliente.
 * @param {import('mongodb').Document | null} doc Documento leído.
 * @returns {DocVista | null} Documento serializable (sin `_id`).
 */
function sinId(doc) {
  if (!doc) return null;
  const { _id, ...resto } = /** @type {Record<string, unknown>} */ (doc);
  return resto;
}

/**
 * Contadores de envíos por estado actual.
 * @returns {Promise<Record<string, number>>} Mapa estado -> cantidad.
 */
export async function obtenerContadoresPorEstado() {
  const db = await obtenerDb();
  const grupos = await db
    .collection('envios')
    .aggregate([{ $group: { _id: '$estado', n: { $sum: 1 } } }])
    .toArray();
  return Object.fromEntries(grupos.map((g) => [g._id, g.n]));
}

/**
 * Cola de alertas abiertas, ordenada por prioridad (Crítica primero).
 * @returns {Promise<DocVista[]>} Alertas abiertas priorizadas (sin `_id`).
 */
export async function obtenerAlertasAbiertas() {
  const db = await obtenerDb();
  const alertas = await db
    .collection('alertas')
    .find({ estado: 'ABIERTA' }, { projection: { _id: 0 } })
    .toArray();
  return alertas
    .map((a) => /** @type {DocVista} */ (a))
    .sort(
      (a, b) =>
        (ORDEN_PRIORIDAD[String(a.prioridad)] ?? 9) - (ORDEN_PRIORIDAD[String(b.prioridad)] ?? 9) ||
        String(a.venceEn).localeCompare(String(b.venceEn)),
    );
}

/**
 * Últimos envíos actualizados, para la bitácora de eventos de la torre.
 * @param {number} [limite] Cantidad máxima a devolver.
 * @returns {Promise<DocVista[]>} Envíos recientes (sin `_id`).
 */
export async function obtenerUltimosEnvios(limite = 15) {
  const db = await obtenerDb();
  const docs = await db
    .collection('envios')
    .find({}, { projection: { _id: 0 } })
    .sort({ ultimaActualizacion: -1 })
    .limit(limite)
    .toArray();
  return docs.map((d) => /** @type {DocVista} */ (d));
}

/**
 * Datos completos del detalle de un envío: documento, alertas y notificaciones.
 * @param {string} shipmentId Identificador del envío.
 * @returns {Promise<{envio: object | null, alertas: object[], notificaciones: object[]}>}
 *   Detalle del envío (sin `_id` en ninguna pieza).
 */
export async function obtenerDetalleEnvio(shipmentId) {
  const db = await obtenerDb();
  const [envioDoc, alertasDoc, notifsDoc] = await Promise.all([
    db.collection('envios').findOne({ shipmentId }, { projection: { _id: 0 } }),
    db.collection('alertas').find({ shipmentId }, { projection: { _id: 0 } }).toArray(),
    db
      .collection('notificaciones')
      .find({ shipmentId }, { projection: { _id: 0 } })
      .sort({ ocurridoEn: 1 })
      .toArray(),
  ]);
  return {
    envio: sinId(envioDoc),
    alertas: alertasDoc.map((a) => /** @type {DocVista} */ (a)),
    notificaciones: notifsDoc.map((n) => /** @type {DocVista} */ (n)),
  };
}

import { sanearTracking } from './tracking.js';

/**
 * Tracking público: devuelve SOLO los campos visibles para el destinatario.
 * @param {string} shipmentId Identificador del envío.
 * @returns {Promise<ReturnType<typeof sanearTracking>>} Vista pública, o null si no existe.
 */
export async function obtenerTrackingEnvio(shipmentId) {
  const db = await obtenerDb();
  const doc = await db.collection('envios').findOne({ shipmentId }, { projection: { _id: 0 } });
  return sanearTracking(/** @type {DocVista | null} */ (doc));
}

/**
 * Lee los documentos crudos de `metricas_diarias` (la agregación de los
 * indicadores se hace en `lib/metricas.js`, función pura testeable).
 * @returns {Promise<DocVista[]>} Documentos de métricas sin `_id`.
 */
export async function obtenerDocumentosMetricas() {
  const db = await obtenerDb();
  const docs = await db.collection('metricas_diarias').find({}, { projection: { _id: 0 } }).toArray();
  return docs.map((d) => /** @type {DocVista} */ (d));
}

/**
 * Opciones disponibles para los filtros del panel analítico.
 * @returns {Promise<{zonas: string[], hubs: string[], fechas: string[]}>} Valores distintos presentes en la base.
 */
export async function obtenerOpcionesFiltros() {
  const db = await obtenerDb();
  const [zonas, hubs, fechas] = await Promise.all([
    db.collection('envios').distinct('zonaId'),
    db.collection('envios').distinct('hubId'),
    db.collection('metricas_diarias').distinct('fecha'),
  ]);
  return {
    zonas: zonas.filter(Boolean).sort(),
    hubs: hubs.filter(Boolean).sort(),
    fechas: fechas.filter(Boolean).sort().reverse(),
  };
}
