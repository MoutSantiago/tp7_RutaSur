/**
 * Punto de entrada del proyector (CU1).
 *
 * Consume `envios.estados` en el grupo `proyector` y mantiene la colección
 * `envios` en MongoDB: validación de esquema con envío a DLQ, descarte de
 * duplicados por eventId (eventos_procesados) y por secuencia, y commit manual
 * del offset solo después de escribir en MongoDB.
 */

import {
  TOPICS,
  GRUPOS,
  cargarConfiguracion,
  crearLogger,
  crearConsumidor,
  crearProcesadorMensaje,
  crearProductor,
  conectarMongo,
  crearMarcadorIdempotencia,
  asegurarIndicesIdempotencia,
  registrarApagadoOrdenado,
} from '@rutasur/shared';
import {
  crearRepositorioEnvios,
  crearRepositorioNotificaciones,
  asegurarIndicesEnvios,
  asegurarIndicesNotificaciones,
} from './almacenamiento.js';

/**
 * Arranca el servicio proyector y queda consumiendo hasta recibir una señal.
 * @returns {Promise<void>} Resuelve cuando el servicio quedó iniciado.
 */
async function main() {
  const config = cargarConfiguracion({ servicio: 'proyector' });
  const logger = crearLogger({ servicio: GRUPOS.PROYECTOR, nivel: config.logNivel });

  const conexion = await conectarMongo({ uri: config.mongoUri, dbName: config.mongoDb, logger });
  await asegurarIndicesIdempotencia(conexion.db);
  await asegurarIndicesEnvios(conexion.db);
  await asegurarIndicesNotificaciones(conexion.db);
  const repositorio = crearRepositorioEnvios(conexion.db);
  const notificaciones = crearRepositorioNotificaciones(conexion.db);
  const marcarIdempotencia = crearMarcadorIdempotencia({ db: conexion.db, consumidor: GRUPOS.PROYECTOR });

  const productorDlq = await crearProductor({
    brokers: config.kafkaBrokers,
    clientId: 'proyector',
    logger,
  });

  const procesador = crearProcesadorMensaje({
    consumidor: GRUPOS.PROYECTOR,
    logger,
    marcarSiNuevo: marcarIdempotencia.marcarSiNuevo,
    enviarADlq: ({ clave, valor }) =>
      productorDlq.publicarCrudo({ topico: TOPICS.DLQ_ESTADOS, clave, valor }),
    handler: async (evento, contexto) => {
      if (contexto.topico === TOPICS.ESTADOS) {
        const estado = /** @type {import('@rutasur/shared/src/eventos/tipos.js').EventoEstado} */ (evento);
        const { resultado } = await repositorio.aplicarEstado(estado);
        logger.info('Evento de estado proyectado', {
          shipmentId: estado.shipmentId,
          tipo: estado.tipo,
          secuencia: estado.secuencia,
          resultado,
          particion: contexto.particion,
          offset: contexto.offset,
        });
      } else if (contexto.topico === TOPICS.REPROGRAMACIONES) {
        const repro = /** @type {import('@rutasur/shared/src/eventos/tipos.js').EventoReprogramacion} */ (evento);
        const { resultado } = await repositorio.aplicarReprogramacion(repro);
        logger.info('Reprogramación proyectada', {
          shipmentId: repro.shipmentId,
          resultadoReprogramacion: repro.resultado,
          intento: repro.intento,
          resultado,
        });
      } else if (contexto.topico === TOPICS.NOTIFICACIONES) {
        const notificacion = /** @type {import('@rutasur/shared/src/eventos/tipos.js').EventoNotificacion} */ (evento);
        const registrada = await notificaciones.registrar(notificacion);
        logger.info('Notificación registrada', {
          shipmentId: notificacion.shipmentId,
          duplicada: !registrada,
        });
      }
    },
  });

  const consumidor = await crearConsumidor({
    brokers: config.kafkaBrokers,
    clientId: 'proyector',
    grupo: GRUPOS.PROYECTOR,
    topicos: [TOPICS.ESTADOS, TOPICS.REPROGRAMACIONES, TOPICS.NOTIFICACIONES],
    procesador,
    logger,
  });
  await consumidor.iniciar();

  registrarApagadoOrdenado({
    logger,
    pasos: [
      { nombre: 'consumidor-kafka', ejecutar: () => consumidor.detener() },
      { nombre: 'productor-dlq', ejecutar: () => productorDlq.cerrar() },
      { nombre: 'mongodb', ejecutar: () => conexion.cerrar() },
    ],
  });

  logger.info('Proyector en marcha', { grupo: GRUPOS.PROYECTOR, topicos: [TOPICS.ESTADOS] });
}

await main();
