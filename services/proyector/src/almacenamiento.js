/**
 * Almacenamiento del proyector en MongoDB: índices y escritura atómica de la
 * colección `envios`. La fuente de verdad es Kafka; estas colecciones son
 * vistas derivadas reconstruibles.
 */

import {
  aplicarEventoAEstado,
  aplicarReprogramacion,
  RESULTADOS_REDUCCION,
} from './reductor.js';

/** Nombre de la colección de envíos. */
export const COLECCION_ENVIOS = 'envios';

/** Nombre de la colección de notificaciones registradas. */
export const COLECCION_NOTIFICACIONES = 'notificaciones';

/**
 * Proyector de envíos sobre una base MongoDB.
 * @typedef {object} RepositorioEnvios
 * @property {(evento: import('@rutasur/shared/src/eventos/tipos.js').EventoEstado) => Promise<{resultado: string}>} aplicarEstado
 *   Aplica un evento de estado al documento del envío de forma idempotente.
 * @property {(evento: import('@rutasur/shared/src/eventos/tipos.js').EventoReprogramacion) => Promise<{resultado: string}>} aplicarReprogramacion
 *   Aplica una decisión de reprogramación al documento del envío.
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

    async aplicarReprogramacion(evento) {
      const actual = await coleccion.findOne(
        { shipmentId: evento.shipmentId },
        { projection: { _id: 0 } },
      );
      const { resultado, documento } = aplicarReprogramacion(
        /** @type {import('./reductor.js').DocumentoEnvio | null} */ (actual),
        evento,
      );
      if (!documento) return { resultado };
      await coleccion.updateOne(
        { shipmentId: evento.shipmentId },
        { $set: documento },
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

/**
 * Crea los índices de la colección `notificaciones` si no existen:
 * eventId único (idempotencia) y shipmentId para consultas del detalle.
 * @param {import('mongodb').Db} db Base de datos de MongoDB.
 * @returns {Promise<void>} Resuelve cuando los índices existen.
 */
export async function asegurarIndicesNotificaciones(db) {
  const coleccion = db.collection(COLECCION_NOTIFICACIONES);
  await coleccion.createIndex({ eventId: 1 }, { unique: true, name: 'eventId_unico' });
  await coleccion.createIndex({ shipmentId: 1 }, { name: 'shipmentId' });
}

/**
 * Repositorio de notificaciones registradas (colección `notificaciones`).
 * @typedef {object} RepositorioNotificaciones
 * @property {(evento: import('@rutasur/shared/src/eventos/tipos.js').EventoNotificacion) => Promise<boolean>} registrar
 *   Registra la notificación; devuelve falso si el eventId ya estaba registrado.
 */

/**
 * Crea el repositorio de notificaciones sobre una base de datos conectada.
 * @param {import('mongodb').Db} db Base de datos de MongoDB.
 * @returns {RepositorioNotificaciones} Repositorio listo para usar.
 */
export function crearRepositorioNotificaciones(db) {
  const coleccion = db.collection(COLECCION_NOTIFICACIONES);
  return {
    async registrar(evento) {
      try {
        await coleccion.insertOne({ ...evento, registradoEn: new Date() });
        return true;
      } catch (error) {
        if (
          error instanceof Error &&
          'code' in error &&
          /** @type {{code?: number}} */ (error).code === 11000
        ) {
          return false;
        }
        throw error;
      }
    },
  };
}

/** Nombre de la colección de alertas de SLA. */
export const COLECCION_ALERTAS = 'alertas';

/**
 * Crea los índices de la colección `alertas` (estado+prioridad y shipmentId).
 * @param {import('mongodb').Db} db Base de datos de MongoDB.
 * @returns {Promise<void>} Resuelve cuando los índices existen.
 */
export async function asegurarIndicesAlertas(db) {
  const coleccion = db.collection(COLECCION_ALERTAS);
  await coleccion.createIndex({ estado: 1, prioridad: 1 }, { name: 'estado_prioridad' });
  await coleccion.createIndex({ shipmentId: 1 }, { name: 'shipmentId' });
  await coleccion.createIndex(
    { shipmentId: 1, regla: 1 },
    { unique: true, name: 'alerta_unica_por_regla' },
  );
}

/**
 * Repositorio de alertas de SLA (colección `alertas`).
 * @typedef {object} RepositorioAlertas
 * @property {(evento: import('@rutasur/shared/src/eventos/tipos.js').EventoAlertaSla) => Promise<{resultado: string}>} aplicarAlerta
 *   Registra la apertura o el cierre de una alerta por regla.
 */

/**
 * Crea el repositorio de alertas sobre una base de datos conectada.
 * @param {import('mongodb').Db} db Base de datos de MongoDB.
 * @returns {RepositorioAlertas} Repositorio listo para usar.
 */
export function crearRepositorioAlertas(db) {
  const coleccion = db.collection(COLECCION_ALERTAS);
  return {
    async aplicarAlerta(evento) {
      if (evento.estadoAlerta === 'ABIERTA') {
        await coleccion.updateOne(
          { shipmentId: evento.shipmentId, regla: evento.regla },
          {
            $setOnInsert: {
              shipmentId: evento.shipmentId,
              regla: evento.regla,
              prioridad: evento.prioridad,
              estado: 'ABIERTA',
              venceEn: evento.venceEn,
              abiertaEn: evento.ocurridoEn,
              eventIdApertura: evento.eventId,
              hubId: evento.hubId,
              zonaId: evento.zonaId,
            },
          },
          { upsert: true },
        );
        return { resultado: 'ABIERTA' };
      }
      const actualizado = await coleccion.updateOne(
        { shipmentId: evento.shipmentId, regla: evento.regla, estado: 'ABIERTA' },
        { $set: { estado: 'CERRADA', cerradaEn: evento.ocurridoEn, eventIdCierre: evento.eventId } },
      );
      return { resultado: actualizado.matchedCount > 0 ? 'CERRADA' : 'CIERRE_SIN_ALERTA' };
    },
  };
}
